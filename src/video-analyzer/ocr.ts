import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * OCR a single frame using the tesseract CLI.
 * Uses --oem 3 (LSTM only) and --psm 6 (uniform text block) for speed.
 */
export async function ocrFrame(
  framePath: string,
  lang: string = "eng",
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("tesseract", [
      framePath,
      "stdout",
      "-l", lang,
      "--oem", "3",
      "--psm", "6",
    ]);
    return stdout;
  } catch (e) {
    logger.warn(`OCR failed for ${framePath}: ${e}`);
    return "";
  }
}

/**
 * Run OCR on all frames with a concurrency pool.
 * Returns a Map from frame path to OCR text.
 */
export async function ocrAllFrames(
  frames: string[],
  lang: string,
  workers: number,
): Promise<Map<string, string>> {
  logger.info(
    `Running OCR on ${frames.length} frames using ${workers} workers...`,
  );

  const results = new Map<string, string>();
  let completed = 0;

  // Process frames with a concurrency pool
  const queue = [...frames];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const framePath = queue.shift()!;
      const text = await ocrFrame(framePath, lang);
      results.set(framePath, text);
      completed++;

      if (completed % 50 === 0 || completed === frames.length) {
        logger.info(`  OCR processed ${completed}/${frames.length} frames`);
      }
    }
  }

  // Launch `workers` concurrent processors
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < Math.min(workers, frames.length); i++) {
    workerPromises.push(processNext());
  }

  await Promise.all(workerPromises);

  return results;
}
