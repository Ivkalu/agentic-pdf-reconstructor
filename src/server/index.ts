import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createChildLogger } from "../utils/logger.js";
import healthRouter from "./routes/health.js";
import jobsRouter from "./routes/jobs.js";
import pdfReconstructionRouter from "./routes/pdfReconstruction.js";
import videoAnalyzerRouter from "./routes/videoAnalyzer.js";

const log = createChildLogger({ agent: "server" });

const app = express();

// CORS
app.use(cors());

// JSON body parsing
app.use(express.json({ limit: "10mb" }));

// Serve static files from dist/public/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Mount routes
app.use("/api/health", healthRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/pdf-reconstruction", pdfReconstructionRouter);
app.use("/api/video-analyzer", videoAnalyzerRouter);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("Unhandled error", { error: err.message, stack: err.stack });

  // Multer file size error
  if (err.message?.includes("File too large")) {
    res.status(413).json({ success: false, error: "File too large" });
    return;
  }

  // Multer file type error
  if (err.message?.includes("Unsupported")) {
    res.status(415).json({ success: false, error: err.message });
    return;
  }

  res.status(500).json({ success: false, error: "Internal server error" });
});

// Start server
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.listen(PORT, () => {
  log.info(`Server listening on port ${PORT}`);
  log.info(`Static files served from ${publicDir}`);
  log.info(`Health check: http://localhost:${PORT}/api/health`);
});

export default app;
