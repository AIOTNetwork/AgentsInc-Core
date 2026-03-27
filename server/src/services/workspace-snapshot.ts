import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { getStorageService } from "../storage/index.js";
import { createStorageProviderFromConfig } from "../storage/provider-registry.js";
import { loadConfig } from "../config.js";
import { unprocessable, notFound } from "../errors.js";
import { createWorkspaceS3Sync, type WorkspaceS3Sync } from "./workspace-s3-sync.js";

const execFileAsync = promisify(execFile);

/**
 * Directories and patterns to exclude from workspace snapshots.
 */
export const TAR_EXCLUDES = [
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

// Lazy singleton for workspace S3 sync
let _workspaceSync: WorkspaceS3Sync | null = null;
export function getWorkspaceS3Sync(): WorkspaceS3Sync {
  if (!_workspaceSync) {
    const config = loadConfig();
    const isS3 = config.storageProvider === "s3";
    const provider = isS3 ? createStorageProviderFromConfig(config) : null;
    _workspaceSync = createWorkspaceS3Sync(provider);
  }
  return _workspaceSync;
}

/**
 * Create a tar.gz snapshot of a project workspace and upload to S3/MinIO.
 * Returns a presigned download URL valid for 15 minutes.
 *
 * Tries two sources in order:
 * 1. Local filesystem — tar the directory and upload
 * 2. S3 fallback — if a synced snapshot already exists in MinIO, return a presigned URL for it
 */
export async function createWorkspaceSnapshot(
  project: ProjectWithCodebase,
): Promise<SnapshotResult> {
  const workspaceDir = project.codebase.effectiveLocalFolder;
  const hasLocalDir = workspaceDir && fs.existsSync(workspaceDir) && fs.statSync(workspaceDir).isDirectory();

  // --- Path 1: Local filesystem available ---
  if (hasLocalDir) {
    return createSnapshotFromLocalDir(project, workspaceDir);
  }

  // --- Path 2: Fall back to S3-synced snapshot ---
  const sync = getWorkspaceS3Sync();
  if (sync.enabled) {
    const expiresInSeconds = 900;
    const signedUrl = await sync.getSnapshotSignedUrl(project.companyId, project.id, expiresInSeconds);
    if (signedUrl) {
      const byteSize = await sync.getSnapshotSize(project.companyId, project.id) ?? 0;
      return {
        objectKey: `workspaces/${project.companyId}/${project.id}/snapshot.tar.gz`,
        signedUrl,
        byteSize,
        expiresInSeconds,
      };
    }
  }

  throw notFound("Project workspace directory not found and no synced snapshot available");
}

async function createSnapshotFromLocalDir(
  project: ProjectWithCodebase,
  workspaceDir: string,
): Promise<SnapshotResult> {
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

    // Also sync to S3 for future cloud access
    const sync = getWorkspaceS3Sync();
    if (sync.enabled) {
      sync.saveSnapshot(project.companyId, project.id, tarBuffer).catch(() => {});
    }

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
