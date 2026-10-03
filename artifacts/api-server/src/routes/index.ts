import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vercelSandboxesRouter from "./vercel-sandboxes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vercelSandboxesRouter);

export default router;
