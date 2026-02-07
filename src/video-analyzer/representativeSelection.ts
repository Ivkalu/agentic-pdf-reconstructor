import { buildTfidfMatrix, cosineSimilarity } from "./tfidf.js";

/**
 * Select the most representative frame from a group.
 *
 * Instead of picking the middle frame by time, this picks the frame whose
 * TF-IDF vector is closest to the centroid of the group. This gives the
 * frame most similar to all others in the group.
 *
 * @param groupFramePaths - Frame paths in this group
 * @param groupTexts - OCR texts corresponding to each frame in the group
 * @returns The path of the most representative frame
 */
export function selectRepresentative(
  groupFramePaths: string[],
  groupTexts: string[],
): string {
  if (groupFramePaths.length === 0) {
    throw new Error("Cannot select representative from empty group");
  }

  if (groupFramePaths.length === 1) {
    return groupFramePaths[0];
  }

  // Build TF-IDF matrix for just this group's texts
  const { matrix, originalIndices } = buildTfidfMatrix(groupTexts);

  // If no non-empty texts, fall back to first frame
  if (matrix.length === 0) {
    return groupFramePaths[0];
  }

  // If only one non-empty text, return that frame
  if (matrix.length === 1) {
    return groupFramePaths[originalIndices[0]];
  }

  const dim = matrix[0].length;

  // Compute centroid (mean of all vectors in the group)
  const centroid = new Array<number>(dim).fill(0);
  for (const row of matrix) {
    for (let j = 0; j < dim; j++) {
      centroid[j] += row[j];
    }
  }
  for (let j = 0; j < dim; j++) {
    centroid[j] /= matrix.length;
  }

  // Find the frame whose vector has the highest cosine similarity to the centroid
  let bestIdx = 0;
  let bestSimilarity = -Infinity;

  for (let i = 0; i < matrix.length; i++) {
    const sim = cosineSimilarity(matrix[i], centroid);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestIdx = i;
    }
  }

  // Map back to original frame index
  return groupFramePaths[originalIndices[bestIdx]];
}
