import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstructionsS3Sync } from "../services/instructions-s3-sync.js";
import type { StorageProvider } from "../storage/types.js";

async function makeTempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * In-memory S3 mock that stores bundles as JSON blobs.
 */
function createMockS3Provider(): StorageProvider & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    id: "s3" as const,
    store,
    async putObject(params: { objectKey: string; body: Buffer; contentType?: string; contentLength?: number }) {
      store.set(params.objectKey, params.body);
    },
    async getObject(params: { objectKey: string }) {
      const data = store.get(params.objectKey);
      if (!data) throw new Error("NoSuchKey");
      return {
        stream: (async function* () { yield data; })(),
        contentType: "application/json",
        contentLength: data.length,
      };
    },
    async deleteObject(params: { objectKey: string }) {
      store.delete(params.objectKey);
    },
    async listObjects() { return { objects: [], truncated: false }; },
    async getSignedUrl() { return "https://mock-signed-url"; },
    async headObject() { return { contentLength: 0, contentType: "application/json" }; },
  } as StorageProvider & { store: Map<string, Buffer> };
}

function readS3Bundle(provider: ReturnType<typeof createMockS3Provider>, companyId: string, agentId: string): Record<string, string> | null {
  const key = `instructions/${companyId}/${agentId}/bundle.json`;
  const data = provider.store.get(key);
  if (!data) return null;
  return JSON.parse(data.toString("utf-8"));
}

describe("instructions-s3-sync", () => {
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all([...cleanupDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
      cleanupDirs.delete(dir);
    }));
  });

  describe("restoreFromS3 skips existing local files", () => {
    it("does not overwrite a file that already exists locally", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);
      const localRoot = await makeTempDir("restore-skip-");
      cleanupDirs.add(localRoot);

      // Seed S3 with a bundle containing two files
      await sync.saveFilesToS3("c1", "a1", {
        "AGENTS.md": "original from s3",
        "SOUL.md": "soul from s3",
      });

      // Write a local file with user edits
      await fs.writeFile(path.join(localRoot, "AGENTS.md"), "user edited content", "utf-8");

      // Restore from S3 — should only restore SOUL.md, not overwrite AGENTS.md
      const restored = await sync.restoreFromS3("c1", "a1", localRoot);
      expect(restored).toBe(true);

      const agentsContent = await fs.readFile(path.join(localRoot, "AGENTS.md"), "utf-8");
      expect(agentsContent).toBe("user edited content");

      const soulContent = await fs.readFile(path.join(localRoot, "SOUL.md"), "utf-8");
      expect(soulContent).toBe("soul from s3");
    });

    it("returns false when all files already exist locally", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);
      const localRoot = await makeTempDir("restore-all-exist-");
      cleanupDirs.add(localRoot);

      await sync.saveFilesToS3("c1", "a1", { "AGENTS.md": "s3 content" });
      await fs.writeFile(path.join(localRoot, "AGENTS.md"), "local content", "utf-8");

      const restored = await sync.restoreFromS3("c1", "a1", localRoot);
      expect(restored).toBe(false);

      // Local content should be preserved
      const content = await fs.readFile(path.join(localRoot, "AGENTS.md"), "utf-8");
      expect(content).toBe("local content");
    });
  });

  describe("saveFilesToS3 merges with existing bundle", () => {
    it("preserves existing files in S3 when saving new files", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);

      // Seed S3 with an initial file
      await sync.saveFilesToS3("c1", "a1", { "AGENTS.md": "agents content" });

      // Save a new file — should merge, not replace
      await sync.saveFilesToS3("c1", "a1", { "HEARTBEAT.md": "heartbeat content" });

      const bundle = readS3Bundle(provider, "c1", "a1");
      expect(bundle).toEqual({
        "AGENTS.md": "agents content",
        "HEARTBEAT.md": "heartbeat content",
      });
    });

    it("overwrites existing file content when same key is provided", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);

      await sync.saveFilesToS3("c1", "a1", { "AGENTS.md": "v1" });
      await sync.saveFilesToS3("c1", "a1", { "AGENTS.md": "v2" });

      const bundle = readS3Bundle(provider, "c1", "a1");
      expect(bundle?.["AGENTS.md"]).toBe("v2");
    });
  });

  describe("saveToS3 replaces entire bundle from disk state", () => {
    it("writes only files present on disk (full replace for replaceExisting)", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);
      const localRoot = await makeTempDir("save-to-s3-");
      cleanupDirs.add(localRoot);

      // Seed S3 with old files
      await sync.saveFilesToS3("c1", "a1", {
        "AGENTS.md": "old agents",
        "SOUL.md": "old soul",
        "NOTES.md": "user notes",
      });

      // Local disk only has new files (simulating replaceExisting)
      await fs.writeFile(path.join(localRoot, "AGENTS.md"), "new agents", "utf-8");
      await fs.writeFile(path.join(localRoot, "SOUL.md"), "new soul", "utf-8");

      // saveToS3 reads disk and replaces S3 entirely
      await sync.saveToS3("c1", "a1", localRoot);

      const bundle = readS3Bundle(provider, "c1", "a1");
      expect(bundle).toEqual({
        "AGENTS.md": "new agents",
        "SOUL.md": "new soul",
      });
      // NOTES.md should be gone — it was only in S3, not on disk
      expect(bundle?.["NOTES.md"]).toBeUndefined();
    });
  });

  describe("updateFileInS3 preserves other files", () => {
    it("updates one file without affecting others", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);

      await sync.saveFilesToS3("c1", "a1", {
        "AGENTS.md": "agents v1",
        "SOUL.md": "soul v1",
      });

      await sync.updateFileInS3("c1", "a1", "AGENTS.md", "agents v2");

      const bundle = readS3Bundle(provider, "c1", "a1");
      expect(bundle).toEqual({
        "AGENTS.md": "agents v2",
        "SOUL.md": "soul v1",
      });
    });
  });

  describe("deleteFileInS3 preserves other files", () => {
    it("removes only the specified file", async () => {
      const provider = createMockS3Provider();
      const sync = createInstructionsS3Sync(provider);

      await sync.saveFilesToS3("c1", "a1", {
        "AGENTS.md": "agents",
        "SOUL.md": "soul",
        "HEARTBEAT.md": "heartbeat",
      });

      await sync.deleteFileInS3("c1", "a1", "SOUL.md");

      const bundle = readS3Bundle(provider, "c1", "a1");
      expect(bundle).toEqual({
        "AGENTS.md": "agents",
        "HEARTBEAT.md": "heartbeat",
      });
    });
  });
});
