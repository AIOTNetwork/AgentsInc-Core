import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { getStorageService } from "../storage/index.js";
import { unprocessable, notFound } from "../errors.js";

const execFileAsync = promisify(execFile);

/**
 * Directories and patterns to exclude from workspace snapshots.
 */
const TAR_EXCLUDES = [
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  "dist",
  "build",
  ".cache",
  ".turbo",
  ".vercel",
  ".svelte-kit",
  "__pycache__",
  ".env",
  ".env.local",
  ".env.*.local",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
  "coverage",
  ".nyc_output",
  ".parcel-cache",
];

interface ProjectWithCodebase {
  id: string;
  companyId: string;
  name: string;
  codebase: {
    effectiveLocalFolder: string | null;
    repoUrl: string | null;
    repoRef: string | null;
  };
}

export interface SnapshotResult {
  objectKey: string;
  signedUrl: string;
  byteSize: number;
  expiresInSeconds: number;
}

/**
 * Create a tar.gz snapshot of a project workspace and upload to S3/MinIO.
 * Returns a presigned download URL valid for 15 minutes.
 */
export async function createWorkspaceSnapshot(
  project: ProjectWithCodebase,
): Promise<SnapshotResult> {
  const workspaceDir = project.codebase.effectiveLocalFolder;
  if (!workspaceDir || !fs.existsSync(workspaceDir)) {
    throw notFound("Project workspace directory not found");
  }

  const stat = fs.statSync(workspaceDir);
  if (!stat.isDirectory()) {
    throw unprocessable("Workspace path is not a directory");
  }

  const tmpDir = os.tmpdir();
  const tarFilename = `snapshot-${randomUUID().slice(0, 12)}.tar.gz`;
  const tarPath = path.join(tmpDir, tarFilename);

  try {
    const excludeArgs = TAR_EXCLUDES.flatMap((p) => ["--exclude", p]);

    await execFileAsync("tar", [
      "czf",
      tarPath,
      ...excludeArgs,
      "-C",
      workspaceDir,
      ".",
    ], { timeout: 60_000 });

    const tarStat = fs.statSync(tarPath);
    const tarBuffer = fs.readFileSync(tarPath);

    const storage = getStorageService();

    const putResult = await storage.putFile({
      companyId: project.companyId,
      namespace: "previews",
      originalFilename: `${project.id}.tar.gz`,
      contentType: "application/gzip",
      body: tarBuffer,
    });

    if (!storage.getSignedUrl) {
      throw unprocessable("Storage provider does not support presigned URLs. Use S3/MinIO storage.");
    }

    const expiresInSeconds = 900; // 15 minutes
    const signedUrl = await storage.getSignedUrl(
      project.companyId,
      putResult.objectKey,
      expiresInSeconds,
    );

    return {
      objectKey: putResult.objectKey,
      signedUrl,
      byteSize: tarStat.size,
      expiresInSeconds,
    };
  } finally {
    try { fs.unlinkSync(tarPath); } catch { /* ignore */ }
  }
}
