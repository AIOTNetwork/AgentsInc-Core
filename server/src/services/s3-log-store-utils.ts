import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { logger } from "../middleware/logger.js";

export interface S3LogStoreConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  prefix?: string;
  forcePathStyle?: boolean;
}

export interface S3LogBuffer {
  key: string;
  chunks: string[];
}

export interface S3LogClient {
  createBuffer(key: string): S3LogBuffer;
  appendToBuffer(buffer: S3LogBuffer, line: string): void;
  flush(buffer: S3LogBuffer): Promise<{ bytes: number; sha256: string }>;
  readRange(
    key: string,
    offset: number,
    limitBytes: number,
  ): Promise<{ content: string; nextOffset?: number }>;
  readFromBuffer(
    buffer: S3LogBuffer,
    offset: number,
    limitBytes: number,
  ): { content: string; nextOffset?: number };
  getBuffer(key: string): S3LogBuffer | undefined;
  removeBuffer(key: string): void;
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  return prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function buildKey(prefix: string, objectKey: string): string {
  return prefix ? `${prefix}/${objectKey}` : objectKey;
}

function isS3NotFound(err: unknown): boolean {
  const code = (err as { name?: string }).name;
  return code === "NoSuchKey" || code === "NotFound";
}

export function createS3LogClient(config: S3LogStoreConfig): S3LogClient {
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.forcePathStyle),
  });

  const prefix = normalizePrefix(config.prefix);
  const buffers = new Map<string, S3LogBuffer>();

  return {
    createBuffer(key: string): S3LogBuffer {
      const buffer: S3LogBuffer = { key, chunks: [] };
      buffers.set(key, buffer);
      return buffer;
    },

    appendToBuffer(buffer: S3LogBuffer, line: string): void {
      buffer.chunks.push(line);
    },

    async flush(buffer: S3LogBuffer): Promise<{ bytes: number; sha256: string }> {
      const content = buffer.chunks.join("\n") + (buffer.chunks.length > 0 ? "\n" : "");
      const body = Buffer.from(content, "utf8");
      const sha256 = createHash("sha256").update(body).digest("hex");

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: buildKey(prefix, buffer.key),
          Body: body,
          ContentType: "application/x-ndjson",
          ContentLength: body.length,
        }),
      );

      buffers.delete(buffer.key);
      return { bytes: body.length, sha256 };
    },

    async readRange(
      key: string,
      offset: number,
      limitBytes: number,
    ): Promise<{ content: string; nextOffset?: number }> {
      const s3Key = buildKey(prefix, key);

      // First get the object size
      let totalSize: number;
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: s3Key }),
        );
        totalSize = head.ContentLength ?? 0;
      } catch (err) {
        if (isS3NotFound(err)) {
          logger.warn({ key: s3Key }, "Run log S3 object missing");
          return { content: "" };
        }
        throw err;
      }

      const start = Math.max(0, Math.min(offset, totalSize));
      const end = Math.max(start, Math.min(start + limitBytes - 1, totalSize - 1));

      if (start >= totalSize || totalSize === 0) {
        return { content: "", nextOffset: start };
      }

      try {
        const output = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: s3Key,
            Range: `bytes=${start}-${end}`,
          }),
        );
        const bytes = await output.Body!.transformToByteArray();
        const content = Buffer.from(bytes).toString("utf8");
        const nextOffset = end + 1 < totalSize ? end + 1 : undefined;
        return { content, nextOffset };
      } catch (err) {
        if (isS3NotFound(err)) {
          logger.warn({ key: s3Key }, "Run log S3 object missing");
          return { content: "" };
        }
        throw err;
      }
    },

    readFromBuffer(
      buffer: S3LogBuffer,
      offset: number,
      limitBytes: number,
    ): { content: string; nextOffset?: number } {
      const content = buffer.chunks.join("\n") + (buffer.chunks.length > 0 ? "\n" : "");
      const buf = Buffer.from(content, "utf8");
      const start = Math.max(0, Math.min(offset, buf.length));
      const end = Math.max(start, Math.min(start + limitBytes, buf.length));
      const slice = buf.subarray(start, end).toString("utf8");
      const nextOffset = end < buf.length ? end : undefined;
      return { content: slice, nextOffset };
    },

    getBuffer(key: string): S3LogBuffer | undefined {
      return buffers.get(key);
    },

    removeBuffer(key: string): void {
      buffers.delete(key);
    },
  };
}

let cachedClient: S3LogClient | null = null;

export function getS3LogClient(): S3LogClient {
  if (cachedClient) return cachedClient;

  const config: S3LogStoreConfig = {
    bucket: process.env.PAPERCLIP_STORAGE_S3_BUCKET ?? "agentsinccore",
    region: process.env.PAPERCLIP_STORAGE_S3_REGION ?? "us-east-1",
    endpoint: process.env.PAPERCLIP_STORAGE_S3_ENDPOINT || undefined,
    prefix: process.env.PAPERCLIP_STORAGE_S3_PREFIX ?? "",
    forcePathStyle: process.env.PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE === "true",
  };

  cachedClient = createS3LogClient(config);
  return cachedClient;
}

/**
 * Checks that the S3 bucket exists and is accessible.
 * Call during server startup when PAPERCLIP_STORAGE_PROVIDER=s3.
 * Throws if the bucket does not exist or is not accessible.
 */
export async function ensureS3BucketExists(): Promise<void> {
  const bucket = process.env.PAPERCLIP_STORAGE_S3_BUCKET ?? "agentsinccore";
  const region = process.env.PAPERCLIP_STORAGE_S3_REGION ?? "us-east-1";
  const endpoint = process.env.PAPERCLIP_STORAGE_S3_ENDPOINT || undefined;
  const forcePathStyle = process.env.PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE === "true";

  const client = new S3Client({ region, endpoint, forcePathStyle });

  const endpointLabel = endpoint ?? "(default AWS)";
  const prefix = normalizePrefix(process.env.PAPERCLIP_STORAGE_S3_PREFIX);
  const probeKey = prefix ? `${prefix}/.healthcheck` : ".healthcheck";

  try {
    // HeadObject on a probe key to verify bucket exists + credentials work.
    // NotFound (key doesn't exist) = bucket + auth OK.
    // NoSuchBucket = bucket missing. 403 = bad credentials.
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: probeKey }));
  } catch (err) {
    const code = (err as { name?: string }).name;
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

    // 404 / NotFound means the key doesn't exist but the bucket is accessible — this is success.
    if (code === "NotFound" || httpStatus === 404) {
      logger.info({ bucket, endpoint: endpointLabel }, "S3 bucket access check passed");
      return;
    }
    if (code === "NoSuchBucket") {
      throw new Error(
        `S3 bucket "${bucket}" does not exist at endpoint ${endpointLabel}. ` +
        `Create the bucket or check PAPERCLIP_STORAGE_S3_BUCKET / PAPERCLIP_STORAGE_S3_ENDPOINT.`,
      );
    }
    if (code === "AccessDenied" || code === "Forbidden" || httpStatus === 403) {
      throw new Error(
        `S3 bucket "${bucket}" at endpoint ${endpointLabel} is not accessible (permission denied). ` +
        `Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY credentials.`,
      );
    }
    throw new Error(
      `S3 bucket access check failed for "${bucket}" at endpoint ${endpointLabel}: ${code ?? "UnknownError"} (HTTP ${httpStatus ?? "?"}). ` +
      `${(err as Error).message ?? err}`,
    );
  }

  // If HeadObject succeeded (probe key exists), bucket + auth are fine.
  logger.info({ bucket, endpoint: endpointLabel }, "S3 bucket access check passed");
}
