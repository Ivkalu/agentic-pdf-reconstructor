import { Router, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { runGraph } from "../../graph/index.js";
import { createWriteLatexTool } from "../../tools/writeLatex.js";
import { createReadLatexTool } from "../../tools/readLatex.js";
import { createCompilePdfTool } from "../../tools/compilePdf.js";
import { createVerifyPdfTool } from "../../tools/verifyPdf.js";
import { createDoneTool } from "../../tools/done.js";
import { createChildLogger } from "../../utils/logger.js";
import { createJob, updateJob, getJob, getJobWorkspacePath, appendChatMessage } from "../jobStore.js";
import type { ToolConfig } from "../../types.js";

const log = createChildLogger({ agent: "api:pdf-reconstruction" });

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? path.join(process.cwd(), "workspace");

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return mimeTypes[ext] ?? "image/png";
}

// Configure multer for image uploads
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
    const allowedMimes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype}`));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const router = Router();

// POST /api/pdf-reconstruction/upload
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: "No image file provided" });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (!apiKey) {
      res.status(500).json({ success: false, error: "ANTHROPIC_API_KEY not configured" });
      return;
    }

    const jobId = uuidv4();
    const jobWorkspace = getJobWorkspacePath(jobId);
    await mkdir(jobWorkspace, { recursive: true });

    const imagePath = req.file.path;
    const imageMimeType = getMimeType(imagePath);

    log.info("PDF reconstruction job started", { jobId, imagePath });

    await createJob(jobId, "pdf-reconstruction");

    // Return the job ID immediately, process in background
    res.json({
      success: true,
      data: { jobId, status: "processing" },
    });

    // Run reconstruction in background
    (async () => {
      try {
        const imageBuffer = await readFile(imagePath);
        const imageBase64 = imageBuffer.toString("base64");

        // Track analyzer token usage (accumulated outside the graph)
        let analyzerInputTokens = 0;
        let analyzerOutputTokens = 0;

        const toolConfig: ToolConfig = {
          workspacePath: jobWorkspace,
          originalImagePath: imagePath,
          apiKey,
          onChatMessage: async (message) => {
            await appendChatMessage(jobId, message);
          },
          onTokenUsage: async (inputTokens, outputTokens) => {
            analyzerInputTokens += inputTokens;
            analyzerOutputTokens += outputTokens;
          },
        };

        const tools = [
          createWriteLatexTool(toolConfig),
          createReadLatexTool(toolConfig),
          createCompilePdfTool(toolConfig),
          createVerifyPdfTool(toolConfig),
          createDoneTool(toolConfig),
        ];

        const finalState = await runGraph({
          apiKey,
          tools,
          toolConfig,
          imageBase64,
          imageMimeType,
          originalImagePath: imagePath,
          onChatMessage: async (message) => {
            await appendChatMessage(jobId, message as any);
          },
        });

        const stopReason = finalState.stopReason ?? "unknown";

        // Compute total token usage (reconstructor from graph + analyzer from callback)
        const totalInputTokens = (finalState.tokenUsage?.inputTokens ?? 0) + analyzerInputTokens;
        const totalOutputTokens = (finalState.tokenUsage?.outputTokens ?? 0) + analyzerOutputTokens;
        const totalTokens = totalInputTokens + totalOutputTokens;
        // Claude Sonnet 4: $3/MTok input, $15/MTok output
        const estimatedCost = (totalInputTokens / 1_000_000) * 3 + (totalOutputTokens / 1_000_000) * 15;

        // Emit a final chat message showing why the agent stopped
        const iters = finalState.iterationCount;
        const stopMessages: Record<string, string> = {
          done_tool: `Agent finished — called done tool (${iters} LLM iterations)`,
          max_iterations: `Agent stopped — reached maximum iterations (${iters}/${iters} LLM calls)`,
          no_tool_calls: `Agent stopped — produced no tool calls on iteration ${iters} (the LLM responded with text only)`,
          unknown: `Agent stopped — unknown reason (${iters} iterations)`,
        };
        await appendChatMessage(jobId, {
          agent: "reconstructor",
          type: "agent_response",
          agentMessage: stopMessages[stopReason] ?? stopMessages.unknown,
          toolOutput: `Stop reason: ${stopReason}\nLLM iterations: ${iters}\nNote: Each LLM iteration may produce 0, 1, or multiple tool calls. The iteration count reflects LLM calls, not tool calls visible in the chat.`,
          timestamp: new Date().toISOString(),
        });

        await updateJob(jobId, {
          status: "completed",
          iterations: finalState.iterationCount,
          stopReason,
          tokenUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens, estimatedCost },
        });

        log.info("PDF reconstruction job completed", {
          jobId,
          iterations: finalState.iterationCount,
          stopReason,
          totalInputTokens,
          totalOutputTokens,
          estimatedCost: `$${estimatedCost.toFixed(4)}`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("PDF reconstruction job failed", { jobId, error: message });
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

// GET /api/pdf-reconstruction/result/:id
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

    // Job completed - check for PDF
    const workspacePath = getJobWorkspacePath(id);
    const pdfPath = path.join(workspacePath, "document.pdf");
    try {
      await stat(pdfPath);
    } catch {
      res.json({
        success: true,
        data: {
          status: "completed",
          iterations: job.iterations,
          tokenUsage: job.tokenUsage ?? null,
          outputPdf: null,
        },
      });
      return;
    }

    // Check if client wants download
    if (req.query.download === "true") {
      res.download(pdfPath, "reconstructed.pdf");
      return;
    }

    // Return base64
    const pdfBuffer = await readFile(pdfPath);
    const pdfBase64 = pdfBuffer.toString("base64");

    res.json({
      success: true,
      data: {
        status: "completed",
        iterations: job.iterations,
        tokenUsage: job.tokenUsage ?? null,
        outputPdf: pdfBase64,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Result fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pdf-reconstruction/result/:id/iterations — list iteration PDFs
router.get("/result/:id/iterations", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const job = await getJob(id);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    const workspacePath = getJobWorkspacePath(id);
    let files: string[];
    try {
      files = await readdir(workspacePath);
    } catch {
      res.json({ success: true, data: { count: 0, iterations: [] } });
      return;
    }

    const iterationFiles = files
      .filter((f) => /^iteration_\d+\.pdf$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0], 10);
        const numB = parseInt(b.match(/\d+/)![0], 10);
        return numA - numB;
      });

    const iterations = [];
    for (const f of iterationFiles) {
      const n = parseInt(f.match(/\d+/)![0], 10);
      const filePath = path.join(workspacePath, f);
      const fileStat = await stat(filePath);
      iterations.push({
        n,
        filename: f,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }

    res.json({
      success: true,
      data: { count: iterations.length, iterations },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Iterations list error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pdf-reconstruction/result/:id/iteration/:n — serve specific iteration PDF
router.get("/result/:id/iteration/:n", async (req: Request<{ id: string; n: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const n = parseInt(req.params.n, 10);

    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    const workspacePath = getJobWorkspacePath(id);
    const iterationPath = path.join(workspacePath, `iteration_${n}.pdf`);

    try {
      await stat(iterationPath);
    } catch {
      res.status(404).json({ success: false, error: `Iteration ${n} not found` });
      return;
    }

    if (req.query.download === "true") {
      res.download(iterationPath, `iteration_${n}.pdf`);
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    const pdfBuffer = await readFile(iterationPath);
    res.send(pdfBuffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Iteration fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pdf-reconstruction/result/:id/latex — serve the LaTeX source
router.get("/result/:id/latex", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const job = await getJob(id);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    const workspacePath = getJobWorkspacePath(id);
    const texPath = path.join(workspacePath, "document.tex");

    try {
      const content = await readFile(texPath, "utf-8");
      res.json({ success: true, data: { content } });
    } catch {
      res.json({ success: true, data: { content: null } });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("LaTeX fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/pdf-reconstruction/result/:id/chat
router.get("/result/:id/chat", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const id = req.params.id;
    const job = await getJob(id);

    if (!job) {
      res.status(404).json({ success: false, error: "Job not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        status: job.status,
        chatHistory: job.chatHistory ?? [],
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Chat history fetch error", { error: message });
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
