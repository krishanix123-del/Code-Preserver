import { Server as HttpServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface MemberMeta {
  userId: string;
  avatar: string;
  isStreaming: boolean;
  connected: boolean;
  isViewer: boolean;
}

interface RoomInfo {
  members: Map<string, MemberMeta>;
  hostSocketId: string;
  hostUserId: string; // track host by userId so reconnect restores host status
  // Set of peerIds (socket.ids) currently watching the active stream. A member
  // is added when they emit `join-stream-request` and removed on stream stop /
  // leave / disconnect. The size of this set is the "viewers watching" count.
  streamViewers: Set<string>;
}

const rooms = new Map<string, RoomInfo>();

function membersList(room: RoomInfo) {
  return Array.from(room.members.entries()).map(([id, m]) => ({
    peerId: id, userId: m.userId, avatar: m.avatar, isStreaming: m.isStreaming,
    isRoomHost: id === room.hostSocketId, connected: m.connected, isViewer: m.isViewer,
  }));
}

// Find any existing entry in the room for this userId (used for reconnect)
function findEntryByUserId(room: RoomInfo, userId: string): { peerId: string; meta: MemberMeta } | null {
  for (const [peerId, meta] of room.members.entries()) {
    if (meta.userId === userId) return { peerId, meta };
  }
  return null;
}

export function attachSignaling(httpServer: HttpServer) {
  const io = new IOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socket.io",
    pingTimeout: 60000,
    pingInterval: 20000,
    upgradeTimeout: 30000,
    transports: ["websocket", "polling"],
    allowEIO3: true,
  });

  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Socket connected");
    let currentRoom: string | null = null;
    let userMeta: MemberMeta = { userId: "Unknown", avatar: "👤", isStreaming: false, connected: true, isViewer: false };

    socket.on("join-room", ({ roomCode, userId, avatar, isViewer }: { roomCode: string; userId: string; avatar: string; isViewer?: boolean }) => {
      // Leaving a previous room only counts if user explicitly switches rooms in the same socket session
      if (currentRoom && currentRoom !== roomCode) handleExplicitLeave(socket, currentRoom, io, rooms, userMeta);
      currentRoom = roomCode;
      userMeta = { userId, avatar, isStreaming: false, connected: true, isViewer: !!isViewer };

      const isNewRoom = !rooms.has(roomCode);
      if (isNewRoom) {
        rooms.set(roomCode, { members: new Map(), hostSocketId: socket.id, hostUserId: userId, streamViewers: new Set() });
      }

      const room = rooms.get(roomCode)!;

      // RECONNECT path: if a member with this userId is already in the room (their old socket
      // dropped, or they refreshed), replace the old peerId with the new socket.id and
      // notify everyone so they can rebuild WebRTC connections under the fresh peerId.
      const existing = findEntryByUserId(room, userId);
      let oldPeerId: string | null = null;
      let isStreamingCarry = false;
      if (existing && existing.peerId !== socket.id) {
        oldPeerId = existing.peerId;
        isStreamingCarry = existing.meta.isStreaming;
        // Carry forward host status (already covered by hostSocketId update below) and isStreaming
        room.members.delete(existing.peerId);
        userMeta.isStreaming = isStreamingCarry;
      }

      // If this userId was the original host, restore their host socket id (covers reconnect & first join)
      if (room.hostUserId === userId) {
        room.hostSocketId = socket.id;
        logger.info({ socketId: socket.id, userId, roomCode }, "Host (re)connected — host status restored");
      }

      room.members.set(socket.id, { ...userMeta });
      socket.join(roomCode);

      const isHost = socket.id === room.hostSocketId;

      const existingPeers = Array.from(room.members.entries())
        .filter(([id]) => id !== socket.id)
        .map(([id, meta]) => ({
          peerId: id, userId: meta.userId, avatar: meta.avatar,
          isStreaming: meta.isStreaming, isRoomHost: id === room.hostSocketId,
          connected: meta.connected, isViewer: meta.isViewer,
        }));

      // If this is a reconnect, tell everyone the old peerId is gone before announcing the new one
      if (oldPeerId) {
        socket.to(roomCode).emit("peer-left", { peerId: oldPeerId, userId, silent: true });
      }

      socket.to(roomCode).emit("peer-joined", {
        peerId: socket.id, userId, avatar, isRoomHost: isHost,
        reconnected: oldPeerId !== null, isViewer: userMeta.isViewer,
      });
      socket.emit("room-joined", { roomCode, peers: existingPeers, iAmRoomHost: isHost });
      io.to(roomCode).emit("members-update", membersList(room));
      // Send current stream-viewer count so this socket sees the live tally immediately
      socket.emit("stream-viewer-count", { count: room.streamViewers.size });
      logger.info({ socketId: socket.id, roomCode, userId, isHost, reconnect: oldPeerId !== null }, "Joined room");
    });

    socket.on("start-stream", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      // Fix 3: only host can mark as streaming on server
      if (socket.id !== room.hostSocketId) return;
      const m = room.members.get(socket.id);
      if (m) { m.isStreaming = true; userMeta.isStreaming = true; }
      // Fresh stream — clear any leftover viewer set from a previous stream
      room.streamViewers.clear();
      socket.to(currentRoom).emit("peer-started-stream", {
        peerId: socket.id, userId: userMeta.userId, avatar: userMeta.avatar,
      });
      io.to(currentRoom).emit("members-update", membersList(room));
      io.to(currentRoom).emit("stream-viewer-count", { count: 0 });
    });

    socket.on("stop-stream", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      const m = room.members.get(socket.id);
      if (m) { m.isStreaming = false; userMeta.isStreaming = false; }
      // Stream ended — wipe the viewer set; everyone watching falls off
      if (socket.id === room.hostSocketId) room.streamViewers.clear();
      socket.to(currentRoom).emit("peer-stopped-stream", { peerId: socket.id, userId: userMeta.userId });
      io.to(currentRoom).emit("members-update", membersList(room));
      io.to(currentRoom).emit("stream-viewer-count", { count: room.streamViewers.size });
    });

    // Fix 5: auto-accept join requests — no host approval needed.
    // Also: this is the canonical "I am watching" signal, so we use it to drive the
    // server-authoritative viewer counter that the host's UI reads.
    socket.on("join-stream-request", ({ hostPeerId }: { hostPeerId: string }) => {
      // Immediately send back stream-join-accepted to the requester
      socket.emit("stream-join-accepted", { hostPeerId });
      // Notify the host that this member joined
      io.to(hostPeerId).emit("stream-member-joined", { userId: userMeta.userId, avatar: userMeta.avatar });
      // Track for the viewer counter (host doesn't count themselves as a viewer)
      if (currentRoom) {
        const room = rooms.get(currentRoom);
        if (room && socket.id !== room.hostSocketId) {
          room.streamViewers.add(socket.id);
          io.to(currentRoom).emit("stream-viewer-count", { count: room.streamViewers.size });
        }
      }
    });

    // A viewer can explicitly stop watching without leaving the room (e.g. closes the
    // stream view but stays in chat). Lets the host's counter drop accurately.
    socket.on("leave-stream", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      if (room.streamViewers.delete(socket.id)) {
        io.to(currentRoom).emit("stream-viewer-count", { count: room.streamViewers.size });
      }
    });

    socket.on("kick-member", ({ targetPeerId }: { targetPeerId: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      // Only host can kick
      if (socket.id !== room.hostSocketId) return;
      const targetMeta = room.members.get(targetPeerId);
      if (!targetMeta) return;
      // Notify the target (if still online) and remove them from the room permanently
      const targetSocket = io.sockets.sockets.get(targetPeerId);
      if (targetSocket) {
        targetSocket.emit("you-were-kicked", { byUserId: userMeta.userId });
        handleExplicitLeave(targetSocket, currentRoom, io, rooms, targetMeta);
      } else {
        // Target was offline — just drop the entry and broadcast the new list
        room.members.delete(targetPeerId);
        io.to(currentRoom).emit("peer-left", { peerId: targetPeerId, userId: targetMeta.userId });
        io.to(currentRoom).emit("members-update", membersList(room));
      }
    });

    // Host explicitly deletes (dissolves) the room — kicks every member out
    socket.on("delete-room", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      if (socket.id !== room.hostSocketId) return;
      io.to(currentRoom).emit("host-left-room", { hostUserId: userMeta.userId });
      rooms.delete(currentRoom);
      logger.info({ roomCode: currentRoom, hostUserId: userMeta.userId }, "Host explicitly deleted room");
      currentRoom = null;
    });

    socket.on("mute-member", ({ targetPeerId }: { targetPeerId: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      // Fix 4: only host can mute
      if (socket.id !== room.hostSocketId) return;
      io.to(targetPeerId).emit("you-are-muted", { byUserId: userMeta.userId, durationMs: 5000 });
    });

    socket.on("name-change-notify", ({ targetPeerId, newName }: { targetPeerId: string; newName: string }) => {
      io.to(targetPeerId).emit("your-name-changed", { byUserId: userMeta.userId, newName });
    });

    socket.on("chat-message", ({ roomCode, userId, text }: { roomCode: string; userId: string; text: string }) => {
      io.to(roomCode).emit("chat-message", { from: socket.id, userId, text, timestamp: Date.now() });
    });

    // The signaling server only relays SDP/ICE payloads verbatim; the real WebRTC
    // DOM types only exist in browsers, so we describe them with minimal local
    // shapes to keep this Node typecheck clean.
    type SdpPayload = { type: "offer" | "answer" | "pranswer" | "rollback"; sdp?: string };
    type IcePayload = { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };

    socket.on("offer", ({ to, offer }: { to: string; offer: SdpPayload }) => {
      socket.to(to).emit("offer", { from: socket.id, offer });
    });
    socket.on("answer", ({ to, answer }: { to: string; answer: SdpPayload }) => {
      socket.to(to).emit("answer", { from: socket.id, answer });
    });
    socket.on("ice-candidate", ({ to, candidate }: { to: string; candidate: IcePayload }) => {
      socket.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    // Relay a peer's outgoing-video status (camera off / screen share starts / etc.) to
    // everyone else in the room. Receivers use this to render a "Camera off" placeholder
    // because WebRTC's `replaceTrack(null)` leaves a frozen last frame on the receiver.
    socket.on("peer-video-state", ({ off }: { off: boolean }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("peer-video-state", { from: socket.id, off: !!off });
    });

    // Member explicitly chose to leave the room
    socket.on("leave-room", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) { currentRoom = null; return; }
      // If the host calls leave-room, treat it as deleting the room (dissolves it)
      if (socket.id === room.hostSocketId) {
        io.to(currentRoom).emit("host-left-room", { hostUserId: userMeta.userId });
        rooms.delete(currentRoom);
        logger.info({ roomCode: currentRoom, hostUserId: userMeta.userId }, "Host left — room dissolved");
      } else {
        handleExplicitLeave(socket, currentRoom, io, rooms, userMeta);
      }
      currentRoom = null;
    });

    socket.on("disconnect", () => {
      // Tab closed / network blip / browser refresh — DO NOT remove the member.
      // Mark them as offline so others can see, but keep their slot so they can reconnect
      // (and so the host can still kick them or delete the room).
      if (currentRoom) handleSocketDrop(socket, currentRoom, io, rooms);
      logger.info({ socketId: socket.id }, "Socket disconnected (member kept in room as offline)");
    });
  });

  return io;
}

