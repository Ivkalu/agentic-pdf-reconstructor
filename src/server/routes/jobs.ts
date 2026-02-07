import { Router, Request, Response } from "express";
import { listJobs } from "../jobStore.js";
import { createChildLogger } from "../../utils/logger.js";

const log = createChildLogger({ agent: "api:jobs" });

const router = Router();

// GET /api/jobs — list all jobs
router.get("/", async (_req: Request, res: Response) => {
  try {
    const jobs = await listJobs();
    res.json({ success: true, data: jobs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Failed to list jobs", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
