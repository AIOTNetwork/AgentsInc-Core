/**
 * S3 sync layer for project workspace snapshots.
 *
 * Stores a tar.gz of workspace files in S3/MinIO so previews can work
 * on cloud deployments where the local filesystem is not available.
 * Key format: workspaces/{companyId}/{projectId}/snapshot.tar.gz
 *
 * The agent (running locally) uploads the tarball via the sync endpoint.
 * The snapshot endpoint then serves a presigned URL for the existing object.
 */
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { StorageProvider } from "../storage/types.js";
import { logger } from "../middleware/logger.js";

const execFile = promisify(execFileCb);

function snapshotKey(companyId: string, projectId: string): string {
  return `workspaces/${companyId}/${projectId}/snapshot.tar.gz`;
}

function agentHomeKey(companyId: string, agentId: string): string {
  return `agent-homes/${companyId}/${agentId}/snapshot.tar.gz`;
}

export interface WorkspaceS3Sync {
  readonly enabled: boolean;

  /** Store a workspace tar.gz in S3 */
  saveSnapshot(companyId: string, projectId: string, tarBuffer: Buffer): Promise<void>;

  /** Check if a synced snapshot exists */
  hasSnapshot(companyId: string, projectId: string): Promise<boolean>;

  /** Get a presigned download URL for the synced snapshot. Returns null if not found or not supported. */
  getSnapshotSignedUrl(companyId: string, projectId: string, expiresInSeconds: number): Promise<string | null>;

  /** Get the byte size of the synced snapshot. Returns null if not found. */
  getSnapshotSize(companyId: string, projectId: string): Promise<number | null>;

  /** Download and extract a workspace snapshot from S3 to a local directory. Returns true if restored. */
  restoreSnapshot(companyId: string, projectId: string, targetDir: string): Promise<boolean>;

  /** Save agent home directory (memory/life files) to S3 as a tar.gz snapshot. */
  saveAgentHomeSnapshot(companyId: string, agentId: string, tarBuffer: Buffer): Promise<void>;

  /** Restore agent home directory from S3 snapshot. Returns true if restored. */
  restoreAgentHomeSnapshot(companyId: string, agentId: string, targetDir: string): Promise<boolean>;
}

export function createWorkspaceS3Sync(provider: StorageProvider | null): WorkspaceS3Sync {
  const enabled = provider !== null && provider.id === "s3";

  async function saveSnapshot(companyId: string, projectId: string, tarBuffer: Buffer): Promise<void> {
    if (!enabled || !provider) return;
    const key = snapshotKey(companyId, projectId);
    await provider.putObject({
      objectKey: key,
      body: tarBuffer,
      contentType: "application/gzip",
      contentLength: tarBuffer.length,
    });
    logger.info({ companyId, projectId, byteSize: tarBuffer.length }, "Saved workspace snapshot to S3");
  }

  async function hasSnapshot(companyId: string, projectId: string): Promise<boolean> {
    if (!enabled || !provider) return false;
    try {
      const result = await provider.headObject({ objectKey: snapshotKey(companyId, projectId) });
      return result.exists;
    } catch {
      return false;
    }
  }

  async function getSnapshotSignedUrl(
    companyId: string,
    projectId: string,
    expiresInSeconds: number,
  ): Promise<string | null> {
    if (!enabled || !provider || !provider.getSignedUrl) return null;
    try {
      const exists = await hasSnapshot(companyId, projectId);
      if (!exists) return null;
      return await provider.getSignedUrl({ objectKey: snapshotKey(companyId, projectId) }, expiresInSeconds);
    } catch {
      return null;
    }
  }

  async function getSnapshotSize(companyId: string, projectId: string): Promise<number | null> {
    if (!enabled || !provider) return null;
    try {
      const result = await provider.headObject({ objectKey: snapshotKey(companyId, projectId) });
      return result.exists ? (result.contentLength ?? null) : null;
    } catch {
      return null;
    }
  }

  async function restoreSnapshot(companyId: string, projectId: string, targetDir: string): Promise<boolean> {
    if (!enabled || !provider) return false;
    try {
      const exists = await hasSnapshot(companyId, projectId);
      if (!exists) return false;

      const result = await provider.getObject({ objectKey: snapshotKey(companyId, projectId) });
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const tarBuffer = Buffer.concat(chunks);

      const tarPath = path.join(tmpdir(), `ws-restore-${randomUUID().slice(0, 12)}.tar.gz`);
      try {
        await mkdir(targetDir, { recursive: true });
        await writeFile(tarPath, tarBuffer);
        await execFile("tar", ["xzf", tarPath, "-C", targetDir], { timeout: 60_000 });
        logger.info({ companyId, projectId, targetDir, bytes: tarBuffer.length }, "Restored workspace snapshot from S3");
        return true;
      } finally {
        await unlink(tarPath).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, companyId, projectId }, "Failed to restore workspace snapshot from S3");
      return false;
    }
  }

  async function saveAgentHomeSnapshot(companyId: string, agentId: string, tarBuffer: Buffer): Promise<void> {
    if (!enabled || !provider) return;
    const key = agentHomeKey(companyId, agentId);
    await provider.putObject({
      objectKey: key,
      body: tarBuffer,
      contentType: "application/gzip",
      contentLength: tarBuffer.length,
    });
    logger.info({ companyId, agentId, byteSize: tarBuffer.length }, "Saved agent home snapshot to S3");
  }

  async function restoreAgentHomeSnapshot(companyId: string, agentId: string, targetDir: string): Promise<boolean> {
    if (!enabled || !provider) return false;
    try {
      const key = agentHomeKey(companyId, agentId);
      const head = await provider.headObject({ objectKey: key });
      if (!head.exists) return false;

      const result = await provider.getObject({ objectKey: key });
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const tarBuffer = Buffer.concat(chunks);

      const tarPath = path.join(tmpdir(), `agent-home-restore-${randomUUID().slice(0, 12)}.tar.gz`);
      try {
        await mkdir(targetDir, { recursive: true });
        await writeFile(tarPath, tarBuffer);
        await execFile("tar", ["xzf", tarPath, "-C", targetDir], { timeout: 60_000 });
        logger.info({ companyId, agentId, targetDir, bytes: tarBuffer.length }, "Restored agent home snapshot from S3");
        return true;
      } finally {
        await unlink(tarPath).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, companyId, agentId }, "Failed to restore agent home snapshot from S3");
      return false;
    }
  }

  return { enabled, saveSnapshot, hasSnapshot, getSnapshotSignedUrl, getSnapshotSize, restoreSnapshot, saveAgentHomeSnapshot, restoreAgentHomeSnapshot };
}
