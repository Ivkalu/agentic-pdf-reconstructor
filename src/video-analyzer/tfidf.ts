import type { TfidfResult } from "./types.js";

// Common English stop words
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in",
  "into", "is", "it", "no", "not", "of", "on", "or", "such", "that", "the",
  "their", "then", "there", "these", "they", "this", "to", "was", "will", "with",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
  "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she", "her",
  "hers", "herself", "its", "itself", "them", "theirs", "themselves",
  "what", "which", "who", "whom", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "am", "been", "being", "do", "does", "did", "doing", "would", "should",
  "could", "ought", "might", "shall", "can", "need", "dare", "had", "has",
  "have", "having", "s", "t", "d", "ll", "re", "ve", "m",
  "about", "above", "after", "again", "against", "before", "below", "between",
  "during", "from", "further", "here", "just", "nor", "only", "own", "same",
  "so", "than", "too", "very", "now", "don", "didn", "doesn", "hadn", "hasn",
  "haven", "isn", "wasn", "weren", "won", "wouldn", "shouldn", "couldn",
  "down", "off", "out", "over", "under", "until", "up",
]);

/**
 * Tokenize text into unigrams and bigrams, removing stop words.
 */
function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  const tokens: string[] = [...words];

  // Add bigrams
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]} ${words[i + 1]}`);
  }

  return tokens;
}

/**
 * Build a TF-IDF matrix from an array of texts.
 *
 * Filters out empty texts and tracks original indices.
 * Uses unigrams + bigrams, stop word removal, min_df=1, max_df=0.95.
 */
export function buildTfidfMatrix(texts: string[]): TfidfResult {
  // Filter empty texts
  const nonEmptyIndices: number[] = [];
  const nonEmptyTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i].trim().length > 0) {
      nonEmptyIndices.push(i);
      nonEmptyTexts.push(texts[i]);
    }
  }

  if (nonEmptyTexts.length === 0) {
    return { matrix: [], vocabulary: [], originalIndices: [] };
  }

  // Tokenize all documents
  const tokenizedDocs = nonEmptyTexts.map(tokenize);

  // Build vocabulary with document frequency counts
  const dfCounts = new Map<string, number>();
  for (const tokens of tokenizedDocs) {
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      dfCounts.set(token, (dfCounts.get(token) ?? 0) + 1);
    }
  }

  // Apply min_df=1, max_df=0.95 filter
  const nDocs = nonEmptyTexts.length;
  const maxDf = Math.floor(nDocs * 0.95);
  const vocabulary: string[] = [];
  const vocabIndex = new Map<string, number>();

  for (const [term, df] of dfCounts) {
    if (df >= 1 && (nDocs <= 1 || df <= maxDf)) {
      vocabIndex.set(term, vocabulary.length);
      vocabulary.push(term);
    }
  }

  if (vocabulary.length === 0) {
    // Fallback: include all terms (like Python's max_df=1.0 fallback)
    for (const [term] of dfCounts) {
      vocabIndex.set(term, vocabulary.length);
      vocabulary.push(term);
    }
  }

  // Compute TF-IDF
  const matrix: number[][] = [];

  for (const tokens of tokenizedDocs) {
    // Term frequency
    const tf = new Map<string, number>();
    for (const token of tokens) {
      if (vocabIndex.has(token)) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
    }

    const row = new Array<number>(vocabulary.length).fill(0);
    for (const [term, count] of tf) {
      const idx = vocabIndex.get(term)!;
      const df = dfCounts.get(term)!;
      // TF-IDF with sublinear TF and smooth IDF (matching sklearn defaults)
      const tfValue = 1 + Math.log(count);
      const idfValue = Math.log((1 + nDocs) / (1 + df)) + 1;
      row[idx] = tfValue * idfValue;
    }

    // L2 normalize the row
    const norm = Math.sqrt(row.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < row.length; i++) {
        row[i] /= norm;
      }
    }

    matrix.push(row);
  }

  return { matrix, vocabulary, originalIndices: nonEmptyIndices };
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Compute cosine distance (1 - cosine similarity).
 */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}
