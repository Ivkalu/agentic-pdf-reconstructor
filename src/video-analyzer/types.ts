export interface VideoAnalyzerOptions {
  videoPath: string;
  nClusters?: number;
  dbscanEps?: number;
  lang?: string;
  workers?: number;
}

export interface GroupInfo {
  groupIndex: number;
  groupName: string;
  representativeFrame: string;
  frameCount: number;
  timeRange: { start: string; end: string };
  frames: FrameTimestamp[];
}

export interface FrameTimestamp {
  frameNumber: number;
  timestamp: string;
  fileName: string;
}

export interface VideoAnalyzerResult {
  videoPath: string;
  outputDir: string;
  fps: number;
  totalFrames: number;
  groups: GroupInfo[];
  representativeFramePaths: string[];
}

export interface TfidfResult {
  matrix: number[][];
  vocabulary: string[];
  originalIndices: number[];
}
