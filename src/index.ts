import { readFile, stat, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "./utils/logger.js";
import { createWriteLatexTool } from "./tools/writeLatex.js";
import { createReadLatexTool } from "./tools/readLatex.js";
import { createCompilePdfTool } from "./tools/compilePdf.js";
import { createVerifyPdfTool } from "./tools/verifyPdf.js";
import { createDoneTool } from "./tools/done.js";
import { runGraph } from "./graph/index.js";
import type { ToolConfig } from "./types.js";

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

async function main() {
  const inputImagePath = process.argv[2];

  if (!inputImagePath) {
    logger.error("Usage: node dist/index.js <input-image-path>");
    process.exit(1);
  }

  const resolvedImagePath = path.resolve(inputImagePath);
  logger.info("PDF Reconstructor starting", { inputImagePath: resolvedImagePath });

  // Validate the input image exists
  try {
    const imageStat = await stat(resolvedImagePath);
    logger.info("Input image found", {
      path: resolvedImagePath,
      sizeBytes: imageStat.size,
    });
  } catch {
    logger.error("Input image not found", { path: resolvedImagePath });
    process.exit(1);
  }

  // Load image as base64
  const imageBuffer = await readFile(resolvedImagePath);
  const imageBase64 = imageBuffer.toString("base64");
  const imageMimeType = getMimeType(resolvedImagePath);
  logger.info("Image loaded", {
    base64Length: imageBase64.length,
    mimeType: imageMimeType,
  });

  // Configure workspace
  const workspacePath = process.env.WORKSPACE_PATH ?? path.join(process.cwd(), "workspace");
  await mkdir(workspacePath, { recursive: true });
  logger.info("Workspace ready", { workspacePath });

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    logger.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  // Initialize tool config
  const toolConfig: ToolConfig = {
    workspacePath,
    originalImagePath: resolvedImagePath,
    apiKey,
  };

  // Create all tools
  logger.info("Initializing tools");
  const tools = [
    createWriteLatexTool(toolConfig),
    createReadLatexTool(toolConfig),
    createCompilePdfTool(toolConfig),
    createVerifyPdfTool(toolConfig),
    createDoneTool(toolConfig),
  ];
  logger.info("All tools initialized", {
    toolNames: tools.map((t) => t.name),
  });

  // Run the graph
  logger.info("Starting reconstruction workflow");
  const finalState = await runGraph({
    apiKey,
    tools,
    imageBase64,
    imageMimeType,
    originalImagePath: resolvedImagePath,
  });

  // Copy final PDF to output directory
  const outputDir = path.resolve("output");
  await mkdir(outputDir, { recursive: true });

  const sourcePdf = path.join(workspacePath, "document.pdf");
  const outputPdf = path.join(outputDir, "reconstructed.pdf");

  try {
    await stat(sourcePdf);
    await copyFile(sourcePdf, outputPdf);
    logger.info("Final PDF copied to output", { outputPdf });
  } catch {
    logger.warn("No PDF file found in workspace to copy", { sourcePdf });
  }

  // Log summary
  logger.info("=== Reconstruction Summary ===");
  logger.info(`Iterations: ${finalState.iterationCount}`);
  logger.info(`Done: ${finalState.isDone}`);
  logger.info(`Total messages: ${finalState.messages.length}`);
  logger.info(`Output: ${outputPdf}`);
  logger.info("=== End ===");
}

main().catch((err) => {
  logger.error("Fatal error", { error: err.message, stack: err.stack });
  process.exit(1);
});
