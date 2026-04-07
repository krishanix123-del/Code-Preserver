import { Server as HttpServer } from "http";
import { Server as IOServer, Socket } from "socket.io";
import { logger } from "./lib/logger";

interface MemberMeta {
  userId: string;
  avatar: string;
  isStreaming: boolean;
}

interface RoomInfo {
  members: Map<string, MemberMeta>;
  hostSocketId: string;
  hostUserId: string; // Fix 6: track host by userId so reconnect restores host status
}

const rooms = new Map<string, RoomInfo>();

function membersList(room: RoomInfo) {
  return Array.from(room.members.entries()).map(([id, m]) => ({
    peerId: id, userId: m.userId, avatar: m.avatar, isStreaming: m.isStreaming,
    isRoomHost: id === room.hostSocketId,
  }));
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
    let userMeta: MemberMeta = { userId: "Unknown", avatar: "👤", isStreaming: false };

    socket.on("join-room", ({ roomCode, userId, avatar }: { roomCode: string; userId: string; avatar: string }) => {
      if (currentRoom) handleLeave(socket, currentRoom, io, rooms, userMeta);
      currentRoom = roomCode;
      userMeta = { userId, avatar, isStreaming: false };

      const isNewRoom = !rooms.has(roomCode);
      if (isNewRoom) {
        rooms.set(roomCode, { members: new Map(), hostSocketId: socket.id, hostUserId: userId });
      } else {
        // Fix 6: if this user was the original host, restore their host socket ID
        const room = rooms.get(roomCode)!;
        if (room.hostUserId === userId) {
          room.hostSocketId = socket.id;
          logger.info({ socketId: socket.id, userId, roomCode }, "Host reconnected — host status restored");
        }
      }

      const room = rooms.get(roomCode)!;
      room.members.set(socket.id, { ...userMeta });
      socket.join(roomCode);

      const isHost = socket.id === room.hostSocketId;

      const existingPeers = Array.from(room.members.entries())
        .filter(([id]) => id !== socket.id)
        .map(([id, meta]) => ({
          peerId: id, userId: meta.userId, avatar: meta.avatar,
          isStreaming: meta.isStreaming, isRoomHost: id === room.hostSocketId,
        }));

      socket.to(roomCode).emit("peer-joined", {
        peerId: socket.id, userId, avatar, isRoomHost: isHost,
      });
      socket.emit("room-joined", { roomCode, peers: existingPeers, iAmRoomHost: isHost });
      io.to(roomCode).emit("members-update", membersList(room));
      logger.info({ socketId: socket.id, roomCode, userId, isHost }, "Joined room");
    });

    socket.on("start-stream", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      // Fix 3: only host can mark as streaming on server
      if (socket.id !== room.hostSocketId) return;
      const m = room.members.get(socket.id);
      if (m) { m.isStreaming = true; userMeta.isStreaming = true; }
      socket.to(currentRoom).emit("peer-started-stream", {
        peerId: socket.id, userId: userMeta.userId, avatar: userMeta.avatar,
      });
      io.to(currentRoom).emit("members-update", membersList(room));
    });

    socket.on("stop-stream", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      const m = room.members.get(socket.id);
      if (m) { m.isStreaming = false; userMeta.isStreaming = false; }
      socket.to(currentRoom).emit("peer-stopped-stream", { peerId: socket.id, userId: userMeta.userId });
      io.to(currentRoom).emit("members-update", membersList(room));
    });

    // Fix 5: auto-accept join requests — no host approval needed
    socket.on("join-stream-request", ({ hostPeerId }: { hostPeerId: string }) => {
      // Immediately send back stream-join-accepted to the requester
      socket.emit("stream-join-accepted", { hostPeerId });
      // Notify the host that this member joined
      io.to(hostPeerId).emit("stream-member-joined", { userId: userMeta.userId, avatar: userMeta.avatar });
    });

    socket.on("kick-member", ({ targetPeerId }: { targetPeerId: string }) => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      // Fix 4: only host can kick
      if (socket.id !== room.hostSocketId) return;
      const targetMeta = room.members.get(targetPeerId);
      if (!targetMeta) return;
      const targetSocket = io.sockets.sockets.get(targetPeerId);
      if (targetSocket) {
        targetSocket.emit("you-were-kicked", { byUserId: userMeta.userId });
        handleLeave(targetSocket, currentRoom, io, rooms, targetMeta);
      }
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
      socket.to(roomCode).emit("chat-message", { from: socket.id, userId, text, timestamp: Date.now() });
    });

    socket.on("offer", ({ to, offer }: { to: string; offer: RTCSessionDescriptionInit }) => {
      socket.to(to).emit("offer", { from: socket.id, offer });
    });
    socket.on("answer", ({ to, answer }: { to: string; answer: RTCSessionDescriptionInit }) => {
      socket.to(to).emit("answer", { from: socket.id, answer });
    });
    socket.on("ice-candidate", ({ to, candidate }: { to: string; candidate: RTCIceCandidateInit }) => {
      socket.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    socket.on("leave-room", () => {
      if (currentRoom) { handleLeave(socket, currentRoom, io, rooms, userMeta); currentRoom = null; }
    });

    socket.on("disconnect", () => {
      if (currentRoom) handleLeave(socket, currentRoom, io, rooms, userMeta);
      logger.info({ socketId: socket.id }, "Socket disconnected");
    });
  });

  return io;
}

function handleLeave(
  socket: Socket, roomCode: string, io: IOServer,
  rooms: Map<string, RoomInfo>, userMeta: MemberMeta,
) {
  socket.leave(roomCode);
  const room = rooms.get(roomCode);
  if (!room) return;

  const wasHost = socket.id === room.hostSocketId;
  room.members.delete(socket.id);

  if (room.members.size === 0) {
    rooms.delete(roomCode);
    return;
  }

  if (wasHost) {
    io.to(roomCode).emit("host-left-room", { hostUserId: userMeta.userId });
    rooms.delete(roomCode);
    logger.info({ roomCode, hostUserId: userMeta.userId }, "Host left — room dissolved");
  } else {
    io.to(roomCode).emit("peer-left", { peerId: socket.id, userId: userMeta.userId });
    io.to(roomCode).emit("members-update", Array.from(room.members.entries()).map(([id, m]) => ({
      peerId: id, userId: m.userId, avatar: m.avatar, isStreaming: m.isStreaming,
      isRoomHost: id === room.hostSocketId,
    })));
  }
}
