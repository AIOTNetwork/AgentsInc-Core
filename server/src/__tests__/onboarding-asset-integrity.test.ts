import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ONBOARDING_DIR = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../onboarding-assets",
);

const REQUIRED_FILES = ["AGENTS.md", "SOUL.md", "HEARTBEAT.md"] as const;
const MIN_CONTENT_LENGTH = 50;
const CEO_DEFAULT_FILES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"];
const CATALOG_SOURCES = ["agency-agents", "aiot-agents"] as const;

interface CatalogEntry {
  path: string;
  source: string;
  category: string;
  name: string;
  defaultRole: string;
  description: string;
  bundlePath: string;
  bundleFiles: string[];
  desiredSkills?: string[];
}

async function loadAllCatalogs(): Promise<CatalogEntry[]> {
  const all: CatalogEntry[] = [];
  for (const source of CATALOG_SOURCES) {
    const catalogPath = path.join(ONBOARDING_DIR, source, "catalog.json");
    const raw = await fs.readFile(catalogPath, "utf8");
    const entries: CatalogEntry[] = JSON.parse(raw);
    all.push(...entries);
  }
  return all;
}

function formatReport(
  fileName: string,
  failures: { name: string; bundlePath: string; reason: string }[],
): string {
  if (failures.length === 0) return "";
  const header = `\nMissing or invalid ${fileName} for ${failures.length} agent(s):\n`;
  const tableHeader = "| Agent | Bundle Path | Reason |\n|-------|-------------|--------|";
  const rows = failures
    .map((f) => `| ${f.name} | ${f.bundlePath} | ${f.reason} |`)
    .join("\n");
  return `${header}${tableHeader}\n${rows}`;
}

describe("catalog loading", () => {
  it("loads agency-agents catalog.json", async () => {
    const catalogPath = path.join(ONBOARDING_DIR, "agency-agents", "catalog.json");
    const raw = await fs.readFile(catalogPath, "utf8");
    const entries: CatalogEntry[] = JSON.parse(raw);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("loads aiot-agents catalog.json", async () => {
    const catalogPath = path.join(ONBOARDING_DIR, "aiot-agents", "catalog.json");
    const raw = await fs.readFile(catalogPath, "utf8");
    const entries: CatalogEntry[] = JSON.parse(raw);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("every entry has required schema fields", async () => {
    const catalog = await loadAllCatalogs();
    for (const entry of catalog) {
      expect(entry.name, `entry at ${entry.bundlePath} missing name`).toBeTruthy();
      expect(entry.bundlePath, `entry "${entry.name}" missing bundlePath`).toBeTruthy();
      expect(
        Array.isArray(entry.bundleFiles),
        `entry "${entry.name}" bundleFiles is not an array`,
      ).toBe(true);
      expect(
        entry.bundleFiles.length,
        `entry "${entry.name}" bundleFiles is empty`,
      ).toBeGreaterThan(0);
      expect(entry.defaultRole, `entry "${entry.name}" missing defaultRole`).toBeTruthy();
      expect(entry.source, `entry "${entry.name}" missing source`).toBeTruthy();
    }
  });
});

describe("required files exist with meaningful content", () => {
  it("AGENTS.md exists and has >50 chars for every agent", async () => {
    const catalog = await loadAllCatalogs();
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const entry of catalog) {
      const filePath = path.join(ONBOARDING_DIR, entry.bundlePath, "AGENTS.md");
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          failures.push({
            name: entry.name,
            bundlePath: entry.bundlePath,
            reason: `content too short (${content.trim().length} chars)`,
          });
        }
      } catch {
        failures.push({ name: entry.name, bundlePath: entry.bundlePath, reason: "file missing" });
      }
    }
    expect(failures, formatReport("AGENTS.md", failures)).toHaveLength(0);
  });

  it("SOUL.md exists and has >50 chars for every agent", async () => {
    const catalog = await loadAllCatalogs();
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const entry of catalog) {
      const filePath = path.join(ONBOARDING_DIR, entry.bundlePath, "SOUL.md");
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          failures.push({
            name: entry.name,
            bundlePath: entry.bundlePath,
            reason: `content too short (${content.trim().length} chars)`,
          });
        }
      } catch {
        failures.push({ name: entry.name, bundlePath: entry.bundlePath, reason: "file missing" });
      }
    }
    expect(failures, formatReport("SOUL.md", failures)).toHaveLength(0);
  });

  it("HEARTBEAT.md exists and has >50 chars for every agent", async () => {
    const catalog = await loadAllCatalogs();
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const entry of catalog) {
      const filePath = path.join(ONBOARDING_DIR, entry.bundlePath, "HEARTBEAT.md");
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          failures.push({
            name: entry.name,
            bundlePath: entry.bundlePath,
            reason: `content too short (${content.trim().length} chars)`,
          });
        }
      } catch {
        failures.push({
          name: entry.name,
          bundlePath: entry.bundlePath,
          reason: "file missing",
        });
      }
    }
    expect(failures, formatReport("HEARTBEAT.md", failures)).toHaveLength(0);
  });
});

