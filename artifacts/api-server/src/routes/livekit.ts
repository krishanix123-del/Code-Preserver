import { Router, type IRouter } from "express";
import { AccessToken } from "livekit-server-sdk";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const apiKey = process.env["LIVEKIT_API_KEY"];
const apiSecret = process.env["LIVEKIT_API_SECRET"];
const livekitUrl = process.env["LIVEKIT_URL"];

router.get("/livekit/config", (_req, res) => {
  if (!livekitUrl) {
    res.status(500).json({ error: "LIVEKIT_URL not configured" });
    return;
  }
  res.json({ url: livekitUrl });
});

router.get("/livekit/token", async (req, res) => {
  if (!apiKey || !apiSecret || !livekitUrl) {
    logger.error("LiveKit credentials missing");
    res.status(500).json({ error: "LiveKit not configured on server" });
    return;
  }

  const room = String(req.query["room"] ?? "").trim().toUpperCase();
  const identity = String(req.query["identity"] ?? "").trim();
  const name = String(req.query["name"] ?? identity).trim();

  if (!room || room.length < 4) {
    res.status(400).json({ error: "Invalid room code" });
    return;
  }
  if (!identity) {
    res.status(400).json({ error: "Invalid identity" });
    return;
  }

  try {
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: 60 * 60 * 6,
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    res.json({ token, url: livekitUrl, room, identity });
  } catch (err) {
    logger.error({ err }, "Failed to mint LiveKit token");
    res.status(500).json({ error: "Failed to mint token" });
  }
});

export default router;
