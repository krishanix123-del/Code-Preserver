import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { io, Socket } from "socket.io-client";
import QRCode from "qrcode";

const AVATARS = ["👤", "👨", "🧑", "👦", "👩", "👧", "👸", "🧔", "👱", "🦸", "🧙", "🤖"];

// Read URL params set by the native mobile shell before the component mounts
const _initParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const _nativeUid = _initParams.get("uid") ?? null;
const _nativeAvatar = _initParams.get("avatar") ? decodeURIComponent(_initParams.get("avatar")!) : null;
const _isNativeApp = _initParams.get("native") === "1";

/** Post a message to the React Native WebView wrapper (no-op in browser) */
function postToNative(data: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).ReactNativeWebView?.postMessage(JSON.stringify(data));
  } catch {}
}
const QUICK_MSGS = [
  { label: "🔴 Push!", text: "Push! 🔴" },
  { label: "👀 Watch!", text: "Watch! 👀" },
  { label: "🎯 Enemy!", text: "Enemy spotted! 🎯" },
  { label: "🔥 Go!", text: "Go go go! 🔥" },
  { label: "🤝 Group", text: "Regroup 🤝" },
  { label: "✅ Clear", text: "All clear ✅" },
];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

interface ChatMessage { id: number; sender: string; text: string; }
interface Member { peerId: string; userId: string; avatar: string; isFav: boolean; isStreaming: boolean; isRoomHost: boolean; }
interface RemoteStream { peerId: string; stream: MediaStream; }
interface Notification { id: number; message: string; type: "success" | "error" | "info" | "warning"; }
interface IncomingJoinReq { from: string; userId: string; avatar: string; }
interface ChatPopup { id: number; sender: string; text: string; }
type StreamStartOption = "camera" | "screen" | "both" | null;