// Permanent removal — used by explicit leave-room (member) and kick-member (host).
function handleExplicitLeave(
  socket: Socket, roomCode: string, io: IOServer,
  rooms: Map<string, RoomInfo>, userMeta: MemberMeta,
) {
  socket.leave(roomCode);
  const room = rooms.get(roomCode);
  if (!room) return;

  room.members.delete(socket.id);
  room.streamViewers.delete(socket.id);

  if (room.members.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  io.to(roomCode).emit("peer-left", { peerId: socket.id, userId: userMeta.userId });
  io.to(roomCode).emit("members-update", membersList(room));
  io.to(roomCode).emit("stream-viewer-count", { count: room.streamViewers.size });
}

// Soft drop — keeps the member in the room, just marks them offline so peers/UI know.
// Triggered when the socket dies without an explicit leave (tab close, refresh, network blip).
function handleSocketDrop(
  socket: Socket, roomCode: string, io: IOServer,
  rooms: Map<string, RoomInfo>,
) {
  socket.leave(roomCode);
  const room = rooms.get(roomCode);
  if (!room) return;
  const meta = room.members.get(socket.id);
  if (!meta) return;
  meta.connected = false;
  // Stop showing them as "streaming" once they're offline; they'll re-emit start-stream on reconnect
  meta.isStreaming = false;
  // Disconnected viewers should drop off the live count immediately
  room.streamViewers.delete(socket.id);
  // Tell peers to tear down their RTCPeerConnection to this dead peerId — they'll get
  // a fresh peer-joined when the same userId reconnects with a new socket.id.
  io.to(roomCode).emit("peer-disconnected", { peerId: socket.id, userId: meta.userId });
  io.to(roomCode).emit("members-update", membersList(room));
  io.to(roomCode).emit("stream-viewer-count", { count: room.streamViewers.size });
}
