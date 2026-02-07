import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { readFile, mkdir, stat } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { analyzeVideo } from "../../video-analyzer/index.js";
import { createChildLogger } from "../../utils/logger.js";
import { createJob, updateJob, getJob, getJobWorkspacePath } from "../jobStore.js";

const log = createChildLogger({ agent: "api:video-analyzer" });

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? path.join(process.cwd(), "workspace");

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(WORKSPACE_ROOT, "uploads");
    await mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "video/mp4", "video/avi", "video/quicktime", "video/x-msvideo",
      "video/x-matroska", "video/webm", "video/mpeg",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported video type: ${file.mimetype}`));
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

const router = Router();

// POST /api/video-analyzer/upload
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: "No video file provided" });
      return;
    }

    const jobId = uuidv4();
    const jobWorkspace = getJobWorkspacePath(jobId);
    await mkdir(jobWorkspace, { recursive: true });

    const videoPath = req.file.path;

    // Parse optional query params
    const nClusters = req.query.nClusters ? parseInt(req.query.nClusters as string, 10) : undefined;
    const dbscanEps = req.query.dbscanEps ? parseFloat(req.query.dbscanEps as string) : undefined;
    const lang = (req.query.lang as string) ?? "eng";
    const workers = req.query.workers ? parseInt(req.query.workers as string, 10) : 4;

    log.info("Video analyzer job started", { jobId, videoPath, nClusters, dbscanEps, lang, workers });

    await createJob(jobId, "video-analyzer");

    // Return job ID immediately
    res.json({
      success: true,
      data: { jobId, status: "processing" },
    });

    // Run analysis in background
    (async () => {
      try {
        const result = await analyzeVideo({
          videoPath,
          nClusters,
          dbscanEps,
          lang,
          workers,
        });

        await updateJob(jobId, {
          status: "completed",
          videoResult: {
            totalFrames: result.totalFrames,
            fps: result.fps,
            groups: result.groups.map((g) => ({
              groupIndex: g.groupIndex,
              frameCount: g.frameCount,
              representativeFrame: g.representativeFrame,
              timeRange: g.timeRange,
              frameNumbers: g.frames.map((f) => f.frameNumber),
            })),
          },
        });

        log.info("Video analyzer job completed", {
          jobId,
          totalFrames: result.totalFrames,
          groups: result.groups.length,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Video analyzer job failed", { jobId, error: message });
        await updateJob(jobId, {
          status: "failed",
          error: message,
        });
      }
    })();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Upload error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/video-analyzer/result/:id
router.get("/result/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const job = await getJob(id);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    if (job.status === "processing") {
      res.json({ success: true, data: { status: "processing" } });
      return;
    }

    if (job.status === "failed") {
      res.json({ success: false, error: job.error ?? "Job failed" });
      return;
    }

    if (!job.videoResult) {
      res.json({ success: true, data: { status: "completed", totalFrames: 0, fps: 0, groups: [] } });
      return;
    }

    // Build response with base64-encoded representative frames
    const groups = [];
    for (const group of job.videoResult.groups) {
      let representativeImage: string | null = null;
      try {
        const imgBuffer = await readFile(group.representativeFrame);
        representativeImage = imgBuffer.toString("base64");
      } catch {
        log.warn("Could not read representative frame", {
          path: group.representativeFrame,
        });
      }

      groups.push({
        groupIndex: group.groupIndex,
        frameCount: group.frameCount,
        representativeImage,
        timeRange: group.timeRange,
        frameNumbers: group.frameNumbers,
      });
    }

    res.json({
      success: true,
      data: {
        status: "completed",
        totalFrames: job.videoResult.totalFrames,
        fps: job.videoResult.fps,
        groups,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Result fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/video-analyzer/result/:id/frame/:groupIndex
router.get("/result/:id/frame/:groupIndex", async (req: Request<{ id: string; groupIndex: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const groupIndex = req.params.groupIndex;
    const job = await getJob(id);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    if (job.status !== "completed" || !job.videoResult) {
      res.status(400).json({ success: false, error: "Job not completed yet" });
      return;
    }

    const idx = parseInt(groupIndex, 10);
    const group = job.videoResult.groups.find((g) => g.groupIndex === idx);

    if (!group) {
      res.status(404).json({ success: false, error: `Group ${groupIndex} not found` });
      return;
    }

    try {
      await stat(group.representativeFrame);
    } catch {
      res.status(404).json({ success: false, error: "Frame image not found" });
      return;
    }

    res.sendFile(group.representativeFrame);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Frame fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
