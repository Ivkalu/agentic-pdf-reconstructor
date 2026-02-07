import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { mkdir, copyFile, readFile, writeFile, readdir, unlink, rmdir, stat } from "node:fs/promises";
import { logger } from "../utils/logger.js";
import { extractFrames, getVideoFps } from "./frameExtractor.js";
import { ocrAllFrames } from "./ocr.js";
import { buildTfidfMatrix } from "./tfidf.js";
import { clusterKMeans, clusterDBSCAN } from "./clustering.js";
import { selectRepresentative } from "./representativeSelection.js";
import type {
  VideoAnalyzerOptions,
  VideoAnalyzerResult,
  GroupInfo,
  FrameTimestamp,
} from "./types.js";

export type { VideoAnalyzerOptions, VideoAnalyzerResult, GroupInfo };

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? path.join(process.cwd(), "workspace");
const CACHE_DIR = path.join(WORKSPACE_ROOT, "video-cache");

/**
 * Compute SHA-256 hash of a file (streams to avoid loading into memory).
 */
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Get cache directory for a given video hash.
 */
function getCacheDir(videoHash: string): string {
  return path.join(CACHE_DIR, videoHash);
}

interface CachedOcr {
  frames: string[];
  texts: string[];
}

/**
 * Try to load cached frames and OCR results for a video.
 */
async function loadCache(
  videoHash: string,
): Promise<{ frames: string[]; texts: string[] } | null> {
  const cacheDir = getCacheDir(videoHash);
  const ocrCachePath = path.join(cacheDir, "ocr_cache.json");

  try {
    await stat(ocrCachePath);
  } catch {
    return null;
  }

  try {
    const raw = await readFile(ocrCachePath, "utf-8");
    const cached: CachedOcr = JSON.parse(raw);

    // Verify all frame files still exist
    for (const framePath of cached.frames) {
      try {
        await stat(framePath);
      } catch {
        logger.info("Cache invalid: missing frame file, re-extracting");
        return null;
      }
    }

    logger.info(`Cache hit for video ${videoHash.slice(0, 12)}... (${cached.frames.length} frames)`);
    return cached;
  } catch {
    return null;
  }
}

/**
 * Save frames and OCR results to cache.
 */
async function saveCache(
  videoHash: string,
  frames: string[],
  texts: string[],
): Promise<void> {
  const cacheDir = getCacheDir(videoHash);
  await mkdir(cacheDir, { recursive: true });

  const ocrCachePath = path.join(cacheDir, "ocr_cache.json");
  const cached: CachedOcr = { frames, texts };
  await writeFile(ocrCachePath, JSON.stringify(cached), "utf-8");
  logger.info(`Cached OCR results for video ${videoHash.slice(0, 12)}...`);
}

/**
 * Extract frame number from filename (frame_000001.jpg -> 1).
 */
function getFrameNumber(framePath: string): number {
  const ext = path.extname(framePath);
  const name = path.basename(framePath, ext);
  const numStr = name.replace("frame_", "");
  return parseInt(numStr, 10);
}

/** Sampling rate used during frame extraction. */
const SAMPLE_FPS = 15;

/**
 * Convert frame number to timestamp string.
 * Frames are extracted at SAMPLE_FPS, so frame N = (N-1) / SAMPLE_FPS seconds.
 */
function frameNumberToTimestamp(frameNum: number): string {
  const totalSeconds = Math.max(0, (frameNum - 1) / SAMPLE_FPS);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
}

/**
 * Main video analysis pipeline.
 *
 * 1. Hash video for cache lookup
 * 2. Extract frames (ffmpeg) — or use cached
 * 3. OCR all frames (tesseract, parallel) — or use cached
 * 4. Build TF-IDF matrix
 * 5. Cluster using K-means or DBSCAN
 * 6. Select representative frames (centroid-closest)
 * 7. Save representative frames, generate timestamps
 * 8. Clean up extracted frames (but keep cache)
 */
