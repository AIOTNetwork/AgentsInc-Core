/**
 * S3 sync layer for agent instructions.
 *
 * Stores all instruction files for an agent as a single JSON bundle in S3.
 * Key format: instructions/{companyId}/{agentId}/bundle.json
 * Bundle format: { "AGENTS.md": "content...", "HEARTBEAT.md": "content..." }
 *
 * This allows instructions to survive container restarts on platforms
 * without persistent volumes (e.g., Zeabur).
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { StorageProvider } from "../storage/types.js";
import { logger } from "../middleware/logger.js";

function bundleKey(companyId: string, agentId: string): string {
  return `instructions/${companyId}/${agentId}/bundle.json`;
}

export interface InstructionsS3Sync {
  /** Whether S3 sync is active */
  readonly enabled: boolean;

  /** Save all instruction files from a local directory to S3 as a bundle */
  saveToS3(companyId: string, agentId: string, localRootPath: string): Promise<void>;

  /** Save a specific set of files to S3 (used during materialize) */
  saveFilesToS3(companyId: string, agentId: string, files: Record<string, string>): Promise<void>;

  /** Update a single file in the S3 bundle (read-modify-write) */
  updateFileInS3(companyId: string, agentId: string, relativePath: string, content: string): Promise<void>;

  /** Delete a single file from the S3 bundle */
  deleteFileInS3(companyId: string, agentId: string, relativePath: string): Promise<void>;

  /** Restore instruction files from S3 to local disk. Returns true if restored. */
  restoreFromS3(companyId: string, agentId: string, localRootPath: string): Promise<boolean>;
}

export function createInstructionsS3Sync(provider: StorageProvider | null): InstructionsS3Sync {
  const enabled = provider !== null && provider.id === "s3";

  async function readBundle(companyId: string, agentId: string): Promise<Record<string, string> | null> {
    if (!enabled || !provider) return null;
    try {
      const result = await provider.getObject({ objectKey: bundleKey(companyId, agentId) });
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } catch {
      return null;
    }
  }

  async function writeBundle(companyId: string, agentId: string, bundle: Record<string, string>): Promise<void> {
    if (!enabled || !provider) return;
    const body = Buffer.from(JSON.stringify(bundle, null, 2), "utf-8");
    await provider.putObject({
      objectKey: bundleKey(companyId, agentId),
      body,
      contentType: "application/json",
      contentLength: body.length,
    });
  }

  async function saveToS3(companyId: string, agentId: string, localRootPath: string): Promise<void> {
    if (!enabled) return;
    try {
      const files = await walkDir(localRootPath, "");
      const bundle: Record<string, string> = {};
      await Promise.all(
        files.map(async ({ relativePath, absolutePath }) => {
          bundle[relativePath] = await fs.readFile(absolutePath, "utf-8");
        }),
      );
      await writeBundle(companyId, agentId, bundle);
      logger.info({ companyId, agentId, fileCount: files.length }, "Saved instruction bundle to S3");
    } catch (err) {
      logger.warn({ err, companyId, agentId }, "Failed to save instruction bundle to S3");
    }
  }

  async function saveFilesToS3(companyId: string, agentId: string, files: Record<string, string>): Promise<void> {
    if (!enabled) return;
    try {
      await writeBundle(companyId, agentId, files);
      logger.info({ companyId, agentId, fileCount: Object.keys(files).length }, "Saved instruction files to S3");
    } catch (err) {
      logger.warn({ err, companyId, agentId }, "Failed to save instruction files to S3");
    }
  }

  async function updateFileInS3(companyId: string, agentId: string, relativePath: string, content: string): Promise<void> {
    if (!enabled) return;
    try {
      const existing = await readBundle(companyId, agentId) ?? {};
      existing[relativePath] = content;
      await writeBundle(companyId, agentId, existing);
    } catch (err) {
      logger.warn({ err, companyId, agentId, relativePath }, "Failed to update instruction file in S3");
    }
  }

  async function deleteFileInS3(companyId: string, agentId: string, relativePath: string): Promise<void> {
    if (!enabled) return;
    try {
      const existing = await readBundle(companyId, agentId);
      if (existing && relativePath in existing) {
        delete existing[relativePath];
        await writeBundle(companyId, agentId, existing);
      }
    } catch (err) {
      logger.warn({ err, companyId, agentId, relativePath }, "Failed to delete instruction file from S3");
    }
  }

  async function restoreFromS3(companyId: string, agentId: string, localRootPath: string): Promise<boolean> {
    if (!enabled) return false;
    try {
      const bundle = await readBundle(companyId, agentId);
      if (!bundle || Object.keys(bundle).length === 0) return false;

      await fs.mkdir(localRootPath, { recursive: true });
      for (const [relativePath, content] of Object.entries(bundle)) {
        const absolutePath = path.resolve(localRootPath, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf-8");
      }

      logger.info(
        { companyId, agentId, fileCount: Object.keys(bundle).length },
        "Restored instruction files from S3",
      );
      return true;
    } catch (err) {
      logger.warn({ err, companyId, agentId }, "Failed to restore instruction files from S3");
      return false;
    }
  }

  return { enabled, saveToS3, saveFilesToS3, updateFileInS3, deleteFileInS3, restoreFromS3 };
}

// --- Helpers ---

async function walkDir(rootPath: string, relativeDir: string): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const output: Array<{ relativePath: string; absolutePath: string }> = [];
  const entries = await fs.readdir(path.join(rootPath, relativeDir), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(rootPath, relativePath);
    if (entry.isDirectory()) {
      output.push(...await walkDir(rootPath, relativePath));
    } else if (entry.isFile()) {
      output.push({ relativePath, absolutePath });
    }
  }
  return output;
}
