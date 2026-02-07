import path from "node:path";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { createChildLogger } from "../utils/logger.js";

const log = createChildLogger({ module: "jobStore" });

const WORKSPACE_ROOT = process.env.WORKSPACE_PATH ?? path.join(process.cwd(), "workspace");

export interface JobData {
  id: string;
  type: "pdf-reconstruction" | "video-analyzer";
  status: "processing" | "completed" | "failed";
  createdAt: string;
  iterations?: number;
  error?: string;
  videoResult?: {
    totalFrames: number;
    fps: number;
    groups: Array<{
      groupIndex: number;
      frameCount: number;
      representativeFrame: string;
      timeRange: { start: string; end: string };
      frameNumbers: number[];
    }>;
  };
}

function jobDir(jobId: string): string {
  return path.join(WORKSPACE_ROOT, "jobs", jobId);
}

function jobJsonPath(jobId: string): string {
  return path.join(jobDir(jobId), "job.json");
}

export async function createJob(
  id: string,
  type: JobData["type"],
): Promise<JobData> {
  const dir = jobDir(id);
  await mkdir(dir, { recursive: true });

  const job: JobData = {
    id,
    type,
    status: "processing",
    createdAt: new Date().toISOString(),
  };

  await writeFile(jobJsonPath(id), JSON.stringify(job, null, 2), "utf-8");
  log.info("Job created", { id, type });
  return job;
}

export async function updateJob(
  id: string,
  updates: Partial<Omit<JobData, "id" | "type" | "createdAt">>,
): Promise<JobData> {
  const job = await getJob(id);
  if (!job) {
    throw new Error(`Job ${id} not found`);
  }

  const updated: JobData = { ...job, ...updates };
  await writeFile(jobJsonPath(id), JSON.stringify(updated, null, 2), "utf-8");
  log.info("Job updated", { id, status: updated.status });
  return updated;
}

export async function getJob(id: string): Promise<JobData | null> {
  try {
    const raw = await readFile(jobJsonPath(id), "utf-8");
    return JSON.parse(raw) as JobData;
  } catch {
    return null;
  }
}

export async function listJobs(): Promise<JobData[]> {
  const jobsDir = path.join(WORKSPACE_ROOT, "jobs");
  try {
    await stat(jobsDir);
  } catch {
    return [];
  }

  const entries = await readdir(jobsDir, { withFileTypes: true });
  const jobs: JobData[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await getJob(entry.name);
    if (job) jobs.push(job);
  }

  // Sort newest first
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return jobs;
}

export function getJobWorkspacePath(jobId: string): string {
  return jobDir(jobId);
}
