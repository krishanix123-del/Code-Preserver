import { Router } from "express";
import { AccessToken } from "livekit-server-sdk";

const router = Router();

router.post("/livekit/token", async (req, res) => {
  const { roomName, participantName } = req.body as { roomName?: string; participantName?: string };

  if (!roomName || !participantName) {
    res.status(400).json({ error: "roomName and participantName are required" });
    return;
  }

  const apiKey = process.env["LIVEKIT_API_KEY"];
  const apiSecret = process.env["LIVEKIT_API_SECRET"];

  if (!apiKey || !apiSecret) {
    res.status(500).json({ error: "LiveKit credentials not configured" });
    return;
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantName,
    ttl: "6h",
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  res.json({ token, livekitUrl: process.env["LIVEKIT_URL"] });
});

export default router;