export async function analyzeVideo(
  options: VideoAnalyzerOptions,
): Promise<VideoAnalyzerResult> {
  const {
    videoPath,
    nClusters,
    dbscanEps,
    lang = "eng",
    workers = 8,
  } = options;

  const resolvedVideoPath = path.resolve(videoPath);
  const videoName = path.basename(resolvedVideoPath, path.extname(resolvedVideoPath));
  const outputDir = path.join(path.dirname(resolvedVideoPath), videoName);

  await mkdir(outputDir, { recursive: true });

  logger.info(`Processing: ${path.basename(resolvedVideoPath)}`);
  logger.info(`Output directory: ${outputDir}`);

  // Get video FPS (original, for reference)
  const fps = await getVideoFps(resolvedVideoPath);
  logger.info(`Video FPS: ${fps.toFixed(2)}`);

  // Hash video for caching
  logger.info("Hashing video for cache lookup...");
  const videoHash = await hashFile(resolvedVideoPath);
  logger.info(`Video hash: ${videoHash.slice(0, 12)}...`);

  let frames: string[];
  let texts: string[];

  // Try cache
  const cached = await loadCache(videoHash);

  if (cached) {
    frames = cached.frames;
    texts = cached.texts;
    logger.info(`Using cached data: ${frames.length} frames, skipping extraction and OCR`);
  } else {
    // Step 1: Extract frames
    logger.info("[Step 1/4] Extracting frames...");
    frames = await extractFrames(resolvedVideoPath, getCacheDir(videoHash));

    if (frames.length === 0) {
      logger.warn("No frames extracted");
      return {
        videoPath: resolvedVideoPath,
        outputDir,
        fps,
        totalFrames: 0,
        groups: [],
        representativeFramePaths: [],
      };
    }

    // Step 2: OCR all frames
    logger.info("[Step 2/4] Running OCR...");
    const ocrResults = await ocrAllFrames(frames, lang, workers);
    texts = frames.map((f) => ocrResults.get(f) ?? "");

    // Save to cache
    await saveCache(videoHash, frames, texts);
  }

  // Step 3: Cluster frames
  logger.info("[Step 3/4] Clustering frames...");

  const { matrix, originalIndices } = buildTfidfMatrix(texts);

  let labels: number[];

  if (matrix.length === 0) {
    // All texts empty, put everything in one group
    labels = new Array(frames.length).fill(0);
  } else if (dbscanEps != null) {
    logger.info(`Using DBSCAN clustering (eps=${dbscanEps})...`);
    const clusterLabels = clusterDBSCAN(matrix, dbscanEps);

    // Map back to full frame set
    labels = new Array(frames.length).fill(-1);
    for (let i = 0; i < clusterLabels.length; i++) {
      labels[originalIndices[i]] = clusterLabels[i];
    }
  } else if (nClusters != null) {
    logger.info(`Using K-means clustering (k=${nClusters})...`);
    const effectiveClusters = Math.min(nClusters, matrix.length);
    const clusterLabels = clusterKMeans(matrix, effectiveClusters);

    // Map back to full frame set
    labels = new Array(frames.length).fill(-1);
    for (let i = 0; i < clusterLabels.length; i++) {
      labels[originalIndices[i]] = clusterLabels[i];
    }
  } else {
    // Default: K-means with auto cluster count (estimate from data)
    const autoK = Math.max(1, Math.min(Math.round(Math.sqrt(matrix.length / 2)), 50));
    logger.info(`Using K-means with auto k=${autoK}...`);
    const clusterLabels = clusterKMeans(matrix, autoK);

    labels = new Array(frames.length).fill(-1);
    for (let i = 0; i < clusterLabels.length; i++) {
      labels[originalIndices[i]] = clusterLabels[i];
    }
  }

  // Group frames by cluster label
  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!clusterMap.has(label)) {
      clusterMap.set(label, []);
    }
    clusterMap.get(label)!.push(i);
  }

  // Sort clusters by average frame number (chronological order)
  const sortedClusters = [...clusterMap.entries()]
    .map(([label, indices]) => {
      const avgFrame =
        indices.reduce((sum, i) => sum + getFrameNumber(frames[i]), 0) /
        indices.length;
      return { label, indices, avgFrame };
    })
    .sort((a, b) => a.avgFrame - b.avgFrame);

  // Step 4: Create outputs
  logger.info("[Step 4/4] Creating output files...");

  const representativeDir = path.join(outputDir, "representative_frames");
  await mkdir(representativeDir, { recursive: true });

  const groups: GroupInfo[] = [];
  const representativeFramePaths: string[] = [];

  for (let gi = 0; gi < sortedClusters.length; gi++) {
    const { indices } = sortedClusters[gi];
    const groupIndex = gi + 1;
    const displayName = `Group ${groupIndex}`;
    const groupName = `group_${String(groupIndex).padStart(2, "0")}`;

    logger.info(`  ${displayName}: ${indices.length} frames`);

    const groupFramePaths = indices.map((i) => frames[i]);
    const groupTexts = indices.map((i) => texts[i]);

    // Select representative frame (centroid-closest in TF-IDF space)
    const representativeFrame = selectRepresentative(
      groupFramePaths,
      groupTexts,
    );

    const ext = path.extname(representativeFrame);
    const reprDest = path.join(representativeDir, `${groupName}${ext}`);
    await copyFile(representativeFrame, reprDest);
    representativeFramePaths.push(reprDest);

    // Calculate timestamps (1fps sampling: frame N = second N-1)
    const frameTimestamps: FrameTimestamp[] = indices
      .map((i) => {
        const frameNum = getFrameNumber(frames[i]);
        return {
          frameNumber: frameNum,
          timestamp: frameNumberToTimestamp(frameNum),
          fileName: path.basename(frames[i]),
        };
      })
      .sort((a, b) => a.frameNumber - b.frameNumber);

    const timeRange = {
      start: frameTimestamps[0]?.timestamp ?? "00:00",
      end: frameTimestamps[frameTimestamps.length - 1]?.timestamp ?? "00:00",
    };

    groups.push({
      groupIndex,
      groupName: displayName,
      representativeFrame: reprDest,
      frameCount: indices.length,
      timeRange,
      frames: frameTimestamps,
    });
  }

  // Don't clean up cached frames — they'll be reused on re-upload

  logger.info(`Representative frames saved to: ${representativeDir}`);
  logger.info(`Done! Results in: ${outputDir}`);

  return {
    videoPath: resolvedVideoPath,
    outputDir,
    fps,
    totalFrames: frames.length,
    groups,
    representativeFramePaths,
  };
}
