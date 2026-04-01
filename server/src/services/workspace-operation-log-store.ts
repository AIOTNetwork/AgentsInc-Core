import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { notFound } from "../errors.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { getS3LogClient } from "./s3-log-store-utils.js";

export type WorkspaceOperationLogStoreType = "local_file" | "s3";

export interface WorkspaceOperationLogHandle {
  store: WorkspaceOperationLogStoreType;
  logRef: string;
}

export interface WorkspaceOperationLogReadOptions {
  offset?: number;
  limitBytes?: number;
}

export interface WorkspaceOperationLogReadResult {
  content: string;
  nextOffset?: number;
}

export interface WorkspaceOperationLogFinalizeSummary {
  bytes: number;
  sha256?: string;
  compressed: boolean;
}

export interface WorkspaceOperationLogStore {
  begin(input: { companyId: string; operationId: string }): Promise<WorkspaceOperationLogHandle>;
  append(
    handle: WorkspaceOperationLogHandle,
    event: { stream: "stdout" | "stderr" | "system"; chunk: string; ts: string },
  ): Promise<void>;
  finalize(handle: WorkspaceOperationLogHandle): Promise<WorkspaceOperationLogFinalizeSummary>;
  read(handle: WorkspaceOperationLogHandle, opts?: WorkspaceOperationLogReadOptions): Promise<WorkspaceOperationLogReadResult>;
}

function safeSegments(...segments: string[]) {
  return segments.map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_"));
}

function resolveWithin(basePath: string, relativePath: string) {
  const resolved = path.resolve(basePath, relativePath);
  const base = path.resolve(basePath) + path.sep;
  if (!resolved.startsWith(base) && resolved !== path.resolve(basePath)) {
    throw new Error("Invalid log path");
  }
  return resolved;
}

function createLocalFileWorkspaceOperationLogStore(basePath: string): WorkspaceOperationLogStore {
  async function ensureDir(relativeDir: string) {
    const dir = resolveWithin(basePath, relativeDir);
    await fs.mkdir(dir, { recursive: true });
  }

  async function readFileRange(filePath: string, offset: number, limitBytes: number): Promise<WorkspaceOperationLogReadResult> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw notFound("Workspace operation log not found");

    const start = Math.max(0, Math.min(offset, stat.size));
    const end = Math.max(start, Math.min(start + limitBytes - 1, stat.size - 1));

    if (start > end) {
      return { content: "", nextOffset: start };
    }

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath, { start, end });
      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });

    const content = Buffer.concat(chunks).toString("utf8");
    const nextOffset = end + 1 < stat.size ? end + 1 : undefined;
    return { content, nextOffset };
  }

  async function sha256File(filePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  return {
    async begin(input) {
      const [companyId] = safeSegments(input.companyId);
      const operationId = safeSegments(input.operationId)[0]!;
      const relDir = companyId;
      const relPath = path.join(relDir, `${operationId}.ndjson`);
      await ensureDir(relDir);

      const absPath = resolveWithin(basePath, relPath);
      await fs.writeFile(absPath, "", "utf8");

      return { store: "local_file", logRef: relPath };
    },

    async append(handle, event) {
      if (handle.store !== "local_file") return;
      const absPath = resolveWithin(basePath, handle.logRef);
      const line = JSON.stringify({
        ts: event.ts,
        stream: event.stream,
        chunk: event.chunk,
      });
      await fs.appendFile(absPath, `${line}\n`, "utf8");
    },

    async finalize(handle) {
      if (handle.store !== "local_file") {
        return { bytes: 0, compressed: false };
      }
      const absPath = resolveWithin(basePath, handle.logRef);
      const stat = await fs.stat(absPath).catch(() => null);
      if (!stat) throw notFound("Workspace operation log not found");

      const hash = await sha256File(absPath);
      return {
        bytes: stat.size,
        sha256: hash,
        compressed: false,
      };
    },

    async read(handle, opts) {
      if (handle.store !== "local_file") {
        throw notFound("Workspace operation log not found");
      }
      const absPath = resolveWithin(basePath, handle.logRef);
      const offset = opts?.offset ?? 0;
      const limitBytes = opts?.limitBytes ?? 256_000;
      return readFileRange(absPath, offset, limitBytes);
    },
  };
}

function createS3WorkspaceOperationLogStore(): WorkspaceOperationLogStore {
  const client = getS3LogClient();

  return {
    async begin(input) {
      const [companyId] = safeSegments(input.companyId);
      const operationId = safeSegments(input.operationId)[0]!;
      const key = `data/workspace-operation-logs/${companyId}/${operationId}.ndjson`;
      client.createBuffer(key);
      return { store: "s3" as const, logRef: key };
    },

    async append(handle, event) {
      if (handle.store !== "s3") return;
      const buffer = client.getBuffer(handle.logRef);
      if (!buffer) return;
      const line = JSON.stringify({
        ts: event.ts,
        stream: event.stream,
        chunk: event.chunk,
      });
      client.appendToBuffer(buffer, line);
    },

    async finalize(handle) {
      if (handle.store !== "s3") {
        return { bytes: 0, compressed: false };
      }
      const buffer = client.getBuffer(handle.logRef);
      if (!buffer) return { bytes: 0, compressed: false };
      const { bytes, sha256 } = await client.flush(buffer);
      return { bytes, sha256, compressed: false };
    },

    async read(handle, opts) {
      if (handle.store !== "s3") {
        throw notFound("Workspace operation log not found");
      }
      const offset = opts?.offset ?? 0;
      const limitBytes = opts?.limitBytes ?? 256_000;
      const buffer = client.getBuffer(handle.logRef);
      if (buffer) {
        return client.readFromBuffer(buffer, offset, limitBytes);
      }
      return client.readRange(handle.logRef, offset, limitBytes);
    },
  };
}

let cachedS3Store: WorkspaceOperationLogStore | null = null;

function getOrCreateS3WorkspaceOperationLogStore(): WorkspaceOperationLogStore {
  if (cachedS3Store) return cachedS3Store;
  cachedS3Store = createS3WorkspaceOperationLogStore();
  return cachedS3Store;
}

let cachedStore: WorkspaceOperationLogStore | null = null;

export function getWorkspaceOperationLogStore(): WorkspaceOperationLogStore {
  if (cachedStore) return cachedStore;
  if (process.env.PAPERCLIP_STORAGE_PROVIDER === "s3") {
    cachedStore = getOrCreateS3WorkspaceOperationLogStore();
  } else {
    const basePath = process.env.WORKSPACE_OPERATION_LOG_BASE_PATH
      ?? path.resolve(resolvePaperclipInstanceRoot(), "data", "workspace-operation-logs");
    cachedStore = createLocalFileWorkspaceOperationLogStore(basePath);
  }
  return cachedStore;
}

/** Dispatches read to the correct store based on handle.store value. */
export async function readWorkspaceOperationLogByHandle(
  handle: WorkspaceOperationLogHandle,
  opts?: WorkspaceOperationLogReadOptions,
): Promise<WorkspaceOperationLogReadResult> {
  if (handle.store === "s3") {
    return getOrCreateS3WorkspaceOperationLogStore().read(handle, opts);
  }
  const basePath = process.env.WORKSPACE_OPERATION_LOG_BASE_PATH
    ?? path.resolve(resolvePaperclipInstanceRoot(), "data", "workspace-operation-logs");
  return createLocalFileWorkspaceOperationLogStore(basePath).read(handle, opts);
}
