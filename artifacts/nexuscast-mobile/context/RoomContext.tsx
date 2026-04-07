import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import { io, Socket } from "socket.io-client";

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  ts: number;
}

export interface Member {
  peerId: string;
  userId: string;
  avatar: string;
  isStreaming: boolean;
  isRoomHost: boolean;
}

export interface RemoteStreamItem {
  peerId: string;
  userId: string;
  streamURL: string;
}

let _id = 0;

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle" as RTCBundlePolicy,
  rtcpMuxPolicy: "require" as RTCRtcpMuxPolicy,
};

interface RoomContextValue {
  isConnected: boolean;
  currentRoom: string | null;
  userId: string;
  setUserId: (id: string) => void;
  members: Member[];
  chatMessages: ChatMessage[];
  remoteStreams: RemoteStreamItem[];
  localStreamURL: string | null;
  isStreaming: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isMicOn: boolean;
  streamSec: number;
  iAmRoomHost: boolean;
  joinRoom: (roomCode: string) => void;
  leaveRoom: () => void;
  startCamera: () => Promise<void>;
  startScreenShare: () => Promise<void>;
  stopStream: () => void;
  toggleMic: () => void;
  sendChat: (text: string) => void;
  notifications: { id: string; message: string; type: "success" | "error" | "info" | "warning" }[];
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoom must be used inside RoomProvider");
  return ctx;
}

