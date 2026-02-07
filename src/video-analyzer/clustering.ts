import { kmeans } from "ml-kmeans";
import { logger } from "../utils/logger.js";
import { cosineDistance } from "./tfidf.js";

// density-clustering is a CommonJS module without types
// @ts-expect-error -- no type declarations for density-clustering
import DBSCAN from "density-clustering/lib/DBSCAN.js";

/**
 * K-means clustering on a TF-IDF matrix.
 * Returns an array of cluster labels (one per row).
 */
export function clusterKMeans(
  tfidfMatrix: number[][],
  nClusters: number,
): number[] {
  if (tfidfMatrix.length === 0) {
    return [];
  }

  // Adjust cluster count if we have fewer data points
  const effectiveClusters = Math.min(nClusters, tfidfMatrix.length);
  if (effectiveClusters < nClusters) {
    logger.warn(
      `Reducing clusters from ${nClusters} to ${effectiveClusters} (not enough data)`,
    );
  }

  if (effectiveClusters <= 1) {
    return new Array(tfidfMatrix.length).fill(0);
  }

  const result = kmeans(tfidfMatrix, effectiveClusters, {
    initialization: "kmeans++",
    maxIterations: 100,
    seed: 42,
  });

  const labels = result.clusters;
  const uniqueLabels = new Set(labels);
  logger.info(`K-means produced ${uniqueLabels.size} clusters`);

  return labels;
}

/**
 * DBSCAN clustering on a TF-IDF matrix using cosine distance.
 * Returns an array of cluster labels (one per row). Noise points get label -1.
 */
export function clusterDBSCAN(
  tfidfMatrix: number[][],
  eps: number,
  minSamples: number = 2,
): number[] {
  if (tfidfMatrix.length === 0) {
    return [];
  }

  if (tfidfMatrix.length < minSamples) {
    logger.warn(
      `Not enough data for DBSCAN (need at least ${minSamples}), returning single cluster`,
    );
    return new Array(tfidfMatrix.length).fill(0);
  }

  const dbscan = new DBSCAN() as {
    run(data: number[][], eps: number, minPts: number, distFn: (a: number[], b: number[]) => number): number[][];
    noise: number[];
  };
  const clusters: number[][] = dbscan.run(
    tfidfMatrix,
    eps,
    minSamples,
    cosineDistance,
  );

  // Convert cluster arrays to labels array
  const labels = new Array<number>(tfidfMatrix.length).fill(-1);
  for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
    for (const pointIdx of clusters[clusterIdx]) {
      labels[pointIdx] = clusterIdx;
    }
  }

  const nClusters = clusters.length;
  const nNoise = labels.filter((l) => l === -1).length;

  logger.info(`DBSCAN found ${nClusters} clusters (eps=${eps})`);
  if (nNoise > 0) {
    logger.info(
      `  ${nNoise} frames marked as noise (will be in separate group)`,
    );
  }

  return labels;
}
