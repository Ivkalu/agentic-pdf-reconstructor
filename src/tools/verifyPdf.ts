import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createChildLogger } from "../utils/logger.js";
import { analyzeDocuments } from "../agents/analyzer.js";
import type { ToolConfig } from "../types.js";

const execFileAsync = promisify(execFile);

async function pdfToImages(pdfPath: string, outputDir: string): Promise<string[]> {
  const log = createChildLogger({ tool: "verifyPdf" });
  const outputPrefix = path.join(outputDir, "page");

  log.debug("Converting PDF to images with pdftoppm", { pdfPath, outputPrefix });

  await execFileAsync("pdftoppm", ["-png", "-r", "200", pdfPath, outputPrefix]);

  // pdftoppm outputs files like page-1.png, page-2.png, etc.
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(outputDir);
  const pageFiles = files
    .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
    .sort();

  log.debug("PDF converted to images", { pageCount: pageFiles.length, files: pageFiles });

  const images: string[] = [];
  for (const file of pageFiles) {
    const buf = await readFile(path.join(outputDir, file));
    images.push(buf.toString("base64"));
  }

  return images;
}

export function createVerifyPdfTool(config: ToolConfig) {
  const log = createChildLogger({ tool: "verifyPdf" });
  const feedbackHistory: string[] = [];

  return new DynamicStructuredTool({
    name: "verify_pdf",
    description:
      "Visually compare the compiled PDF with the original document image. " +
      "This converts the compiled PDF to images and sends both the original and compiled " +
      "images to an AI vision model for detailed comparison. " +
      "Returns actionable feedback on differences, or confirms the documents match. " +
      "Call this after compile_pdf to check your work.",
    schema: z.object({}),
    func: async () => {
      const pdfPath = path.join(config.workspacePath, "document.pdf");
      const pagesDir = path.join(config.workspacePath, "pages");

      log.info("Verification starting", {
        pdfPath,
        originalImagePath: config.originalImagePath,
      });

      try {
        // Ensure pages directory exists
        const { mkdir } = await import("node:fs/promises");
        await mkdir(pagesDir, { recursive: true });

        // Read the original image
        if (!config.originalImagePath) {
          return "Error: No original image path configured for verification.";
        }

        const originalBuf = await readFile(config.originalImagePath);
        const originalBase64 = originalBuf.toString("base64");

        log.info("Original image loaded", {
          path: config.originalImagePath,
          sizeBytes: originalBuf.length,
        });

        // Convert compiled PDF to page images
        const pdfImages = await pdfToImages(pdfPath, pagesDir);

        if (pdfImages.length === 0) {
          return "Error: PDF conversion produced no page images. Is the PDF valid?";
        }

        log.info("PDF converted to images", { pageCount: pdfImages.length });

        // Invoke the analyzer agent
        const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
        if (!apiKey) {
          return "Error: No Anthropic API key available for the analyzer agent.";
        }

        log.info("Invoking analyzer agent", {
          previousFeedbackRounds: feedbackHistory.length,
        });
        const feedback = await analyzeDocuments(
          originalBase64,
          pdfImages,
          apiKey,
          feedbackHistory.length > 0 ? feedbackHistory : undefined,
        );

        feedbackHistory.push(feedback);

        log.info("Analyzer response received", {
          feedbackLength: feedback.length,
          feedbackRound: feedbackHistory.length,
          feedbackPreview: feedback.slice(0, 200),
        });

        return feedback;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown verification error";
        log.error("Verification failed", { error: message });
        return `Error during PDF verification: ${message}`;
      }
    },
  });
}