describe("bundleFiles declared in catalog match disk", () => {
  it("every declared bundleFile exists on disk", async () => {
    const catalog = await loadAllCatalogs();
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const entry of catalog) {
      for (const file of entry.bundleFiles) {
        const filePath = path.join(ONBOARDING_DIR, entry.bundlePath, file);
        try {
          await fs.access(filePath);
        } catch {
          failures.push({
            name: entry.name,
            bundlePath: entry.bundlePath,
            reason: `declared file "${file}" not found on disk`,
          });
        }
      }
    }
    expect(
      failures,
      formatReport("bundleFiles", failures),
    ).toHaveLength(0);
  });

  it("no undeclared .md files on disk (excluding SOURCE.md)", async () => {
    const catalog = await loadAllCatalogs();
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const entry of catalog) {
      const bundleDir = path.join(ONBOARDING_DIR, entry.bundlePath);
      let files: string[];
      try {
        files = await fs.readdir(bundleDir);
      } catch {
        continue;
      }
      const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "SOURCE.md");
      const declared = new Set(entry.bundleFiles);
      const extras = mdFiles.filter((f) => !declared.has(f));
      for (const extra of extras) {
        failures.push({
          name: entry.name,
          bundlePath: entry.bundlePath,
          reason: `undeclared file "${extra}" found on disk`,
        });
      }
    }
    expect(
      failures,
      formatReport("undeclared files", failures),
    ).toHaveLength(0);
  });
});

describe("CEO default bundle", () => {
  it("ceo/ directory contains all 4 required files", async () => {
    const failures: { name: string; bundlePath: string; reason: string }[] = [];
    for (const file of CEO_DEFAULT_FILES) {
      const filePath = path.join(ONBOARDING_DIR, "ceo", file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          failures.push({
            name: "CEO",
            bundlePath: "ceo",
            reason: `${file} content too short (${content.trim().length} chars)`,
          });
        }
      } catch {
        failures.push({ name: "CEO", bundlePath: "ceo", reason: `${file} missing` });
      }
    }
    expect(failures, formatReport("CEO bundle", failures)).toHaveLength(0);
  });

  it("default/ directory contains AGENTS.md", async () => {
    const filePath = path.join(ONBOARDING_DIR, "default", "AGENTS.md");
    const content = await fs.readFile(filePath, "utf8");
    expect(content.trim().length).toBeGreaterThanOrEqual(MIN_CONTENT_LENGTH);
  });
});

describe("integrity summary report", () => {
  it("produces a summary of all agents missing any required file", async () => {
    const catalog = await loadAllCatalogs();
    const missing: { name: string; bundlePath: string; missingFiles: string[] }[] = [];

    for (const entry of catalog) {
      const entryMissing: string[] = [];
      for (const file of REQUIRED_FILES) {
        const filePath = path.join(ONBOARDING_DIR, entry.bundlePath, file);
        try {
          const content = await fs.readFile(filePath, "utf8");
          if (content.trim().length < MIN_CONTENT_LENGTH) {
            entryMissing.push(file);
          }
        } catch {
          entryMissing.push(file);
        }
      }
      if (entryMissing.length > 0) {
        missing.push({
          name: entry.name,
          bundlePath: entry.bundlePath,
          missingFiles: entryMissing,
        });
      }
    }

    if (missing.length > 0) {
      const header = "Missing onboarding files:\n\n| Agent | Bundle Path | Missing |\n|-------|-------------|---------|";
      const rows = missing
        .map((m) => `| ${m.name} | ${m.bundlePath} | ${m.missingFiles.join(", ")} |`)
        .join("\n");
      expect(missing, `${header}\n${rows}`).toHaveLength(0);
    }

    expect(missing).toHaveLength(0);
  });
});
