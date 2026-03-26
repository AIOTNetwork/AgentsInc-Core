import fs from "node:fs/promises";
import path from "node:path";

export interface AgencyCatalogEntry {
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

export interface ParsedAgencyAgent {
  agentsMd: string;
  soulMd: string;
  heartbeatMd: string;
}

const ONBOARDING_DIR = new URL("../onboarding-assets", import.meta.url);
const AGENCY_DIR = new URL("../onboarding-assets/agency", import.meta.url);

let catalogCache: AgencyCatalogEntry[] | null = null;

/**
 * Load the catalog.json from the agency onboarding assets.
 */
export async function getAgencyCatalog(): Promise<AgencyCatalogEntry[]> {
  if (catalogCache) return catalogCache;

  const catalogPath = new URL("catalog.json", AGENCY_DIR + "/");
  const raw = await fs.readFile(catalogPath, "utf8");
  catalogCache = JSON.parse(raw) as AgencyCatalogEntry[];
  return catalogCache;
}

/**
 * Read a single file relative to onboarding-assets/.
 */
export async function getAgencyAgentRaw(agentPath: string): Promise<string | null> {
  const normalized = path.normalize(agentPath);
  if (normalized.includes("..") || path.isAbsolute(normalized)) return null;

  const filePath = new URL(normalized, ONBOARDING_DIR + "/");
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Load pre-split instruction files from an agent directory.
 * bundlePath is relative to onboarding-assets/
 * (e.g. "agency/engineering/engineering-backend-architect").
 * Reads AGENTS.md, SOUL.md, HEARTBEAT.md — skips SOURCE.md.
 * Returns a Record<string, string> compatible with materializeManagedBundle.
 */
export async function loadAgencyBundle(bundlePath: string): Promise<Record<string, string> | null> {
  const normalized = path.normalize(bundlePath);
  if (normalized.includes("..") || path.isAbsolute(normalized)) return null;

  const bundleDir = new URL(normalized, ONBOARDING_DIR + "/");
  try {
    const files = await fs.readdir(bundleDir);
    const mdFiles = files.filter((f) => f.endsWith(".md") && f !== "SOURCE.md");
    if (mdFiles.length === 0) return null;

    const entries = await Promise.all(
      mdFiles.map(async (fileName) => {
        const content = await fs.readFile(new URL(fileName, bundleDir + "/"), "utf8");
        return [fileName, content] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/**
 * Read the pre-split files as a ParsedAgencyAgent (for the office UI API).
 */
export async function getAgencyAgentParsed(bundlePath: string): Promise<ParsedAgencyAgent | null> {
  const bundle = await loadAgencyBundle(bundlePath);
  if (!bundle) return null;

  return {
    agentsMd: bundle["AGENTS.md"] ?? "",
    soulMd: bundle["SOUL.md"] ?? "",
    heartbeatMd: bundle["HEARTBEAT.md"] ?? "",
  };
}

/**
 * Find a catalog entry by its bundlePath or path.
 */
export async function findCatalogEntry(agentPath: string): Promise<AgencyCatalogEntry | null> {
  const catalog = await getAgencyCatalog();
  return catalog.find((e) => e.path === agentPath || e.bundlePath === agentPath) ?? null;
}
