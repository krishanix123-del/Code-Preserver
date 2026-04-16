import { Router, type IRouter } from "express";
import healthRouter from "./health";
import livekitRouter from "./livekit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(livekitRouter);

export default router;
