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
import type { StorageProvider } from "../storage/types.js";
import { logger } from "../middleware/logger.js";

function snapshotKey(companyId: string, projectId: string): string {
  return `workspaces/${companyId}/${projectId}/snapshot.tar.gz`;
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

  return { enabled, saveSnapshot, hasSnapshot, getSnapshotSignedUrl, getSnapshotSize };
}
