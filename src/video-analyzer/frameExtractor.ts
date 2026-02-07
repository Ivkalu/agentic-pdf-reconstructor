import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

/**
 * Get the FPS of a video using ffprobe.
 */
export async function getVideoFps(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate",
      "-of", "json",
      videoPath,
    ]);

    const data = JSON.parse(stdout);
    const fpsStr: string = data.streams[0].r_frame_rate;
    const [num, den] = fpsStr.split("/").map(Number);
    return num / den;
  } catch (e) {
    logger.warn(`Could not detect video FPS (${e}), assuming 30fps`);
    return 30.0;
  }
}

/**
 * Extract frames from video using ffmpeg.
 * Samples 1 frame per second, downscales to 1280px wide, outputs JPEG.
 * Returns sorted array of frame file paths.
 */
export async function extractFrames(
  videoPath: string,
  outputDir: string,
): Promise<string[]> {
  const framesDir = path.join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const framePattern = path.join(framesDir, "frame_%06d.jpg");

  logger.info("Extracting frames (15 fps, scaled to 1280px wide)...");

  const { stderr } = await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vf", "fps=15,scale=1280:-2",
    "-q:v", "5",
    framePattern,
    "-y",
  ], { maxBuffer: 10 * 1024 * 1024 });

  // ffmpeg writes progress info to stderr even on success
  logger.debug(`ffmpeg output: ${stderr.slice(0, 500)}`);

  const files = await readdir(framesDir);
  const framePaths = files
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(framesDir, f));

  logger.info(`Extracted ${framePaths.length} frames`);
  return framePaths;
}
