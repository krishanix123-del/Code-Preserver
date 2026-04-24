import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  VideoPresets,
  ScreenSharePresets,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

export type RemoteSource = "camera" | "screen";

export interface RemoteVideoTrack {
  identity: string;
  source: RemoteSource;
  stream: MediaStream;
}

export interface ConnectParams {
  roomCode: string;
  identity: string;
  name?: string;
}

export function useLiveKit() {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteVideos, setRemoteVideos] = useState<RemoteVideoTrack[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenOn, setIsScreenOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);

  const updateLocalStreams = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setLocalCameraStream(null);
      setLocalScreenStream(null);
      setIsCameraOn(false);
      setIsScreenOn(false);
      setIsMicOn(false);
      return;
    }
    const local = room.localParticipant;
    let camStream: MediaStream | null = null;
    let scrStream: MediaStream | null = null;

    local.videoTrackPublications.forEach((pub) => {
      const t = pub.videoTrack;
      const mst = t?.mediaStreamTrack;
      if (!mst) return;
      if (pub.source === Track.Source.Camera) {
        camStream = new MediaStream([mst]);
      } else if (pub.source === Track.Source.ScreenShare) {
        scrStream = new MediaStream([mst]);
      }
    });

    setLocalCameraStream(camStream);
    setLocalScreenStream(scrStream);
    setIsCameraOn(local.isCameraEnabled);
    setIsScreenOn(local.isScreenShareEnabled);
    setIsMicOn(local.isMicrophoneEnabled);
  }, []);

  const handleTrackSubscribed = useCallback(
    (
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      const source: RemoteSource =
        track.source === Track.Source.ScreenShare ? "screen" : "camera";
      const mst = track.mediaStreamTrack;
      if (!mst) return;
      const stream = new MediaStream([mst]);
      setRemoteVideos((prev) => {
        const filtered = prev.filter(
          (r) => !(r.identity === participant.identity && r.source === source),
        );
        return [...filtered, { identity: participant.identity, source, stream }];
      });
    },
    [],
  );

  const handleTrackUnsubscribed = useCallback(
    (
      track: RemoteTrack,
      _pub: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Video) return;
      const source: RemoteSource =
        track.source === Track.Source.ScreenShare ? "screen" : "camera";
      setRemoteVideos((prev) =>
        prev.filter(
          (r) => !(r.identity === participant.identity && r.source === source),
        ),
      );
    },
    [],
  );

  const handleParticipantDisconnected = useCallback(
    (participant: RemoteParticipant) => {
      setRemoteVideos((prev) =>
        prev.filter((r) => r.identity !== participant.identity),
      );
    },
    [],
  );

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect();
      } catch {}
    }
    setConnected(false);
    setLocalCameraStream(null);
    setLocalScreenStream(null);
    setIsCameraOn(false);
    setIsScreenOn(false);
    setIsMicOn(false);
    setRemoteVideos([]);
  }, []);

  const connect = useCallback(
    async (params: ConnectParams) => {
      if (roomRef.current) await disconnect();

      const tokenRes = await fetch(
        `/api/livekit/token?room=${encodeURIComponent(params.roomCode)}&identity=${encodeURIComponent(params.identity)}&name=${encodeURIComponent(params.name ?? params.identity)}`,
      );
      if (!tokenRes.ok) {
        throw new Error(`LiveKit token fetch failed (${tokenRes.status})`);
      }
      const { token, url } = (await tokenRes.json()) as {
        token: string;
        url: string;
      };

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
          screenShareSimulcastLayers: [
            ScreenSharePresets.h720fps15,
            ScreenSharePresets.h1080fps15,
          ],
          videoCodec: "vp8",
          dtx: true,
          red: true,
        },
      });

      room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
      room.on(RoomEvent.LocalTrackPublished, updateLocalStreams);
      room.on(RoomEvent.LocalTrackUnpublished, updateLocalStreams);
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        setConnected(state === ConnectionState.Connected);
      });
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setRemoteVideos([]);
        setLocalCameraStream(null);
        setLocalScreenStream(null);
        setIsCameraOn(false);
        setIsScreenOn(false);
        setIsMicOn(false);
      });

      await room.connect(url, token, { autoSubscribe: true });
      roomRef.current = room;
      setConnected(true);

      // Hydrate already-subscribed tracks (if any)
      room.remoteParticipants.forEach((p) => {
        p.videoTrackPublications.forEach((pub) => {
          if (pub.track) handleTrackSubscribed(pub.track, pub, p);
        });
      });

      return room;
    },
    [
      disconnect,
      handleTrackSubscribed,
      handleTrackUnsubscribed,
      handleParticipantDisconnected,
      updateLocalStreams,
    ],
  );

  const setCamera = useCallback(
    async (on: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      try {
        await room.localParticipant.setCameraEnabled(
          on,
          on
            ? {
                resolution: isMob ? VideoPresets.h360 : VideoPresets.h720,
                facingMode: "user",
              }
            : undefined,
        );
      } catch (e) {
        console.error("setCamera error", e);
        throw e;
      }
      updateLocalStreams();
    },
    [updateLocalStreams],
  );

  const setScreen = useCallback(
    async (on: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.localParticipant.setScreenShareEnabled(
          on,
          on
            ? {
                resolution: ScreenSharePresets.h1080fps15,
                audio: true,
                contentHint: "detail",
              }
            : undefined,
        );
      } catch (e) {
        console.error("setScreen error", e);
        throw e;
      }
      updateLocalStreams();
    },
    [updateLocalStreams],
  );

  const setMic = useCallback(
    async (on: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      try {
        await room.localParticipant.setMicrophoneEnabled(on);
      } catch (e) {
        console.error("setMic error", e);
        throw e;
      }
      updateLocalStreams();
    },
    [updateLocalStreams],
  );

  useEffect(() => {
    return () => {
      const r = roomRef.current;
      roomRef.current = null;
      if (r) {
        r.disconnect().catch(() => {});
      }
    };
  }, []);

  return {
    connect,
    disconnect,
    setCamera,
    setScreen,
    setMic,
    connected,
    localCameraStream,
    localScreenStream,
    remoteVideos,
    isCameraOn,
    isScreenOn,
    isMicOn,
  };
}