function generateRoomCode() { return Math.random().toString(36).substr(2, 6).toUpperCase(); }
function fmt(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
let _msgId = 0, _notifId = 0, _popupId = 0;

export default function App() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isWebcamOn, setIsWebcamOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [streamSec, setStreamSec] = useState(0);
  const [currentRoom, setCurrentRoom] = useState<string | null>(null);
  const [iAmRoomHost, setIAmRoomHost] = useState(false);
  const [userId, setUserId] = useState(_nativeUid || "USER_" + Math.random().toString(36).substr(2, 4).toUpperCase());
  const [userAvatar, setUserAvatar] = useState(_nativeAvatar || "👤");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
  const [focusedStream, setFocusedStream] = useState<RemoteStream | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const [localNicknames, setLocalNicknames] = useState<Record<string, string>>({});
  // Fix 2: joinStreamPrompt shows notification banner only (no accept/decline)
  const [joinStreamPrompt, setJoinStreamPrompt] = useState<{ hostPeerId: string; hostUserId: string } | null>(null);
  const [incomingJoinReqs, setIncomingJoinReqs] = useState<IncomingJoinReq[]>([]);
  const [joinedStreamHostId, setJoinedStreamHostId] = useState<string | null>(null);

  // Fix 9: stream start option modal
  const [showStreamStartModal, setShowStreamStartModal] = useState(false);

  // Fix 3: WhatsApp-style chat popups
  const [chatPopups, setChatPopups] = useState<ChatPopup[]>([]);
  const windowFocusedRef = useRef(true);

  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showEditIdModal, setShowEditIdModal] = useState(false);
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [showChangeNameModal, setShowChangeNameModal] = useState<{ peerId: string } | null>(null);
  const [changeNameInput, setChangeNameInput] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [newUserIdInput, setNewUserIdInput] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [shareQrDataUrl, setShareQrDataUrl] = useState("");
  const [openMenuMember, setOpenMenuMember] = useState<string | null>(null);

  // Fix 8: mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<"stream" | "chat" | "members">("stream");

  const [miniPos, setMiniPos] = useState({ x: -1, y: -1 });
  const miniDragRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const miniPlayerRef = useRef<HTMLDivElement>(null);

  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null); // room mic (mesh audio)
  const miniVideoRef = useRef<HTMLVideoElement>(null);
  const localCenterRef = useRef<HTMLVideoElement>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const userIdRef = useRef(userId);
  const userAvatarRef = useRef(userAvatar);
  const isStreamingRef = useRef(isStreaming);
  const currentRoomRef = useRef(currentRoom);
  const iAmRoomHostRef = useRef(iAmRoomHost);
  const isScreenSharingRef = useRef(isScreenSharing);
  const isWebcamOnRef = useRef(isWebcamOn);

  const notify = useCallback((message: string, type: Notification["type"] = "info") => {
    const id = ++_notifId;
    setNotifications(p => [...p, { id, message, type }]);
    setTimeout(() => setNotifications(p => p.filter(n => n.id !== id)), 5000);
  }, []);

  const addMsg = useCallback((sender: string, text: string) => {
    const id = ++_msgId;
    setChatMessages(p => [...p.slice(-49), { id, sender, text }]);
    // Fix 3: show popup when window not focused & message from others (not SYSTEM)
    if (!windowFocusedRef.current && sender !== "⚡ SYSTEM") {
      const popupId = ++_popupId;
      setChatPopups(p => [...p.slice(-2), { id: popupId, sender, text }]);
      setTimeout(() => setChatPopups(p => p.filter(pp => pp.id !== popupId)), 4000);
    }
  }, []);

  // Fix 3: track window focus
  useEffect(() => {
    const onFocus = () => { windowFocusedRef.current = true; };
    const onBlur = () => { windowFocusedRef.current = false; };
    const onVis = () => { windowFocusedRef.current = !document.hidden; };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Sync camera stream into miniVideoRef whenever screen sharing turns on with camera active
  useEffect(() => {
    if (isWebcamOn && isScreenSharing && miniVideoRef.current && localStreamRef.current) {
      miniVideoRef.current.srcObject = localStreamRef.current;
      miniVideoRef.current.play().catch(() => {});
    }
  }, [isWebcamOn, isScreenSharing]);

  // Fix 8: mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { userAvatarRef.current = userAvatar; }, [userAvatar]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
  useEffect(() => { iAmRoomHostRef.current = iAmRoomHost; }, [iAmRoomHost]);
  useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);
  useEffect(() => { isWebcamOnRef.current = isWebcamOn; }, [isWebcamOn]);

  // Generate QR code whenever shareCode changes
  useEffect(() => {
    if (shareCode) {
      const url = `${window.location.origin}/?room=${shareCode}`;
      QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#00d4ff", light: "#050915" } })
        .then(dataUrl => setShareQrDataUrl(dataUrl))
        .catch(() => {});
    } else {
      setShareQrDataUrl("");
    }
  }, [shareCode]);

  useEffect(() => {
    if (isStreaming) {
      streamTimerRef.current = setInterval(() => setStreamSec(s => s + 1), 1000);
    } else {
      if (streamTimerRef.current) clearInterval(streamTimerRef.current);
      setStreamSec(0);
    }
    return () => { if (streamTimerRef.current) clearInterval(streamTimerRef.current); };
  }, [isStreaming]);

  function onMiniPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const rect = miniPlayerRef.current?.getBoundingClientRect();
    if (!rect) return;
    miniDragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: miniPos.x < 0 ? rect.left : miniPos.x, origY: miniPos.y < 0 ? rect.top : miniPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onMiniPointerMove(e: React.PointerEvent) {
    if (!miniDragRef.current.dragging) return;
    setMiniPos({ x: miniDragRef.current.origX + e.clientX - miniDragRef.current.startX, y: miniDragRef.current.origY + e.clientY - miniDragRef.current.startY });
  }
  function onMiniPointerUp() { miniDragRef.current.dragging = false; }

  function unlockAudio() {
    if (audioUnlocked) return;
    setAudioUnlocked(true);
    remoteVideoRefs.current.forEach(vid => { vid.play().catch(() => {}); });
  }

  // Socket.IO setup
  useEffect(() => {
    const socket = io("/", {
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
        socket.emit("join-room", { roomCode: currentRoomRef.current, userId: userIdRef.current, avatar: userAvatarRef.current });
        if (isStreamingRef.current) socket.emit("start-stream");
      } else {
        // Auto-join from URL parameter (mobile app deep link / QR code scan)
        try {
          const params = new URLSearchParams(window.location.search);
          const roomParam = params.get("room");
          if (roomParam && roomParam.length >= 4) {
            const code = roomParam.toUpperCase();
            setCurrentRoom(code);
            setMembers([{ peerId: "me", userId: userIdRef.current, avatar: userAvatarRef.current, isFav: false, isStreaming: false, isRoomHost: false }]);
            socket.emit("join-room", { roomCode: code, userId: userIdRef.current, avatar: userAvatarRef.current });
            addMsg("⚡ SYSTEM", `Auto-joined room: ${code}`);
            notify(`Joined room ${code}`, "success");
          }
        } catch {}
      }
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      if (reason === "io server disconnect") notify("Disconnected by server", "error");
      else notify("Connection lost. Reconnecting...", "warning");
    });

    socket.on("room-joined", ({ peers, iAmRoomHost: iAmHost }: { peers: { peerId: string; userId: string; avatar: string; isStreaming: boolean; isRoomHost: boolean }[]; iAmRoomHost: boolean; }) => {
      setIAmRoomHost(iAmHost);
      peers.forEach(({ peerId, userId: uid, avatar, isStreaming: streaming, isRoomHost }) => {
        setMembers(p => p.find(m => m.peerId === peerId) ? p : [...p, { peerId, userId: uid, avatar, isFav: false, isStreaming: streaming, isRoomHost }]);
        // Always connect so the host can push video later via renegotiation
        connectToPeer(peerId, socket);
        if (streaming) {
          // Show join/skip prompt — member decides whether to watch the active stream
          setJoinStreamPrompt({ hostPeerId: peerId, hostUserId: uid });
          addMsg("⚡ SYSTEM", `${uid} is streaming — click Join Stream to watch!`);
          notify(`📡 ${uid} is live in this room!`, "info");
        }
      });
    });

    socket.on("peer-joined", ({ peerId, userId: uid, avatar, isRoomHost }: { peerId: string; userId: string; avatar: string; isRoomHost: boolean }) => {
      notify(`${uid} joined the room`, "info");
      addMsg("⚡ SYSTEM", `${uid} joined`);
      setMembers(p => p.find(m => m.peerId === peerId) ? p : [...p, { peerId, userId: uid, avatar, isFav: false, isStreaming: false, isRoomHost }]);
      // Don't initiate — the new peer sends offers to existing peers; just notify if we're streaming
      if (isStreamingRef.current) socket.emit("start-stream");
    });

    socket.on("peer-started-stream", ({ peerId, userId: uid }: { peerId: string; userId: string }) => {
      setMembers(p => p.map(m => m.peerId === peerId ? { ...m, isStreaming: true } : m));
      // Show join/skip prompt — do NOT auto-join; member decides
      setJoinStreamPrompt({ hostPeerId: peerId, hostUserId: uid });
      addMsg("⚡ SYSTEM", `${uid} started streaming — click Join Stream to watch!`);
      notify(`📡 ${uid} started streaming!`, "info");
      // Establish WebRTC connection now so tracks are ready when they choose to join
      if (!pcsRef.current.has(peerId)) connectToPeer(peerId, socket);
    });

    socket.on("peer-stopped-stream", ({ peerId }: { peerId: string }) => {
      setMembers(p => p.map(m => m.peerId === peerId ? { ...m, isStreaming: false } : m));
      setJoinStreamPrompt(null);
      // Fix 7: clear remote video immediately so no frozen frame
      const vid = remoteVideoRefs.current.get(peerId);
      if (vid) { vid.pause(); vid.srcObject = null; }
      setRemoteStreams(p => p.filter(r => r.peerId !== peerId));
      setFocusedStream(p => p?.peerId === peerId ? null : p);
      notify("Streamer stopped sharing.", "info");
    });

    socket.on("join-stream-request", ({ from, userId: uid, avatar }: { from: string; userId: string; avatar: string }) => {
      setIncomingJoinReqs(p => [...p, { from, userId: uid, avatar }]);
      addMsg("⚡ SYSTEM", `${uid} wants to join your stream`);
    });

    socket.on("stream-join-accepted", ({ hostPeerId }: { hostPeerId: string }) => {
      notify("Joining stream...", "success");
      addMsg("⚡ SYSTEM", "You joined the stream!");
      setJoinedStreamHostId(hostPeerId);
      setJoinStreamPrompt(null);
      if (!pcsRef.current.has(hostPeerId)) connectToPeer(hostPeerId, socket);
    });

    socket.on("stream-join-declined", () => {
      notify("Host declined your request", "error");
      setJoinStreamPrompt(null);
    });

    // Fix 5: host notified when a member joins their stream
    socket.on("stream-member-joined", ({ userId: uid }: { userId: string }) => {
      notify(`${uid} joined your stream! 🎉`, "success");
      addMsg("⚡ SYSTEM", `${uid} has joined your stream`);
    });

    socket.on("you-were-kicked", ({ byUserId }: { byUserId: string }) => {
      notify(`🚫 You have been removed from the room by ${byUserId}`, "error");
      addMsg("⚡ SYSTEM", `You were removed from the room by ${byUserId}`);
      pcsRef.current.forEach(pc => pc.close());
      pcsRef.current.clear();
      setRemoteStreams([]); setFocusedStream(null); setMembers([]);
      setCurrentRoom(null); setJoinedStreamHostId(null); setIAmRoomHost(false);
      if (_isNativeApp) postToNative({ type: "leave_room" });
    });

    socket.on("you-are-muted", ({ byUserId, durationMs }: { byUserId: string; durationMs: number }) => {
      notify(`🔇 You were muted by ${byUserId} for ${durationMs / 1000} seconds`, "warning");
      setIsMuted(true); setIsMicOn(false);
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
      audioStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
      setTimeout(() => { setIsMuted(false); notify("You can now unmute yourself", "info"); }, durationMs);
    });

    socket.on("your-name-changed", ({ byUserId, newName }: { byUserId: string; newName: string }) => {
      notify(`✏️ Your Name Is Being Changed By The Host (${byUserId}) to "${newName}"`, "warning");
      addMsg("⚡ SYSTEM", `Your Name Is Being Changed By The Host to "${newName}"`);
    });

    socket.on("offer", async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
      initRoomAudio().catch(() => {}); // start mic in background, don't block answer
      const pc = getOrCreatePC(from, socket);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { to: from, answer });
      } catch (err) { console.error("offer err:", err); }
    });

    socket.on("answer", async ({ from, answer }: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = pcsRef.current.get(from);
      if (!pc) return;
      try { await pc.setRemoteDescription(new RTCSessionDescription(answer)); } catch { }
    });

    socket.on("ice-candidate", async ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = pcsRef.current.get(from);
      if (!pc || !candidate) return;
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { }
    });

    socket.on("peer-left", ({ peerId, userId: uid }: { peerId: string; userId: string }) => {
      notify(`${uid} left`, "info");
      addMsg("⚡ SYSTEM", `${uid} left the room`);
      removePeer(peerId);
    });

    socket.on("members-update", (list: { peerId: string; userId: string; avatar: string; isStreaming: boolean; isRoomHost: boolean }[]) => {
      setMembers(prev => {
        const myEntry = prev.find(m => m.peerId === "me");
        const updated = list.filter(p => p.peerId !== socket.id).map(p => ({ ...p, isFav: prev.find(m => m.peerId === p.peerId)?.isFav ?? false }));
        return myEntry ? [myEntry, ...updated] : updated;
      });
    });

    socket.on("chat-message", ({ userId: sender, text }: { userId: string; text: string }) => {
      addMsg(sender, text);
    });

    // Fix 5: host left — all members get notified and room cleared
    socket.on("host-left-room", ({ hostUserId }: { hostUserId: string }) => {
      notify(`🏠 Host (${hostUserId}) left. Room closed.`, "warning");
      addMsg("⚡ SYSTEM", `Host (${hostUserId}) has left. Room dissolved.`);
      pcsRef.current.forEach(pc => pc.close());
      pcsRef.current.clear();
      setRemoteStreams([]); setFocusedStream(null); setMembers([]);
      setCurrentRoom(null); setJoinedStreamHostId(null);
      setJoinStreamPrompt(null); setIAmRoomHost(false);
      if (_isNativeApp) postToNative({ type: "leave_room" });
    });

    return () => {
      pcsRef.current.forEach(pc => pc.close());
      pcsRef.current.clear();
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
      socket.disconnect();
    };
  }, []);

  // Adaptive encoding: lower bitrate on mobile, separate caps for camera vs screen share
  function applyVideoEncodingParams(pc: RTCPeerConnection, isScreenShare = false) {
    const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    // Mobile: camera 600 Kbps / screen 900 Kbps | Desktop: camera 1200 Kbps / screen 2000 Kbps
    const maxBitrate = isScreenShare
      ? (isMob ? 900_000 : 2_000_000)
      : (isMob ? 600_000 : 1_200_000);
    const maxFramerate = isScreenShare
      ? (isMob ? 15 : 24)
      : (isMob ? 24 : 30);

    pc.getSenders().forEach(async sender => {
      if (sender.track?.kind === "video") {
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = maxBitrate;
          params.encodings[0].maxFramerate = maxFramerate;
          params.encodings[0].degradationPreference = "maintain-framerate";
          await sender.setParameters(params);
        } catch {}
      }
    });
  }

  function attachStreamToVideo(peerId: string, stream: MediaStream) {
    const vid = remoteVideoRefs.current.get(peerId);
    if (!vid) return;
    if (vid.srcObject !== stream) {
      vid.srcObject = stream;
    }
    const tryPlay = (attempt = 0) => {
      vid.play().catch(() => {
        if (attempt < 5) setTimeout(() => tryPlay(attempt + 1), 500);
      });
    };
    tryPlay();
    // Retry if video stays black (no video data yet)
    setTimeout(() => {
      if (vid.videoWidth === 0 && vid.srcObject === stream) {
        vid.srcObject = null;
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    }, 2000);
  }

  async function initRoomAudio() {
    if (audioStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getAudioTracks().forEach(t => { t.enabled = false; }); // default muted until user enables
      audioStreamRef.current = stream;
    } catch { /* mic not available */ }
  }

  function getOrCreatePC(peerId: string, socket: Socket): RTCPeerConnection {
    if (pcsRef.current.has(peerId)) return pcsRef.current.get(peerId)!;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current.set(peerId, pc);

    // Add room audio track (mesh voice)
    if (audioStreamRef.current) {
      audioStreamRef.current.getAudioTracks().forEach(t => pc.addTrack(t, audioStreamRef.current!));
    }
    // Add local stream audio/video if streaming
    if (localStreamRef.current) {
      if (!isScreenSharingRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
      }
      // Don't add audio from localStream — audioStreamRef handles it
    }
    if (isScreenSharingRef.current && screenStreamRef.current) {
      screenStreamRef.current.getVideoTracks().forEach(t => pc.addTrack(t, screenStreamRef.current!));
      screenStreamRef.current.getAudioTracks().forEach(t => pc.addTrack(t, screenStreamRef.current!));
    }

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate.toJSON() });
    };

    pc.ontrack = e => {
      const stream = e.streams?.[0];
      if (!stream) return;
      setRemoteStreams(p => {
        const exists = p.find(r => r.peerId === peerId);
        return exists ? p.map(r => r.peerId === peerId ? { peerId, stream } : r) : [...p, { peerId, stream }];
      });
      setFocusedStream(prev => prev?.peerId === peerId ? { peerId, stream } : prev ?? { peerId, stream });
      attachStreamToVideo(peerId, stream);
      // Also listen for new tracks added later (e.g., screen share added mid-stream)
      stream.onaddtrack = () => attachStreamToVideo(peerId, stream);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected") {
        // Give it 4s to recover, then restart ICE
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
            try { pc.restartIce(); } catch {}
          }
        }, 4000);
      }
      if (pc.iceConnectionState === "failed") {
        try { pc.restartIce(); } catch {}
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        // Detect whether this PC is carrying screen share or camera
        applyVideoEncodingParams(pc, isScreenSharingRef.current);
      }
      if (pc.connectionState === "failed") {
        try { pc.restartIce(); } catch {}
        setTimeout(() => {
          if (pc.connectionState === "failed") {
            try { pc.restartIce(); } catch {}
          }
        }, 5000);
      }
    };

    // CRITICAL: renegotiate when tracks are added/removed after connection.
    // Debounce 150ms to batch simultaneous addTrack calls (video+audio) into ONE offer.
    let _negotiationTimer: ReturnType<typeof setTimeout> | null = null;
    pc.onnegotiationneeded = () => {
      if (!currentRoomRef.current) return;
      if (_negotiationTimer) clearTimeout(_negotiationTimer);
      _negotiationTimer = setTimeout(async () => {
        if (pc.signalingState !== "stable") return; // avoid collisions
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("offer", { to: peerId, offer });
        } catch {}
      }, 150);
    };

    return pc;
  }

  // connectToPeer: initiator side — we create the offer (for all peers)
  async function connectToPeer(peerId: string, socket: Socket) {
    if (pcsRef.current.has(peerId)) return;
    // Fire mic init in background — don't block connection on permission prompt
    initRoomAudio().catch(() => {});
    const pc = getOrCreatePC(peerId, socket);
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: peerId, offer });
    } catch (err) { console.error("connectToPeer:", err); }
  }

  function removePeer(peerId: string) {
    const pc = pcsRef.current.get(peerId);
    if (pc) { pc.close(); pcsRef.current.delete(peerId); }
    // Fix 1/7: clear video srcObject to prevent frozen/black frame ghost
    const vid = remoteVideoRefs.current.get(peerId);
    if (vid) { vid.pause(); vid.srcObject = null; }
    remoteVideoRefs.current.delete(peerId);
    setRemoteStreams(p => p.filter(r => r.peerId !== peerId));
    setMembers(p => p.filter(m => m.peerId !== peerId));
    setFocusedStream(p => p?.peerId === peerId ? null : p);
  }

  // Fix 9+4: Stream button handler — show option modal on start, end stream without leaving room
  function handleStreamButtonClick() {
    if (isStreaming) endStreamOnly();
    else setShowStreamStartModal(true);
  }

  // Fix 2/4/7: End stream but STAY in room — keep PCs alive, just stop tracks
  function endStreamOnly() {
    // Stop all local media tracks
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (miniVideoRef.current) miniVideoRef.current.srcObject = null;
    if (localCenterRef.current) localCenterRef.current.srcObject = null;
    // Signal stop to server BEFORE touching PCs
    if (currentRoomRef.current) socketRef.current?.emit("stop-stream");
    // Remove all senders from PCs but keep connections alive (fixes auto-leaving & frozen frames)
    pcsRef.current.forEach(pc => {
      pc.getSenders().forEach(sender => {
        try { pc.removeTrack(sender); } catch {}
      });
    });
    setIsStreaming(false); setIsWebcamOn(false); setIsScreenSharing(false); setIsMicOn(false);
    addMsg("⚡ SYSTEM", "Stream ended. You are still in the room.");
    notify("Stream ended. Still in room.", "info");
  }

  // Fix 9: Start stream with chosen option; Fix 6: attach video BEFORE setting state
  async function startStreamWithOption(option: StreamStartOption) {
    setShowStreamStartModal(false);
    if (!option) return;
    let cameraStarted = false;
    let screenStarted = false;

    if (option === "camera" || option === "both") {
      try {
        const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        // Cap resolution & fps upfront — prevents the browser encoding at 4K/60fps and causing lag
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isMob
            ? { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        localStreamRef.current = stream;
        // Fix 6: attach FIRST, then update state
        if (miniVideoRef.current) { miniVideoRef.current.srcObject = stream; miniVideoRef.current.play().catch(() => {}); }
        if (localCenterRef.current && !isScreenSharingRef.current) {
          localCenterRef.current.srcObject = stream;
          localCenterRef.current.play().catch(() => {});
        }
        // Send to existing peers; apply encoding caps after a short delay (browser needs ICE first)
        pcsRef.current.forEach(pc => {
          const senders = pc.getSenders();
          stream.getTracks().forEach(track => {
            const existing = senders.find(s => s.track?.kind === track.kind);
            if (existing) existing.replaceTrack(track).catch(() => {});
            else pc.addTrack(track, stream);
          });
          setTimeout(() => applyVideoEncodingParams(pc, false), 1500);
        });
        cameraStarted = true;
        setIsWebcamOn(true);
        setIsMicOn(true);
      } catch {
        notify("Camera/microphone permission required", "error");
        if (option !== "both") return;
      }
    }

    if (option === "screen" || option === "both") {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroidWebView = _isNativeApp || /wv/.test(navigator.userAgent) || (/Android/.test(navigator.userAgent) && /Version\/[\d.]+/.test(navigator.userAgent));
      if (!navigator.mediaDevices?.getDisplayMedia || isIOS || isAndroidWebView) {
        if (isAndroidWebView && !isIOS) {
          // Tell the native app to open this room in Chrome where getDisplayMedia works
          postToNative({ type: "open_in_browser_for_screen_share", url: window.location.href });
        } else {
          const msg = isIOS
            ? "Screen sharing is not available on iOS. Use Camera instead."
            : "Screen sharing is not supported on this browser. Try Chrome or Firefox on desktop.";
          notify(msg, "error");
        }
        if (!cameraStarted) return;
      } else {
        try {
          const isMob = /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          // Screen share: 15fps on mobile (screen barely changes), 24fps on desktop to save bandwidth
          const screenConstraints: DisplayMediaStreamOptions = isMob
            ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 15 } } }
            : { video: { frameRate: { ideal: 24, max: 30 } }, audio: true };
          const screenStream = await navigator.mediaDevices.getDisplayMedia(screenConstraints);
          screenStreamRef.current = screenStream;
          // Fix 6: attach FIRST before state update
          if (localCenterRef.current) {
            localCenterRef.current.srcObject = screenStream;
            localCenterRef.current.play().catch(() => {});
          }
          // Attach camera to mini player if camera is also active
          if (cameraStarted && localStreamRef.current && miniVideoRef.current) {
            miniVideoRef.current.srcObject = localStreamRef.current;
            miniVideoRef.current.play().catch(() => {});
          }
          const screenVideoTrack = screenStream.getVideoTracks()[0];
          pcsRef.current.forEach(pc => {
            // Find active video sender OR a null-track sender (camera was turned off earlier)
            const videoSender = pc.getSenders().find(s => s.track?.kind === "video") ?? pc.getSenders().find(s => s.track === null);
            if (videoSender) videoSender.replaceTrack(screenVideoTrack).catch(() => {});
            else pc.addTrack(screenVideoTrack, screenStream);
            const screenAudio = screenStream.getAudioTracks()[0];
            if (screenAudio) {
              const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
              if (!audioSender) pc.addTrack(screenAudio, screenStream);
            }
            // Apply screen share encoding caps (lower fps cap, higher bitrate than camera)
            setTimeout(() => applyVideoEncodingParams(pc, true), 1500);
          });
          screenStarted = true;
          setIsScreenSharing(true);
          // Fix 1: when browser stops screen share, stream continues
          screenVideoTrack.onended = () => {
            screenStreamRef.current = null;
            if (localCenterRef.current) {
              if (localStreamRef.current) {
                localCenterRef.current.srcObject = localStreamRef.current;
                localCenterRef.current.play().catch(() => {});
              } else {
                localCenterRef.current.pause();
                localCenterRef.current.srcObject = null;
                localCenterRef.current.load();
              }
            }
            setIsScreenSharing(false);
            notify("Screen sharing stopped. Stream continues.", "info");
            const camTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
            pcsRef.current.forEach(pc => {
              const sender = pc.getSenders().find(s => s.track?.kind === "video") ?? pc.getSenders().find(s => s.track === null);
              if (sender) sender.replaceTrack(camTrack).catch(() => {});
            });
          };
        } catch (err: unknown) {
          const name = err instanceof Error ? err.name : "";
          if (name === "NotAllowedError") notify("Screen sharing permission denied.", "error");
          else if (name !== "AbortError") notify("Screen sharing not available on this device/browser.", "error");
          else notify("Screen share cancelled.", "info");
          if (!cameraStarted) return;
        }
      }
    }

    if (!cameraStarted && !screenStarted) return;
    // Fix 6: state update AFTER media attached
    setIsStreaming(true);
    if (currentRoomRef.current) socketRef.current?.emit("start-stream");
    addMsg("⚡ SYSTEM", `Stream started${currentRoomRef.current ? ` in room ${currentRoomRef.current}` : " (local)"}`);
    notify("You are now LIVE! 🔴", "success");
  }

  // Camera toggle — independent of stream, with adaptive constraints to prevent lag
  async function toggleWebcam() {
    if (isWebcamOn) {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      // Pause BEFORE clearing srcObject to prevent frozen-frame artifacts
      if (miniVideoRef.current) {
        miniVideoRef.current.pause();
        miniVideoRef.current.srcObject = null;
        miniVideoRef.current.load();
      }
      if (!isScreenSharingRef.current && localCenterRef.current) {
        localCenterRef.current.pause();
        localCenterRef.current.srcObject = null;
        localCenterRef.current.load();
      }
      // Replace video sender with null track so remote side doesn't freeze
      pcsRef.current.forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
        if (videoSender) videoSender.replaceTrack(null).catch(() => {});
      });
      setIsWebcamOn(false);
      notify("Camera off. Stream continues.", "info");
    } else {
      try {
        const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: isMob
            ? { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        localStreamRef.current = stream;
        if (miniVideoRef.current) { miniVideoRef.current.srcObject = stream; miniVideoRef.current.play().catch(() => {}); }
        if (!isScreenSharingRef.current && localCenterRef.current) {
          localCenterRef.current.srcObject = stream;
          localCenterRef.current.play().catch(() => {});
        }
        pcsRef.current.forEach(pc => {
          const senders = pc.getSenders();
          stream.getTracks().forEach(track => {
            const existing = senders.find(s => s.track?.kind === track.kind);
            if (existing) existing.replaceTrack(track).catch(() => {});
            else pc.addTrack(track, stream);
          });
          setTimeout(() => applyVideoEncodingParams(pc, false), 1500);
        });
        setIsWebcamOn(true);
        notify("Camera is on 📹", "success");
      } catch { notify("Camera/microphone permission required", "error"); }
    }
  }

  // Screen share toggle — does NOT end stream; handles all environments correctly
  async function toggleScreenShare() {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      if (localCenterRef.current) {
        if (localStreamRef.current) {
          localCenterRef.current.srcObject = localStreamRef.current;
          localCenterRef.current.play().catch(() => {});
        } else {
          localCenterRef.current.pause();
          localCenterRef.current.srcObject = null;
          localCenterRef.current.load();
        }
      }
      const camTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
      pcsRef.current.forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track?.kind === "video") ?? pc.getSenders().find(s => s.track === null);
        if (videoSender) videoSender.replaceTrack(camTrack).catch(() => {});
      });
      setIsScreenSharing(false);
      notify("Screen share stopped. Stream continues.", "info");
    } else {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroidWebView = _isNativeApp || /wv/.test(navigator.userAgent) || (/Android/.test(navigator.userAgent) && /Version\/[\d.]+/.test(navigator.userAgent));
      // In native WebView: open Chrome instead of showing an error
      if (isAndroidWebView && !isIOS) {
        postToNative({ type: "open_in_browser_for_screen_share", url: window.location.href });
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia || isIOS) {
        notify(isIOS ? "Screen sharing is not available on iOS. Use Camera instead." : "Screen sharing is not supported on this browser. Try Chrome or Firefox on desktop.", "error");
        return;
      }
      try {
        const isMob = /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const screenConstraints: DisplayMediaStreamOptions = isMob
          ? { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 15 } } }
          : { video: { frameRate: { ideal: 24, max: 30 } }, audio: true };
        const screenStream = await navigator.mediaDevices.getDisplayMedia(screenConstraints);
        screenStreamRef.current = screenStream;
        if (localCenterRef.current) {
          localCenterRef.current.srcObject = screenStream;
          localCenterRef.current.play().catch(() => {});
        }
        if (localStreamRef.current && miniVideoRef.current) {
          miniVideoRef.current.srcObject = localStreamRef.current;
          miniVideoRef.current.play().catch(() => {});
        }
        const screenTrack = screenStream.getVideoTracks()[0];
        pcsRef.current.forEach(pc => {
          // Find active video sender OR a null-track sender (camera was turned off earlier)
          const videoSender = pc.getSenders().find(s => s.track?.kind === "video") ?? pc.getSenders().find(s => s.track === null);
          if (videoSender) videoSender.replaceTrack(screenTrack).catch(() => {});
          else pc.addTrack(screenTrack, screenStream);
          const screenAudio = screenStream.getAudioTracks()[0];
          if (screenAudio) {
            const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
            if (!audioSender) pc.addTrack(screenAudio, screenStream);
          }
          setTimeout(() => applyVideoEncodingParams(pc, true), 1500);
        });
        setIsScreenSharing(true);
        notify("Screen sharing active 🖥️", "success");
        screenTrack.onended = () => {
          screenStreamRef.current = null;
          if (localCenterRef.current) {
            if (localStreamRef.current) {
              localCenterRef.current.srcObject = localStreamRef.current;
              localCenterRef.current.play().catch(() => {});
            } else {
              localCenterRef.current.pause();
              localCenterRef.current.srcObject = null;
              localCenterRef.current.load();
            }
          }
          setIsScreenSharing(false);
          notify("Screen sharing stopped. Stream continues.", "info");
          const camTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
          pcsRef.current.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === "video") ?? pc.getSenders().find(s => s.track === null);
            if (sender) sender.replaceTrack(camTrack).catch(() => {});
          });
        };
      } catch (err: unknown) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") notify("Screen sharing permission denied.", "error");
        else if (name !== "AbortError") notify("Screen sharing not available on this device/browser.", "error");
        else notify("Screen share cancelled.", "info");
      }
    }
  }

  function toggleMic() {
    if (isMuted) { notify("You are muted by host. Please wait.", "warning"); return; }
    // Use audioStreamRef (room audio mesh) — fallback to localStreamRef
    const stream = audioStreamRef.current || localStreamRef.current;
    if (!stream) { notify("No microphone available", "error"); return; }
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) { notify("No microphone found", "error"); return; }
    const next = !isMicOn;
    audioTrack.enabled = next;
    // Also toggle localStream audio if available
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = next; });
    setIsMicOn(next);
    notify(next ? "Mic ON 🎙️" : "Mic muted 🔇", "info");
  }

  function joinRoomOnServer(roomCode: string) {
    setCurrentRoom(roomCode);
    setMembers([{ peerId: "me", userId: userIdRef.current, avatar: userAvatarRef.current, isFav: false, isStreaming: isStreamingRef.current, isRoomHost: false }]);
    socketRef.current?.emit("join-room", { roomCode, userId: userIdRef.current, avatar: userAvatarRef.current });
    if (isStreamingRef.current) socketRef.current?.emit("start-stream");
    addMsg("⚡ SYSTEM", `Joined room: ${roomCode}`);
    notify(`Joined room ${roomCode}`, "success");
  }

  function createRoom() {
    const code = generateRoomCode();
    setShareCode(code);
    joinRoomOnServer(code);
    setShowShareModal(true);
    setShowTeamModal(false);
    if (_isNativeApp) postToNative({ type: "room_created", code });
  }

  function joinTeamFromModal() {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || code.length < 4) { notify("Enter a valid room code", "error"); return; }
    joinRoomOnServer(code);
    setJoinCodeInput(""); setShowJoinModal(false); setShowTeamModal(false);
  }

  // Fix 5: Leave room — server emits host-left-room to all members
  function deleteRoom() {
    socketRef.current?.emit("leave-room");
    pcsRef.current.forEach(pc => pc.close()); pcsRef.current.clear();
    // Stop room audio stream so mic is released
    audioStreamRef.current?.getTracks().forEach(t => t.stop());
    audioStreamRef.current = null;
    setRemoteStreams([]); setFocusedStream(null); setMembers([]);
    setCurrentRoom(null); setJoinedStreamHostId(null); setIAmRoomHost(false);
    setIsMicOn(false);
    addMsg("⚡ SYSTEM", "Left room.");
    notify("Left the room", "info");
    if (_isNativeApp) postToNative({ type: "leave_room" });
  }

  function acceptJoinRequest(req: IncomingJoinReq) {
    socketRef.current?.emit("stream-join-accepted", { memberPeerId: req.from });
    setIncomingJoinReqs(p => p.filter(r => r.from !== req.from));
    notify(`${req.userId} joined!`, "success");
  }

  function declineJoinRequest(req: IncomingJoinReq) {
    socketRef.current?.emit("stream-join-declined", { memberPeerId: req.from });
    setIncomingJoinReqs(p => p.filter(r => r.from !== req.from));
  }

  function requestJoinStream(overridePeerId?: string) {
    const hostPeerId = overridePeerId ?? joinStreamPrompt?.hostPeerId;
    if (!hostPeerId) return;
    socketRef.current?.emit("join-stream-request", { hostPeerId });
    notify("Joining stream...", "info");
    setJoinStreamPrompt(null);
  }

  function kickMember(peerId: string) {
    socketRef.current?.emit("kick-member", { targetPeerId: peerId });
    removePeer(peerId); setOpenMenuMember(null); notify("Member removed", "info");
  }

  function muteMember(peerId: string) {
    socketRef.current?.emit("mute-member", { targetPeerId: peerId });
    setOpenMenuMember(null); notify("Member muted for 5 seconds", "info");
  }

  function openChangeNameModal(peerId: string) {
    const cur = localNicknames[peerId] || members.find(m => m.peerId === peerId)?.userId || "";
    setShowChangeNameModal({ peerId }); setChangeNameInput(cur); setOpenMenuMember(null);
  }

  function saveLocalNickname() {
    if (!showChangeNameModal) return;
    const newName = changeNameInput.trim();
    if (!newName) return;
    setLocalNicknames(prev => ({ ...prev, [showChangeNameModal.peerId]: newName }));
    socketRef.current?.emit("name-change-notify", { targetPeerId: showChangeNameModal.peerId, newName });
    notify(`Nickname set to "${newName}" (only you see this)`, "success");
    setShowChangeNameModal(null); setChangeNameInput("");
  }

  function toggleFav(peerId: string) {
    setMembers(p => p.map(m => m.peerId === peerId ? { ...m, isFav: !m.isFav } : m));
    setOpenMenuMember(null);
  }

  function sendMsg() {
    if (!chatInput.trim()) return;
    if (currentRoom && socketRef.current) socketRef.current.emit("chat-message", { roomCode: currentRoom, userId, text: chatInput.trim() });
    // Don't add locally — server now echoes back to sender via io.to(room)
    setChatInput("");
  }

  function quickMsg(text: string) {
    if (currentRoom && socketRef.current) socketRef.current.emit("chat-message", { roomCode: currentRoom, userId, text });
    // Don't add locally — server now echoes back to sender via io.to(room)
  }

  function saveUserId() {
    const newId = newUserIdInput.trim();
    if (!newId) return;
    setUserId(newId);
    setMembers(prev => prev.map(m => m.peerId === "me" ? { ...m, userId: newId } : m));
    setNewUserIdInput(""); setShowEditIdModal(false); notify("Username updated", "success");
  }

  function copyRoomCode() {
    if (currentRoom) navigator.clipboard.writeText(currentRoom).then(() => notify("Copied!", "success"));
  }

  function displayName(member: Member) {
    return localNicknames[member.peerId] || member.userId;
  }

  const sortedMembers = useMemo(() => {
    // "me" always first, host always last, other members in between (favs first)
    const me = members.find(m => m.peerId === "me");
    const hostMembers = members.filter(m => m.peerId !== "me" && m.isRoomHost);
    const favOthers = members.filter(m => m.peerId !== "me" && !m.isRoomHost && m.isFav);
    const restOthers = members.filter(m => m.peerId !== "me" && !m.isRoomHost && !m.isFav);
    return [...(me ? [{ ...me, isRoomHost: iAmRoomHost }] : []), ...favOthers, ...restOthers, ...hostMembers];
  }, [members, iAmRoomHost]);

  // Fix 3/4/6: only the room host can start a stream; if already streaming always show END
  const canStartStream = iAmRoomHost || isStreaming;
  // If any other member is streaming, host should still see the button (to start their own or end theirs)
  const showLocalCenter = (isStreaming || isWebcamOn || isScreenSharing) && !focusedStream && remoteStreams.length === 0;
  // Members only see the remote stream after they've chosen to join it
  const hasJoinedStream = iAmRoomHost || joinedStreamHostId !== null;
  const showRemoteCenter = (!!focusedStream || remoteStreams.length > 0) && hasJoinedStream;
  // Streaming peer detected but current user hasn't joined yet
  const streamingPeer = members.find(m => m.isStreaming && m.peerId !== "me");
  const canWatchStream = !hasJoinedStream && !!streamingPeer;
  const notifColor = (t: string) => t === "success" ? "#00ff44" : t === "error" ? "#ff4444" : t === "warning" ? "#ffaa00" : "#00d4ff";
  const miniStyle: React.CSSProperties = miniPos.x < 0 ? { position: "fixed", bottom: 18, right: 18 } : { position: "fixed", left: miniPos.x, top: miniPos.y };

  // ─── SHARED MODALS ────────────────────────────────────────────────────────────
  const sharedModals = (
    <>
      {showStreamStartModal && (() => {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const inWebView = _isNativeApp || /wv/.test(navigator.userAgent) || (/Android/.test(navigator.userAgent) && /Version\/[\d.]+/.test(navigator.userAgent));
        const canScreen = !isIOS && !inWebView && !!navigator.mediaDevices?.getDisplayMedia;
        return (
          <ModalOverlay onClose={() => setShowStreamStartModal(false)}>
            <ModalBox title="🔴 START STREAMING">
              <p style={{ fontSize: 12, color: "#a0b0d0", marginBottom: 4 }}>What do you want to broadcast?</p>
              <button onClick={() => startStreamWithOption("camera")} style={{ ...btnSt, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "13px 20px" }}>
                <span style={{ fontSize: 20 }}>📹</span> Camera Only
              </button>
              {canScreen ? (
                <>
                  <button onClick={() => startStreamWithOption("screen")} style={{ ...btnSt, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "13px 20px", background: "linear-gradient(135deg, #0099ff, #0066cc)" }}>
                    <span style={{ fontSize: 20 }}>🖥️</span> Screen Only
                  </button>
                  <button onClick={() => startStreamWithOption("both")} style={{ ...btnSt, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "13px 20px", background: "linear-gradient(135deg, #00d4ff, #9900ff)" }}>
                    <span style={{ fontSize: 20 }}>📹🖥️</span> Camera + Screen
                  </button>
                </>
              ) : inWebView && !isIOS ? (
                <button
                  onClick={() => { setShowStreamStartModal(false); postToNative({ type: "open_in_browser_for_screen_share", url: window.location.href }); }}
                  style={{ ...btnSt, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", padding: "13px 20px", background: "linear-gradient(135deg, #1a7f3f, #115c2d)" }}
                >
                  <span style={{ fontSize: 20 }}>🌐</span> Screen Share via Browser
                </button>
              ) : (
                <p style={{ fontSize: 10, color: "#ffaa00", background: "rgba(255,170,0,0.08)", border: "1px solid #ffaa00", borderRadius: 8, padding: "8px 12px", margin: 0 }}>
                  {isIOS ? "⚠️ Screen sharing is not available on iOS." : "⚠️ Screen sharing not supported on this browser."}
                </p>
              )}
              <button onClick={() => setShowStreamStartModal(false)} style={btn2St}>CANCEL</button>
            </ModalBox>
          </ModalOverlay>
        );
      })()}

      {showTeamModal && <ModalOverlay onClose={() => setShowTeamModal(false)}>
        <ModalBox title="👥 TEAM">
          <button onClick={createRoom} style={btnSt}>➕ CREATE ROOM</button>
          <input value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} placeholder="Room code" style={inpSt} />
          <button onClick={joinTeamFromModal} style={btnSt}>🔗 JOIN</button>
          <button onClick={() => setShowTeamModal(false)} style={btn2St}>CLOSE</button>
        </ModalBox>
      </ModalOverlay>}

      {showShareModal && <ModalOverlay onClose={() => setShowShareModal(false)}>
        <ModalBox title="✅ ROOM CREATED">
          <div style={{ fontSize: 34, margin: "10px 0", fontFamily: "monospace", color: "#00d4ff", letterSpacing: 6 }}>{shareCode}</div>
          <p style={{ fontSize: 11, color: "#a0b0d0", margin: "0 0 8px" }}>Share this code — works across 4G ↔ WiFi</p>
          {shareQrDataUrl ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <img src={shareQrDataUrl} alt="Room QR Code" style={{ width: 140, height: 140, borderRadius: 10, border: "2px solid #00d4ff" }} />
              <span style={{ fontSize: 9, color: "#a0b0d0" }}>📱 Scan with NexusCast mobile app</span>
            </div>
          ) : (
            <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: "#a0b0d0" }}>Generating QR code...</span>
            </div>
          )}
          <button onClick={() => { navigator.clipboard.writeText(shareCode); notify("Copied!", "success"); }} style={btnSt}>📋 COPY CODE</button>
          <button onClick={() => setShowShareModal(false)} style={btn2St}>START STREAMING</button>
        </ModalBox>
      </ModalOverlay>}

      {showJoinModal && <ModalOverlay onClose={() => setShowJoinModal(false)}>
        <ModalBox title="🔗 JOIN ROOM">
          <p style={{ fontSize: 11, color: "#a0b0d0" }}>Enter the room code from the host</p>
          <input value={joinCodeInput} onChange={e => setJoinCodeInput(e.target.value.toUpperCase())} placeholder="e.g. ABC123" maxLength={8} style={{ ...inpSt, letterSpacing: 6, fontSize: 20, textAlign: "center" }} onKeyDown={e => e.key === "Enter" && joinTeamFromModal()} />
          <button onClick={joinTeamFromModal} style={btnSt}>JOIN ROOM</button>
          <button onClick={() => setShowJoinModal(false)} style={btn2St}>CANCEL</button>
        </ModalBox>
      </ModalOverlay>}

      {showEditIdModal && <ModalOverlay onClose={() => setShowEditIdModal(false)}>
        <ModalBox title="✏️ EDIT USERNAME">
          <input value={newUserIdInput} onChange={e => setNewUserIdInput(e.target.value)} placeholder="New username" style={inpSt} maxLength={20} />
          <button onClick={saveUserId} style={btnSt}>SAVE</button>
          <button onClick={() => setShowEditIdModal(false)} style={btn2St}>CANCEL</button>
        </ModalBox>
      </ModalOverlay>}

      {showAvatarModal && <ModalOverlay onClose={() => setShowAvatarModal(false)}>
        <ModalBox title="🎭 CHOOSE AVATAR">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, margin: "10px 0" }}>
            {AVATARS.map(av => (
              <div key={av} onClick={() => { setUserAvatar(av); setMembers(p => p.map(m => m.peerId === "me" ? { ...m, avatar: av } : m)); setShowAvatarModal(false); notify("Avatar updated!", "success"); }}
                style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff, #0099ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, cursor: "pointer", margin: "0 auto" }}
              >{av}</div>
            ))}
          </div>
          <button onClick={() => setShowAvatarModal(false)} style={btn2St}>CANCEL</button>
        </ModalBox>
      </ModalOverlay>}

      {showChangeNameModal && <ModalOverlay onClose={() => setShowChangeNameModal(null)}>
        <ModalBox title="✏️ CHANGE MEMBER NAME">
          <p style={{ fontSize: 11, color: "#a0b0d0", margin: "0 0 4px" }}>This nickname is only visible to you.</p>
          <p style={{ fontSize: 10, color: "#ffaa00", margin: "0 0 10px" }}>The member will be notified.</p>
          <input value={changeNameInput} onChange={e => setChangeNameInput(e.target.value)} placeholder="New nickname..." style={inpSt} maxLength={24} autoFocus onKeyDown={e => e.key === "Enter" && saveLocalNickname()} />
          <button onClick={saveLocalNickname} style={btnSt}>SAVE NICKNAME</button>
          <button onClick={() => setShowChangeNameModal(null)} style={btn2St}>CANCEL</button>
        </ModalBox>
      </ModalOverlay>}
    </>
  );

  // Stream notification banner — shows join/skip choice to every member when host goes live
  const streamNotifBanner = joinStreamPrompt && !joinedStreamHostId && (
    <div style={{ position: "fixed", top: isMobile ? 60 : 70, left: isMobile ? 12 : "50%", right: isMobile ? 12 : "auto", transform: isMobile ? "none" : "translateX(-50%)", zIndex: 2500 }}>
      <div style={{ background: "linear-gradient(135deg, #0a0e27ee, #1a2558ee)", padding: "14px 18px", border: "2px solid #ff4444", borderRadius: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 0 36px rgba(255,60,60,0.35)", maxWidth: 440, backdropFilter: "blur(8px)" }}>
        <span style={{ fontSize: 26, animation: "statusBlink 1s infinite" }}>🔴</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#ff4444", fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>HOST IS LIVE!</div>
          <div style={{ color: "#e8f0ff", fontSize: 11, marginTop: 3 }}>
            <strong style={{ color: "#00d4ff" }}>{joinStreamPrompt.hostUserId}</strong> started streaming. Do you want to join?
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <button onClick={requestJoinStream} style={{ padding: "7px 14px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 800 }}>▶ JOIN</button>
          <button onClick={() => setJoinStreamPrompt(null)} style={{ padding: "7px 10px", background: "rgba(255,0,0,0.1)", color: "#ff6666", border: "1px solid #ff4444", borderRadius: 8, cursor: "pointer", fontSize: 11 }}>✖ Skip</button>
        </div>
      </div>
    </div>
  );

  const incomingReqsUI = incomingJoinReqs.length > 0 && (
    <div style={{ position: "fixed", top: isMobile ? 120 : 70, left: isMobile ? 12 : "50%", right: isMobile ? 12 : "auto", transform: isMobile ? "none" : "translateX(-50%)", zIndex: 2500, display: "flex", flexDirection: "column", gap: 8 }}>
      {incomingJoinReqs.map(req => (
        <div key={req.from} style={{ background: "linear-gradient(135deg, #0a0e27, #1a2558)", padding: "12px 18px", border: "2px solid #00d4ff", borderRadius: 12, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 0 30px rgba(0,212,255,0.3)" }}>
          <span style={{ fontSize: 20 }}>{req.avatar}</span>
          <span style={{ color: "#e8f0ff", fontSize: 12 }}><strong style={{ color: "#00d4ff" }}>{req.userId}</strong> wants to join</span>
          <button onClick={() => acceptJoinRequest(req)} style={{ padding: "6px 13px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>ACCEPT</button>
          <button onClick={() => declineJoinRequest(req)} style={{ padding: "6px 13px", background: "rgba(255,0,0,0.1)", color: "#ff6666", border: "1px solid #ff4444", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>DECLINE</button>
        </div>
      ))}
    </div>
  );

  const notificationsUI = (
    <div style={{ position: "fixed", top: 68, right: 18, display: "flex", flexDirection: "column", gap: 6, zIndex: 2100, pointerEvents: "none" }}>
      {notifications.map(n => (
        <div key={n.id} className="notification" style={{
          background: `rgba(${n.type === "success" ? "0,255,0" : n.type === "error" ? "255,0,0" : n.type === "warning" ? "255,170,0" : "0,212,255"},0.12)`,
          color: notifColor(n.type), border: `1px solid ${notifColor(n.type)}`,
        }}>{n.message}</div>
      ))}
    </div>
  );

  // Fix 3: chat popups (WhatsApp-style)
  const chatPopupsUI = (
    <div style={{ position: "fixed", bottom: isMobile ? 70 : 20, left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", gap: 8, zIndex: 3000, pointerEvents: "none", minWidth: 280, maxWidth: "90vw" }}>
      {chatPopups.map(popup => (
        <div key={popup.id} style={{
          background: "rgba(10,14,39,0.97)", border: "2px solid #00d4ff", borderRadius: 12,
          padding: "10px 16px", boxShadow: "0 4px 20px rgba(0,212,255,0.3)",
          animation: "slideIn 0.3s ease",
        }}>
          <div style={{ color: "#0099ff", fontWeight: 700, fontSize: 11 }}>💬 {popup.sender}</div>
          <div style={{ color: "#e8f0ff", fontSize: 12, marginTop: 3 }}>{popup.text}</div>
        </div>
      ))}
    </div>
  );

  // ─── MOBILE LAYOUT ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden", background: "#050915" }}
        onClick={() => { if (openMenuMember) setOpenMenuMember(null); unlockAudio(); }}>

        {/* MOBILE HEADER — hidden inside native app (native wrapper provides its own) */}
        {!_isNativeApp && (
          <header style={{ background: "linear-gradient(90deg, #0a0e27, #1a2558, #0a0e27)", borderBottom: "2px solid #00d4ff", padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, zIndex: 100 }}>
            <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: 3, color: "#00d4ff" }}>⚡ NEXUSCAST</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: isConnected ? (isStreaming ? "#ff0000" : "#00ff00") : "#ff8800", animation: isStreaming ? "statusBlink 1s infinite" : "none" }} />
              <span style={{ fontSize: 10, color: "#00d4ff", fontWeight: 600 }}>{isConnected ? (isStreaming ? "🔴 LIVE" : currentRoom || "ONLINE") : "..."}</span>
              <span style={{ fontSize: 10, color: "#a0b0d0" }}>👥{members.length}</span>
            </div>
          </header>
        )}

        {/* VIDEO AREA */}
        <div style={{ position: "relative", background: "#000", aspectRatio: "16/9", flexShrink: 0, overflow: "hidden" }}>
          <video ref={localCenterRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: isScreenSharing ? "contain" : "cover", display: showLocalCenter ? "block" : "none", background: "#000" }} />
          {showRemoteCenter && (
            focusedStream
              ? <RemoteVideoEl key={focusedStream.peerId} stream={focusedStream.stream} peerId={focusedStream.peerId} videoRefs={remoteVideoRefs} />
              : remoteStreams.length > 0
                ? <RemoteVideoEl key={remoteStreams[0].peerId} stream={remoteStreams[0].stream} peerId={remoteStreams[0].peerId} videoRefs={remoteVideoRefs} />
                : null
          )}
          {!showLocalCenter && !showRemoteCenter && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10 }}>
              {canWatchStream ? (
                <>
                  <div style={{ fontSize: 34, animation: "statusBlink 1.2s infinite" }}>📡</div>
                  <div style={{ fontSize: 12, color: "#ff4444", fontWeight: 700 }}>🔴 {streamingPeer!.userId} is LIVE!</div>
                  <button onClick={() => requestJoinStream(streamingPeer!.peerId)}
                    style={{ padding: "8px 20px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 800 }}>
                    ▶ Watch Stream
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 40, opacity: 0.5 }}>🎮</div>
                  <div style={{ fontSize: 12, color: "#00d4ff" }}>Tap STREAM to go live</div>
                </>
              )}
            </div>
          )}
          {isStreaming && <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(255,0,0,0.25)", padding: "3px 8px", borderRadius: 12, fontSize: 9, fontWeight: 700, color: "#ff4444", border: "1px solid #ff4444", animation: "statusBlink 1s infinite" }}>● LIVE</div>}
          {!audioUnlocked && remoteStreams.length > 0 && (
            <div onClick={unlockAudio} style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,212,255,0.2)", border: "1px solid #00d4ff", borderRadius: 16, padding: "6px 16px", fontSize: 10, color: "#00d4ff" }}>🔊 Tap to enable audio</div>
          )}
          {isWebcamOn && isScreenSharing && (
            <div style={{ position: "absolute", bottom: 8, right: 8, width: 90, height: 68, border: "2px solid #00d4ff", borderRadius: 8, overflow: "hidden" }}>
              <video ref={miniVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          )}
        </div>

        {/* STREAM CONTROLS */}
        <div style={{ background: "rgba(10,14,39,0.95)", borderBottom: "1px solid #004d7f", padding: "10px 12px", display: "flex", gap: 8, justifyContent: "center", flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
          {/* Fix 3: STREAM button only for host */}
          {canStartStream && (
            <button onClick={handleStreamButtonClick} style={{ padding: "10px 18px", borderRadius: 10, border: `2px solid ${isStreaming ? "#ff4444" : "#00d4ff"}`, background: isStreaming ? "rgba(255,0,0,0.2)" : "rgba(0,212,255,0.15)", color: isStreaming ? "#ff6666" : "#00d4ff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              {isStreaming ? "⏹ END" : "▶ STREAM"}
            </button>
          )}
          <button onClick={toggleWebcam} style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${isWebcamOn ? "#00d4ff" : "#334"}`, background: isWebcamOn ? "rgba(0,212,255,0.2)" : "rgba(0,0,0,0.3)", color: isWebcamOn ? "#00d4ff" : "#667", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>📹</button>
          <button onClick={toggleScreenShare} style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${isScreenSharing ? "#00d4ff" : "#334"}`, background: isScreenSharing ? "rgba(0,212,255,0.2)" : "rgba(0,0,0,0.3)", color: isScreenSharing ? "#00d4ff" : "#667", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>🖥️</button>
          {(isStreaming || joinedStreamHostId) && (
            <button onClick={toggleMic} style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${isMuted ? "#ffaa00" : isMicOn ? "#00ff44" : "#334"}`, background: isMuted ? "rgba(255,170,0,0.15)" : isMicOn ? "rgba(0,255,0,0.15)" : "rgba(0,0,0,0.3)", color: isMuted ? "#ffaa00" : isMicOn ? "#00ff44" : "#667", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{isMuted ? "🔇" : isMicOn ? "🎙️" : "🔇"}</button>
          )}
          <div style={{ color: "#00d4ff", fontFamily: "monospace", fontWeight: 700, fontSize: 14 }}>{fmt(streamSec)}</div>
        </div>

        {/* ROOM BAR */}
        <div style={{ background: "rgba(5,9,21,0.9)", borderBottom: "1px solid #004d7f", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: 11, color: currentRoom ? "#00d4ff" : "#a0b0d0", fontFamily: "monospace", fontWeight: 600 }}>{currentRoom ? `🏠 ${currentRoom}` : "No Room"}</div>
          <button onClick={createRoom} style={{ padding: "5px 10px", background: "rgba(0,212,255,0.15)", border: "1px solid #00d4ff", color: "#00d4ff", borderRadius: 7, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>+ NEW</button>
          <button onClick={() => setShowJoinModal(true)} style={{ padding: "5px 10px", background: "rgba(0,212,255,0.15)", border: "1px solid #00d4ff", color: "#00d4ff", borderRadius: 7, fontSize: 10, fontWeight: 600, cursor: "pointer" }}>JOIN</button>
          {currentRoom && <>
            <button onClick={copyRoomCode} style={{ padding: "5px 8px", background: "rgba(0,212,255,0.1)", border: "1px solid #004d7f", color: "#a0b0d0", borderRadius: 7, fontSize: 10, cursor: "pointer" }}>📋</button>
            <button onClick={deleteRoom} style={{ padding: "5px 8px", background: "rgba(255,0,0,0.1)", border: "1px solid #ff4444", color: "#ff6666", borderRadius: 7, fontSize: 10, cursor: "pointer" }}>🚪</button>
          </>}
        </div>

        {/* TAB CONTENT */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {mobileTab === "stream" && (
            <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ ...panelSt, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div onClick={() => setShowAvatarModal(true)} style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff, #0099ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, cursor: "pointer" }}>{userAvatar}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#00d4ff" }}>
                      {userId} {iAmRoomHost ? <span style={{ fontSize: 8, color: "#ffaa00", border: "1px solid #ffaa00", padding: "1px 4px", borderRadius: 3, marginLeft: 3 }}>HOST</span> : null}
                    </div>
                    <div style={{ fontSize: 9, color: isConnected ? "#00ff00" : "#ff8800" }}>{isConnected ? "● Connected" : "⏳ Reconnecting..."}</div>
                  </div>
                  <button onClick={() => { setNewUserIdInput(userId); setShowEditIdModal(true); }} style={{ padding: "4px 8px", background: "rgba(0,212,255,0.15)", border: "1px solid #00d4ff", color: "#00d4ff", borderRadius: 5, fontSize: 9, cursor: "pointer" }}>✏️ Edit</button>
                </div>
              </div>
              <div style={{ ...panelSt, fontSize: 10, color: "#a0b0d0", lineHeight: 1.9 }}>
                <div style={{ color: "#00d4ff", fontWeight: 700, marginBottom: 4, fontSize: 11 }}>📡 HOW TO USE</div>
                <div>• Tap STREAM → choose Camera / Screen / Both</div>
                <div>• Share room code with friends to join</div>
                <div>• Use Chat tab for messages</div>
                <div>• Use Members tab to manage users</div>
              </div>
              {/* multi-stream thumbnail picker removed */}
            </div>
          )}

          {mobileTab === "chat" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div className="chat-messages-scroll" style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                {chatMessages.length === 0
                  ? <div style={{ color: "#a0b0d0", fontSize: 11, textAlign: "center", marginTop: 20, opacity: 0.6 }}>Chat is empty. Say something!</div>
                  : chatMessages.map(msg => (
                    <div key={msg.id} style={{ padding: "8px 12px", background: "rgba(0,99,255,0.1)", borderLeft: "3px solid #00d4ff", borderRadius: 8 }}>
                      <div style={{ color: "#0099ff", fontWeight: 700, fontSize: 10 }}>{msg.sender}:</div>
                      <div style={{ color: "#e8f0ff", marginTop: 2, wordBreak: "break-word", fontSize: 13 }}>{msg.text}</div>
                    </div>
                  ))}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: "flex", overflowX: "auto", gap: 6, padding: "8px 10px", borderTop: "1px solid #004d7f", background: "rgba(0,0,0,0.3)", flexShrink: 0 }}>
                {QUICK_MSGS.map(qm => (
                  <button key={qm.label} onClick={() => quickMsg(qm.text)} style={{ padding: "6px 10px", background: "rgba(0,99,255,0.2)", border: "1px solid #004d7f", color: "#e8f0ff", cursor: "pointer", fontSize: 10, borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>{qm.label}</button>
                ))}
              </div>
              <div style={{ padding: 10, borderTop: "1px solid #004d7f", background: "rgba(5,9,21,0.95)", flexShrink: 0 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg()}
                    placeholder="Message..." style={{ flex: 1, background: "rgba(0,0,0,0.5)", border: "1px solid #004d7f", color: "#00d4ff", padding: "10px 14px", borderRadius: 10, fontSize: 14, outline: "none" }} />
                  <button onClick={sendMsg} style={{ padding: "10px 18px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700 }}>→</button>
                </div>
              </div>
            </div>
          )}

          {mobileTab === "members" && (
            <div className="members-scroll" style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedMembers.length === 0
                ? <div style={{ color: "#a0b0d0", fontSize: 11, textAlign: "center", marginTop: 20, opacity: 0.6 }}>Join a room to see members</div>
                : sortedMembers.map(member => {
                  const isMe = member.peerId === "me";
                  const isHost = isMe ? iAmRoomHost : member.isRoomHost;
                  return (
                    <div key={member.peerId} style={{ background: isMe ? "rgba(0,212,255,0.08)" : "rgba(0,99,255,0.06)", border: `1px solid ${isMe ? "#00d4ff44" : "#004d7f"}`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff, #0099ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, position: "relative" }}>
                        {member.avatar}
                        <div style={{ position: "absolute", bottom: -2, right: -2, width: 9, height: 9, borderRadius: "50%", background: "#00ff00", border: "2px solid #050915" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isMe ? "#00d4ff" : "#e8f0ff" }}>{displayName(member)}</span>
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, fontWeight: 700, background: isHost ? "rgba(255,165,0,0.2)" : "rgba(0,212,255,0.12)", color: isHost ? "#ffaa00" : "#00d4ff", border: `1px solid ${isHost ? "#ffaa00" : "#00d4ff"}` }}>{isHost ? "HOST" : "MBR"}</span>
                          {member.isStreaming && !isMe && <span style={{ fontSize: 9, color: "#ff4444" }}>🔴</span>}
                          {member.isFav && !isMe && <span>❤️</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#00ff00" }}>● online</div>
                      </div>
                      {!isMe && (
                        <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                          <span onClick={() => setOpenMenuMember(openMenuMember === member.peerId ? null : member.peerId)} style={{ cursor: "pointer", fontSize: 20, color: "#00d4ff", padding: "4px 6px", display: "block" }}>⋯</span>
                          {openMenuMember === member.peerId && (
                            <div style={{ position: "absolute", top: "100%", right: 0, background: "linear-gradient(135deg, #0d1435, #1a1f4f)", border: "1px solid #00d4ff", borderRadius: 10, overflow: "hidden", zIndex: 300, minWidth: 160, boxShadow: "0 8px 24px rgba(0,0,0,0.7)" }}>
                              <div onClick={() => toggleFav(member.peerId)} style={{ ...menuItemSt, fontSize: 13 }}>{member.isFav ? "💔 Unfavorite" : "❤️ Favorite"}</div>
                              {/* Fix 4: only host sees mute/kick/rename controls */}
                              {iAmRoomHost && <>
                                <div onClick={() => muteMember(member.peerId)} style={{ ...menuItemSt, fontSize: 13 }}>🔇 Mute (5s)</div>
                                <div onClick={() => openChangeNameModal(member.peerId)} style={{ ...menuItemSt, fontSize: 13 }}>✏️ Change Name</div>
                                <div onClick={() => kickMember(member.peerId)} style={{ ...menuItemSt, fontSize: 13, color: "#ff6666", borderBottom: "none" }}>🚫 Remove</div>
                              </>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* BOTTOM TAB BAR */}
        <div style={{ background: "linear-gradient(90deg, #0a0e27, #1a2558)", borderTop: "2px solid #00d4ff", display: "flex", flexShrink: 0 }}>
          {(["stream", "chat", "members"] as const).map(tab => (
            <button key={tab} onClick={() => setMobileTab(tab)} style={{
              flex: 1, padding: "12px 0", background: mobileTab === tab ? "rgba(0,212,255,0.15)" : "transparent",
              border: "none", color: mobileTab === tab ? "#00d4ff" : "#556", cursor: "pointer",
              fontSize: 10, fontWeight: mobileTab === tab ? 700 : 400, letterSpacing: 1,
              borderTop: mobileTab === tab ? "2px solid #00d4ff" : "2px solid transparent",
            }}>
              {tab === "stream" ? "🎮 STREAM" : tab === "chat" ? `💬 CHAT${chatMessages.length > 0 ? ` (${chatMessages.length})` : ""}` : `👥 (${members.length})`}
            </button>
          ))}
        </div>

        {streamNotifBanner}
        {sharedModals}
        {notificationsUI}
        {chatPopupsUI}
      </div>
    );
  }

  // ─── DESKTOP LAYOUT ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", overflow: "hidden", background: "#050915" }}
      onClick={e => { if (openMenuMember) setOpenMenuMember(null); unlockAudio(); }}>

      {/* HEADER */}
      <header style={{ background: "linear-gradient(90deg, #0a0e27 0%, #1a2558 50%, #0a0e27 100%)", borderBottom: "3px solid #00d4ff", display: "flex", alignItems: "center", padding: "0 24px", justifyContent: "space-between", height: 58, flexShrink: 0, boxShadow: "0 0 40px rgba(0,212,255,0.3)", zIndex: 100 }}>
        <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 4, color: "#00d4ff" }}>
          <span className="bounce-pulse">⚡</span> NEXUSCAST <span className="bounce-pulse" style={{ animationDelay: ".5s" }}>⚡</span>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 11, fontWeight: 600, color: "#00d4ff", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isConnected ? (isStreaming ? "#ff0000" : "#00ff00") : "#ff8800", boxShadow: `0 0 8px ${isConnected ? (isStreaming ? "#ff0000" : "#00ff00") : "#ff8800"}`, animation: isStreaming ? "statusBlink 1s infinite" : "none" }} />
            <span>{isConnected ? (isStreaming ? "🔴 LIVE" : currentRoom ? `ROOM: ${currentRoom}` : "ONLINE") : "RECONNECTING..."}</span>
          </div>
          <span>👥 {members.length}</span>
        </div>
      </header>

      {/* MAIN */}
      <div style={{ display: "flex", flex: 1, gap: 10, padding: 10, overflow: "hidden", minHeight: 0 }}>

        {/* LEFT PANEL */}
        <div style={{ width: 270, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0, overflowY: "auto" }}>
          <div style={panelSt}>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {[
                // Fix 3: STREAM button only visible to host (canStartStream)
                ...(canStartStream ? [{ icon: isStreaming ? "⏹" : "▶", label: "STREAM", active: isStreaming, onClick: handleStreamButtonClick, color: isStreaming ? "#ff4444" : "#00d4ff" }] : []),
                { icon: "📹", label: "CAMERA", active: isWebcamOn, onClick: toggleWebcam, color: "#00d4ff" },
                { icon: "🖥️", label: "SCREEN", active: isScreenSharing, onClick: toggleScreenShare, color: "#00d4ff" },
                { icon: "👥", label: "TEAM", active: false, onClick: () => setShowTeamModal(true), color: "#00d4ff" },
              ].map(btn => (
                <div key={btn.label} onClick={btn.onClick} title={btn.label} style={{ width: 56, height: 56, borderRadius: "50%", cursor: "pointer", userSelect: "none", background: btn.active ? `linear-gradient(135deg, ${btn.color}, ${btn.color}aa)` : "rgba(0,212,255,0.1)", border: `2px solid ${btn.color}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: btn.active ? `0 0 28px ${btn.color}88` : `0 0 6px ${btn.color}22`, transition: "all .3s" }}>
                  <div style={{ fontSize: 20 }}>{btn.icon}</div>
                  <div style={{ fontSize: 7, marginTop: 2, fontWeight: 700, color: btn.active ? "#0a0e27" : btn.color }}>{btn.label}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 10, padding: 8, background: "rgba(0,0,0,0.4)", borderRadius: 10, border: "1px solid #004d7f" }}>
              <div style={{ fontSize: 9, color: "#a0b0d0", letterSpacing: 1 }}>⏱️ STREAM DURATION</div>
              <div className="timer-pulse" style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace", color: "#00d4ff" }}>{fmt(streamSec)}</div>
            </div>
            {isStreaming && (
              <button onClick={endStreamOnly} style={{ marginTop: 8, width: "100%", padding: 7, background: "rgba(255,0,0,0.15)", border: "1px solid #ff4444", color: "#ff6666", cursor: "pointer", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>⏹️ END STREAM</button>
            )}
          </div>

          {(isStreaming || joinedStreamHostId !== null) && (
            <div style={panelSt}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff", marginBottom: 8 }}>🎙️ MICROPHONE</div>
              <div onClick={toggleMic} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 0", borderRadius: 12, cursor: isMuted ? "not-allowed" : "pointer", background: isMuted ? "rgba(255,170,0,0.1)" : isMicOn ? "linear-gradient(135deg, rgba(0,255,0,0.18), rgba(0,200,0,0.12))" : "rgba(0,0,0,0.3)", border: `2px solid ${isMuted ? "#ffaa00" : isMicOn ? "#00ff44" : "#555"}`, boxShadow: isMicOn ? "0 0 18px rgba(0,255,0,0.25)" : "none", transition: "all .3s" }}>
                <span style={{ fontSize: 24 }}>{isMuted ? "🔇" : isMicOn ? "🎙️" : "🔇"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: isMuted ? "#ffaa00" : isMicOn ? "#00ff44" : "#888" }}>{isMuted ? "MUTED BY HOST" : isMicOn ? "MIC ON — tap to mute" : "MIC OFF — tap to talk"}</span>
              </div>
            </div>
          )}

          <div style={panelSt}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff", marginBottom: 8 }}>🎮 ROOM CONTROLS</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={createRoom} style={roomBtnSt}>➕ CREATE</button>
              <button onClick={() => setShowJoinModal(true)} style={roomBtnSt}>🔗 JOIN</button>
            </div>
            <div style={{ background: "rgba(0,0,0,0.5)", padding: 8, borderRadius: 8, fontSize: 11, textAlign: "center", fontFamily: "monospace", letterSpacing: 1, color: currentRoom ? "#00d4ff" : "#a0b0d0", marginBottom: 8 }}>
              {currentRoom ? `🏠 ROOM: ${currentRoom}` : "No Active Room"}
            </div>
            {currentRoom && (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={copyRoomCode} style={{ ...roomBtnSt, fontSize: 10 }}>📋 COPY</button>
                <button onClick={deleteRoom} style={{ ...roomBtnSt, border: "1px solid #ff4444", color: "#ff6666", background: "rgba(255,0,0,0.1)", fontSize: 10 }}>🚪 LEAVE</button>
              </div>
            )}
          </div>

          <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid #004d7f", borderRadius: 10, padding: 10, fontSize: 9, color: "#a0b0d0", lineHeight: 1.7 }}>
            <div style={{ color: "#00d4ff", fontWeight: 700, marginBottom: 4 }}>📡 QUICK GUIDE</div>
            <div>• STREAM → choose Camera / Screen / Both</div>
            <div>• Camera/Screen OFF won't end stream</div>
            <div>• Members get notified when stream starts</div>
            <div>• Works 4G ↔ WiFi via TURN</div>
            <div style={{ marginTop: 6, color: isConnected ? "#00ff44" : "#ff8800", fontWeight: 600 }}>{isConnected ? "✅ Server connected" : "⏳ Reconnecting..."}</div>
          </div>
        </div>

        {/* CENTER VIDEO */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ flex: 1, position: "relative", borderRadius: 16, overflow: "hidden", border: `3px solid ${isStreaming ? "#ff0000" : "#00d4ff"}`, background: "#000", boxShadow: isStreaming ? "0 0 40px rgba(255,0,0,0.3)" : "0 0 20px rgba(0,212,255,0.2)", transition: "all .3s" }}>
            <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,14,39,0.85)", padding: "3px 10px", borderRadius: 16, fontSize: 10, fontWeight: 600, color: "#00d4ff", border: "1px solid #004d7f", zIndex: 15 }}>
              {isScreenSharing ? "🖥️ SCREEN SHARE" : isStreaming ? "🔴 LIVE STREAM" : "🎥 STREAM"}
            </div>
            {isStreaming && <div style={{ position: "absolute", top: 10, right: 10, background: "rgba(255,0,0,0.25)", padding: "3px 10px", borderRadius: 16, fontSize: 10, fontWeight: 700, color: "#ff4444", border: "1px solid #ff4444", animation: "statusBlink 1s infinite", zIndex: 15 }}>● LIVE</div>}

            <video ref={localCenterRef} autoPlay muted playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: isScreenSharing ? "contain" : "cover", display: showLocalCenter ? "block" : "none", background: "#000" }} />

            {showRemoteCenter && (
              focusedStream
                ? <RemoteVideoEl key={focusedStream.peerId} stream={focusedStream.stream} peerId={focusedStream.peerId} videoRefs={remoteVideoRefs} />
                : remoteStreams.length > 0
                  ? <RemoteVideoEl key={remoteStreams[0].peerId} stream={remoteStreams[0].stream} peerId={remoteStreams[0].peerId} videoRefs={remoteVideoRefs} />
                  : null
            )}

            {!audioUnlocked && remoteStreams.length > 0 && (
              <div onClick={unlockAudio} style={{ position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)", background: "rgba(0,212,255,0.2)", border: "1px solid #00d4ff", borderRadius: 20, padding: "8px 20px", cursor: "pointer", fontSize: 11, color: "#00d4ff", zIndex: 20 }}>🔊 Click to enable audio</div>
            )}

            {!showLocalCenter && !showRemoteCenter && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
                {canWatchStream ? (
                  <>
                    <div style={{ fontSize: 48, animation: "statusBlink 1.2s infinite" }}>📡</div>
                    <h3 style={{ fontSize: 15, color: "#ff4444", margin: 0 }}>🔴 {streamingPeer!.userId} is LIVE!</h3>
                    <p style={{ fontSize: 11, color: "#a0b0d0", maxWidth: 280, margin: 0 }}>The host started streaming. Join to watch!</p>
                    <button onClick={() => requestJoinStream(streamingPeer!.peerId)}
                      style={{ padding: "11px 28px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 800, boxShadow: "0 0 20px rgba(0,212,255,0.4)" }}>
                      ▶ Watch Stream
                    </button>
                  </>
                ) : (
                  <>
                    <div className="bounce-pulse" style={{ fontSize: 56, opacity: 0.5 }}>🎮</div>
                    <h3 style={{ fontSize: 15, color: "#00d4ff" }}>Ready to Stream</h3>
                    <p style={{ fontSize: 11, color: "#a0b0d0", maxWidth: 280 }}>Click <strong style={{ color: "#00d4ff" }}>STREAM</strong> to go live · <strong style={{ color: "#00d4ff" }}>SCREEN</strong> to share your screen</p>
                  </>
                )}
              </div>
            )}

            {/* thumbnail picker removed — single main view only */}
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={{ width: 330, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ ...panelSt, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div onClick={() => setShowAvatarModal(true)} style={{ width: 42, height: 42, borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff, #0099ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, cursor: "pointer", flexShrink: 0 }}>{userAvatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#00d4ff" }}>You {iAmRoomHost ? <span style={{ fontSize: 9, background: "rgba(255,165,0,0.2)", color: "#ffaa00", border: "1px solid #ffaa00", padding: "1px 5px", borderRadius: 4, marginLeft: 4 }}>HOST</span> : null}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: "#a0b0d0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userId}</span>
                  <button onClick={() => { setNewUserIdInput(userId); setShowEditIdModal(true); }} style={{ padding: "2px 7px", background: "rgba(0,212,255,0.15)", border: "1px solid #00d4ff", color: "#00d4ff", cursor: "pointer", borderRadius: 4, fontSize: 8, flexShrink: 0 }}>✏️</button>
                </div>
              </div>
              <div style={{ fontSize: 9, padding: "3px 7px", background: isConnected ? "rgba(0,255,0,0.1)" : "rgba(255,128,0,0.1)", border: `1px solid ${isConnected ? "#00ff00" : "#ff8800"}`, color: isConnected ? "#00ff00" : "#ff8800", borderRadius: 8, fontWeight: 700, flexShrink: 0 }}>{isConnected ? "● ON" : "⏳"}</div>
            </div>
          </div>

          <div style={{ flex: 2, ...panelSt, padding: 0, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <div style={{ padding: "8px 12px", background: "linear-gradient(90deg, rgba(0,212,255,0.1), transparent)", borderBottom: "1px solid #004d7f", flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff" }}>💬 LIVE CHAT</span>
            </div>
            <div className="chat-messages-scroll" style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 5, minHeight: 0 }}>
              {chatMessages.length === 0
                ? <div style={{ color: "#a0b0d0", fontSize: 10, textAlign: "center", marginTop: 16, opacity: .5 }}>Chat is empty. Say something!</div>
                : chatMessages.map(msg => (
                  <div key={msg.id} style={{ padding: "5px 8px", background: "rgba(0,99,255,0.1)", borderLeft: "3px solid #00d4ff", borderRadius: 6 }}>
                    <div style={{ color: "#0099ff", fontWeight: 700, fontSize: 9 }}>{msg.sender}:</div>
                    <div style={{ color: "#e8f0ff", marginTop: 2, wordBreak: "break-word", fontSize: 11 }}>{msg.text}</div>
                  </div>
                ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, padding: "6px 8px", borderTop: "1px solid #004d7f", background: "rgba(0,0,0,0.2)", flexShrink: 0 }}>
              {QUICK_MSGS.map(qm => (
                <button key={qm.label} onClick={() => quickMsg(qm.text)} style={{ padding: 4, background: "rgba(0,99,255,0.15)", border: "1px solid #004d7f", color: "#e8f0ff", cursor: "pointer", fontSize: 9, borderRadius: 5 }}>{qm.label}</button>
              ))}
            </div>
            <div style={{ padding: 8, borderTop: "1px solid #004d7f", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMsg()} placeholder="Type message..." style={{ flex: 1, background: "rgba(0,0,0,0.5)", border: "1px solid #004d7f", color: "#00d4ff", padding: "7px 10px", borderRadius: 7, fontSize: 11, outline: "none" }} />
                <button onClick={sendMsg} style={{ padding: "7px 12px", background: "linear-gradient(135deg, rgba(0,212,255,0.2), rgba(0,99,255,0.2))", border: "1px solid #00d4ff", color: "#00d4ff", cursor: "pointer", borderRadius: 7, fontSize: 11 }}>→</button>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, ...panelSt, padding: 0, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 160 }}>
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #004d7f", flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#00d4ff" }}>👥 MEMBERS ({members.length})</span>
            </div>
            <div className="members-scroll" style={{ flex: 1, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {sortedMembers.length === 0
                ? <div style={{ color: "#a0b0d0", fontSize: 10, textAlign: "center", marginTop: 10, opacity: .5 }}>Join a room to see members</div>
                : sortedMembers.map(member => {
                  const isMe = member.peerId === "me";
                  const isHost = isMe ? iAmRoomHost : member.isRoomHost;
                  return (
                    <div key={member.peerId} style={{ background: isMe ? "linear-gradient(135deg, rgba(0,212,255,0.12), rgba(0,99,255,0.08))" : "rgba(0,99,255,0.07)", border: `1px solid ${isMe ? "#00d4ff44" : "#004d7f"}`, borderRadius: 8, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff, #0099ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, position: "relative" }}>
                        {member.avatar}
                        <div style={{ position: "absolute", bottom: -2, right: -2, width: 9, height: 9, borderRadius: "50%", background: "#00ff00", border: "2px solid #050915" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: isMe ? "#00d4ff" : "#e8f0ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{displayName(member)}</span>
                          <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 4, fontWeight: 700, background: isHost ? "rgba(255,165,0,0.2)" : "rgba(0,212,255,0.12)", color: isHost ? "#ffaa00" : "#00d4ff", border: `1px solid ${isHost ? "#ffaa00" : "#00d4ff"}` }}>{isHost ? "HOST" : "MEMBER"}</span>
                          {member.isFav && !isMe && <span style={{ color: "#ff3366", fontSize: 11 }}>❤️</span>}
                          {member.isStreaming && !isMe && <span style={{ fontSize: 8, background: "rgba(255,0,0,0.2)", color: "#ff4444", border: "1px solid #ff4444", padding: "1px 4px", borderRadius: 4, fontWeight: 700 }}>🔴</span>}
                          {localNicknames[member.peerId] && <span style={{ fontSize: 7, color: "#ffaa00", opacity: 0.7 }}>(renamed)</span>}
                        </div>
                        <div style={{ fontSize: 8, color: "#00ff00" }}>● online</div>
                      </div>
                      {!isMe && (
                        <div style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <span onClick={() => setOpenMenuMember(openMenuMember === member.peerId ? null : member.peerId)} style={{ cursor: "pointer", fontSize: 16, opacity: .7, padding: "4px 6px", display: "block", color: "#00d4ff" }}>⋯</span>
                          {openMenuMember === member.peerId && (
                            <div style={{ position: "absolute", top: "100%", right: 0, background: "linear-gradient(135deg, #0d1435, #1a1f4f)", border: "1px solid #00d4ff", borderRadius: 10, overflow: "hidden", zIndex: 300, minWidth: 155, boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
                              <div onClick={() => toggleFav(member.peerId)} style={menuItemSt}>{member.isFav ? "💔 Unfavorite" : "❤️ Favorite"}</div>
                              {/* Fix 4: only host sees mute/kick/rename on desktop */}
                              {iAmRoomHost && <>
                                <div onClick={() => muteMember(member.peerId)} style={menuItemSt}>🔇 Mute (5s)</div>
                                <div onClick={() => openChangeNameModal(member.peerId)} style={menuItemSt}>✏️ Change Name</div>
                                <div onClick={() => kickMember(member.peerId)} style={{ ...menuItemSt, color: "#ff6666", borderBottom: "none" }}>🚫 Remove</div>
                              </>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* DRAGGABLE MINI WEBCAM — only visible when screen sharing is active */}
      {isWebcamOn && isScreenSharing && (
        <div ref={miniPlayerRef} style={{ ...miniStyle, width: 200, height: 155, background: "#0a0e27", border: "2px solid #00d4ff", borderRadius: 12, overflow: "hidden", boxShadow: "0 0 20px rgba(0,212,255,0.4)", userSelect: "none", zIndex: 900 }}>
          <div onPointerDown={onMiniPointerDown} onPointerMove={onMiniPointerMove} onPointerUp={onMiniPointerUp} style={{ background: "rgba(0,212,255,0.15)", padding: "4px 8px", borderBottom: "1px solid #00d4ff", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "#00d4ff", cursor: "grab" }}>
            <span>⠿ 📹 YOUR CAM</span>
            <span style={{ fontSize: 7, opacity: 0.6 }}>drag to move</span>
          </div>
          <video ref={miniVideoRef} autoPlay muted playsInline style={{ width: "100%", height: "calc(100% - 26px)", objectFit: "cover", background: "#000", display: "block" }} />
        </div>
      )}

      {streamNotifBanner}
      {sharedModals}
      {notificationsUI}
      {chatPopupsUI}
    </div>
  );
}

function RemoteVideoEl({ stream, peerId, videoRefs, small }: { stream: MediaStream; peerId: string; videoRefs: React.MutableRefObject<Map<string, HTMLVideoElement>>; small?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    videoRefs.current.set(peerId, ref.current);
    if (ref.current.srcObject !== stream) { ref.current.srcObject = stream; ref.current.play().catch(() => {}); }
    return () => { videoRefs.current.delete(peerId); };
  }, [stream, peerId]);
  return <video ref={ref} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: small ? "cover" : "contain", position: small ? "relative" : "absolute", inset: 0, background: "#000" }} />;
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", zIndex: 2000, inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function ModalBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "linear-gradient(135deg, #0a0e27, #1a2558)", padding: 24, border: "2px solid #00d4ff", borderRadius: 18, minWidth: 300, maxWidth: "90vw", textAlign: "center", boxShadow: "0 0 60px rgba(0,212,255,0.3)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#00d4ff", marginBottom: 14 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

const panelSt: React.CSSProperties = { background: "linear-gradient(135deg, rgba(10,14,39,0.7), rgba(26,31,79,0.6))", border: "1px solid #00d4ff22", borderRadius: 14, padding: 12 };
const btnSt: React.CSSProperties = { padding: "9px 20px", background: "linear-gradient(135deg, #00d4ff, #0099ff)", color: "#0a0e27", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 };
const btn2St: React.CSSProperties = { padding: "9px 20px", background: "rgba(0,212,255,0.1)", color: "#00d4ff", border: "1px solid #00d4ff", borderRadius: 8, cursor: "pointer", fontSize: 12 };
const inpSt: React.CSSProperties = { background: "rgba(0,0,0,0.5)", border: "1px solid #004d7f", color: "#00d4ff", padding: 10, borderRadius: 8, width: "100%", fontSize: 13, outline: "none", fontFamily: "monospace", boxSizing: "border-box" };
const roomBtnSt: React.CSSProperties = { flex: 1, padding: 8, background: "rgba(0,212,255,0.1)", border: "1px solid #00d4ff", color: "#00d4ff", cursor: "pointer", borderRadius: 8, fontSize: 11, fontWeight: 600 };
const menuItemSt: React.CSSProperties = { padding: "9px 14px", fontSize: 11, cursor: "pointer", color: "#e8f0ff", borderBottom: "1px solid rgba(0,212,255,0.12)" };