export function RoomProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [userId, setUserId] = useState(
    "USER_" + Math.random().toString(36).substr(2, 4).toUpperCase()
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreamItem[]>([]);
  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [streamSec, setStreamSec] = useState(0);
  const [iAmRoomHost, setIAmRoomHost] = useState(false);
  const [notifications, setNotifications] = useState<
    { id: string; message: string; type: "success" | "error" | "info" | "warning" }[]
  >([]);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<any>(null);
  const pcsRef = useRef<Map<string, any>>(new Map());
  const currentRoomRef = useRef<string | null>(null);
  const userIdRef = useRef(userId);
  const isStreamingRef = useRef(false);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // lazy import to allow Expo Go graceful fallback
  const RTCRef = useRef<any>(null);

  async function getRTC() {
    if (RTCRef.current) return RTCRef.current;
    try {
      const webrtc = await import("react-native-webrtc");
      RTCRef.current = webrtc;
      return webrtc;
    } catch {
      return null;
    }
  }

  const notify = useCallback(
    (message: string, type: "success" | "error" | "info" | "warning" = "info") => {
      const id = (++_id).toString();
      setNotifications((p) => [...p.slice(-4), { id, message, type }]);
      setTimeout(() => setNotifications((p) => p.filter((n) => n.id !== id)), 4000);
    },
    []
  );

  const addMsg = useCallback((sender: string, text: string) => {
    const id = (++_id).toString();
    setChatMessages((p) => [...p.slice(-49), { id, sender, text, ts: Date.now() }]);
  }, []);

  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  // Stream timer
  useEffect(() => {
    if (isStreaming) {
      streamTimerRef.current = setInterval(() => setStreamSec((s) => s + 1), 1000);
    } else {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      setStreamSec(0);
    }
    return () => {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    };
  }, [isStreaming]);

  // Socket.IO setup
  useEffect(() => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN ?? "localhost:8080";
    const serverUrl = `https://${domain}`;
    const socket = io(serverUrl, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      notify("Connected to server", "success");
      if (currentRoomRef.current) {
        socket.emit("join-room", {
          roomCode: currentRoomRef.current,
          userId: userIdRef.current,
          avatar: "📱",
        });
        if (isStreamingRef.current) socket.emit("start-stream");
      }
    });

    socket.on("disconnect", (reason: string) => {
      setIsConnected(false);
      if (reason === "io server disconnect") notify("Disconnected by server", "error");
      else notify("Connection lost. Reconnecting...", "warning");
    });

    socket.on(
      "room-joined",
      ({
        peers,
        iAmRoomHost: iAmHost,
      }: {
        peers: { peerId: string; userId: string; avatar: string; isStreaming: boolean; isRoomHost: boolean }[];
        iAmRoomHost: boolean;
      }) => {
        setIAmRoomHost(iAmHost);
        peers.forEach(({ peerId, userId: uid, avatar, isStreaming: streaming, isRoomHost }) => {
          setMembers((p) =>
            p.find((m) => m.peerId === peerId)
              ? p
              : [...p, { peerId, userId: uid, avatar, isStreaming: streaming, isRoomHost }]
          );
          if (streaming) {
            notify(`${uid} is streaming — auto-joining...`, "info");
            addMsg("⚡ SYSTEM", `${uid} is streaming — auto-joining`);
            connectToHost(peerId, socket);
          }
        });
      }
    );

    socket.on(
      "peer-joined",
      ({ peerId, userId: uid, avatar, isRoomHost }: { peerId: string; userId: string; avatar: string; isRoomHost: boolean }) => {
        notify(`${uid} joined the room`, "info");
        addMsg("⚡ SYSTEM", `${uid} joined`);
        setMembers((p) =>
          p.find((m) => m.peerId === peerId)
            ? p
            : [...p, { peerId, userId: uid, avatar, isStreaming: false, isRoomHost }]
        );
        if (isStreamingRef.current) socket.emit("start-stream");
      }
    );

    socket.on(
      "peer-started-stream",
      ({ peerId, userId: uid }: { peerId: string; userId: string }) => {
        notify(`${uid} started streaming — auto-joining! 📺`, "success");
        addMsg("⚡ SYSTEM", `${uid} started streaming — joining automatically`);
        setMembers((p) => p.map((m) => (m.peerId === peerId ? { ...m, isStreaming: true } : m)));
        connectToHost(peerId, socket);
      }
    );

    socket.on("peer-stopped-stream", ({ peerId }: { peerId: string }) => {
      setMembers((p) => p.map((m) => (m.peerId === peerId ? { ...m, isStreaming: false } : m)));
      setRemoteStreams((p) => p.filter((r) => r.peerId !== peerId));
      const pc = pcsRef.current.get(peerId);
      if (pc) { pc.close(); pcsRef.current.delete(peerId); }
      notify("Streamer stopped sharing.", "info");
    });

    socket.on(
      "offer",
      async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
        const rtc = await getRTC();
        if (!rtc) return;
        const pc = await getOrCreatePC(from, socket);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new rtc.RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { to: from, answer });
        } catch (err) {
          console.error("offer err:", err);
        }
      }
    );

    socket.on(
      "answer",
      async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
        const rtc = await getRTC();
        if (!rtc) return;
        const pc = pcsRef.current.get(from);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(new rtc.RTCSessionDescription(answer));
        } catch {}
      }
    );

    socket.on(
      "ice-candidate",
      async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
        const rtc = await getRTC();
        if (!rtc) return;
        const pc = pcsRef.current.get(from);
        if (!pc || !candidate) return;
        try {
          await pc.addIceCandidate(new rtc.RTCIceCandidate(candidate));
        } catch {}
      }
    );

    socket.on("peer-left", ({ peerId, userId: uid }: { peerId: string; userId: string }) => {
      notify(`${uid} left`, "info");
      addMsg("⚡ SYSTEM", `${uid} left the room`);
      removePeer(peerId);
    });

    socket.on(
      "members-update",
      (
        list: { peerId: string; userId: string; avatar: string; isStreaming: boolean; isRoomHost: boolean }[]
      ) => {
        const myId = socket.id;
        const updated = list
          .filter((p) => p.peerId !== myId)
          .map((p) => ({ ...p }));
        setMembers(updated);
      }
    );

    socket.on("chat-message", ({ userId: sender, text }: { userId: string; text: string }) => {
      addMsg(sender, text);
    });

    socket.on("you-were-kicked", ({ byUserId }: { byUserId: string }) => {
      notify(`🚫 You were removed by ${byUserId}`, "error");
      addMsg("⚡ SYSTEM", `You were removed by ${byUserId}`);
      cleanupAllPeers();
      setCurrentRoom(null);
      setMembers([]);
      setRemoteStreams([]);
    });

    socket.on("host-left-room", ({ hostUserId }: { hostUserId: string }) => {
      notify(`Host (${hostUserId}) left. Room closed.`, "warning");
      addMsg("⚡ SYSTEM", `Host (${hostUserId}) has left. Room dissolved.`);
      cleanupAllPeers();
      setCurrentRoom(null);
      setMembers([]);
      setRemoteStreams([]);
      setIAmRoomHost(false);
    });

    socket.on("stream-member-joined", ({ userId: uid }: { userId: string }) => {
      notify(`${uid} joined your stream! 🎉`, "success");
    });

    socket.on("you-are-muted", ({ byUserId }: { byUserId: string; durationMs: number }) => {
      notify(`🔇 You were muted by ${byUserId}`, "warning");
      setIsMicOn(false);
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks?.().forEach((t: any) => { t.enabled = false; });
      }
    });

    return () => {
      cleanupAllPeers();
      socket.disconnect();
    };
  }, []);

  function cleanupAllPeers() {
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
  }

  function removePeer(peerId: string) {
    const pc = pcsRef.current.get(peerId);
    if (pc) { pc.close(); pcsRef.current.delete(peerId); }
    setRemoteStreams((p) => p.filter((r) => r.peerId !== peerId));
    setMembers((p) => p.filter((m) => m.peerId !== peerId));
  }

  async function getOrCreatePC(peerId: string, socket: Socket): Promise<any | null> {
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId);
    const rtc = await getRTC();
    if (!rtc) return null;
    const pc = new rtc.RTCPeerConnection(RTC_CONFIG);
    pcsRef.current.set(peerId, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks?.().forEach((track: any) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.onicecandidate = (e: any) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { to: peerId, candidate: e.candidate.toJSON?.() ?? e.candidate });
      }
    };

    pc.ontrack = (e: any) => {
      const stream = e.streams?.[0];
      if (!stream) return;
      const streamURL = stream.toURL?.() ?? "";
      setRemoteStreams((p) => {
        const exists = p.find((r) => r.peerId === peerId);
        return exists
          ? p.map((r) => (r.peerId === peerId ? { peerId, userId: peerId, streamURL } : r))
          : [...p, { peerId, userId: peerId, streamURL }];
      });
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch {}
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        setTimeout(() => {
          if (pc.connectionState === "failed") removePeer(peerId);
        }, 5000);
      }
    };

    return pc;
  }

  async function connectToHost(hostPeerId: string, socket: Socket) {
    if (pcsRef.current.has(hostPeerId)) return;
    const rtc = await getRTC();
    if (!rtc) return;
    try {
      let micStream: any = null;
      try {
        micStream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {}
      if (micStream && !localStreamRef.current) {
        localStreamRef.current = micStream;
      }
      const pc = await getOrCreatePC(hostPeerId, socket);
      if (!pc) return;
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: hostPeerId, offer });
    } catch (err) {
      console.error("connectToHost:", err);
    }
  }

  const joinRoom = useCallback((roomCode: string) => {
    const code = roomCode.trim().toUpperCase();
    if (!code) return;
    setCurrentRoom(code);
    setMembers([]);
    setChatMessages([]);
    setRemoteStreams([]);
    socketRef.current?.emit("join-room", {
      roomCode: code,
      userId: userIdRef.current,
      avatar: "📱",
    });
    notify(`Joined room ${code}`, "success");
    addMsg("⚡ SYSTEM", `You joined room ${code}`);
  }, [notify, addMsg]);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
    stopStreamInternal();
    cleanupAllPeers();
    setCurrentRoom(null);
    setMembers([]);
    setChatMessages([]);
    setRemoteStreams([]);
    setIAmRoomHost(false);
  }, []);

  function stopStreamInternal() {
    localStreamRef.current?.getTracks?.().forEach((t: any) => t.stop());
    localStreamRef.current = null;
    setLocalStreamURL(null);
    setIsStreaming(false);
    setIsCameraOn(false);
    setIsScreenSharing(false);
    setIsMicOn(false);
    socketRef.current?.emit("stop-stream");
  }

  const startCamera = useCallback(async () => {
    const rtc = await getRTC();
    if (!rtc) {
      Alert.alert(
        "Not Supported",
        "Camera streaming requires a custom native build. Please use the Expo Launch to build the app.",
        [{ text: "OK" }]
      );
      return;
    }
    try {
      const stream = await rtc.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      localStreamRef.current = stream;
      setLocalStreamURL(stream.toURL?.() ?? null);
      setIsCameraOn(true);
      setIsMicOn(true);
      setIsStreaming(true);
      socketRef.current?.emit("start-stream");
      pcsRef.current.forEach(async (pc, peerId) => {
        stream.getTracks?.().forEach((track: any) => pc.addTrack(track, stream));
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("offer", { to: peerId, offer });
        } catch {}
      });
      notify("Camera stream started!", "success");
    } catch (err: any) {
      notify("Could not access camera: " + (err?.message ?? "unknown error"), "error");
    }
  }, [notify]);

  const startScreenShare = useCallback(async () => {
    const rtc = await getRTC();
    if (!rtc) {
      Alert.alert(
        "Not Supported",
        "Screen sharing requires a custom native build. Please use the Expo Launch to build the app.",
        [{ text: "OK" }]
      );
      return;
    }
    try {
      const constraints: any = {
        video: {
          mandatory: {
            chromeMediaSource: "screen",
          },
        },
        audio: false,
      };
      // On iOS, use getDisplayMedia approach
      let stream: any;
      if (Platform.OS === "ios") {
        stream = await rtc.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } else {
        stream = await rtc.mediaDevices.getDisplayMedia({ video: true, audio: true });
      }
      // Mix with audio if possible
      try {
        const micStream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
        micStream.getAudioTracks?.().forEach((t: any) => stream.addTrack(t));
      } catch {}
      localStreamRef.current = stream;
      setLocalStreamURL(stream.toURL?.() ?? null);
      setIsScreenSharing(true);
      setIsStreaming(true);
      socketRef.current?.emit("start-stream");
      pcsRef.current.forEach(async (pc, peerId) => {
        stream.getTracks?.().forEach((track: any) => pc.addTrack(track, stream));
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          await pc.setLocalDescription(offer);
          socketRef.current?.emit("offer", { to: peerId, offer });
        } catch {}
      });
      stream.getVideoTracks?.()[0]?.addEventListener?.("ended", () => {
        stopStreamInternal();
      });
      notify("Screen sharing started!", "success");
    } catch (err: any) {
      notify("Could not share screen: " + (err?.message ?? "unknown error"), "error");
    }
  }, [notify]);

  const stopStream = useCallback(() => {
    stopStreamInternal();
    notify("Stream stopped.", "info");
  }, [notify]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTracks = localStreamRef.current.getAudioTracks?.() ?? [];
    if (audioTracks.length === 0) return;
    const newEnabled = !isMicOn;
    audioTracks.forEach((t: any) => { t.enabled = newEnabled; });
    setIsMicOn(newEnabled);
  }, [isMicOn]);

  const sendChat = useCallback(
    (text: string) => {
      if (!text.trim() || !currentRoomRef.current) return;
      socketRef.current?.emit("chat-message", { text: text.trim() });
      addMsg(userIdRef.current, text.trim());
    },
    [addMsg]
  );

  return (
    <RoomContext.Provider
      value={{
        isConnected,
        currentRoom,
        userId,
        setUserId,
        members,
        chatMessages,
        remoteStreams,
        localStreamURL,
        isStreaming,
        isCameraOn,
        isScreenSharing,
        isMicOn,
        streamSec,
        iAmRoomHost,
        joinRoom,
        leaveRoom,
        startCamera,
        startScreenShare,
        stopStream,
        toggleMic,
        sendChat,
        notifications,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}
