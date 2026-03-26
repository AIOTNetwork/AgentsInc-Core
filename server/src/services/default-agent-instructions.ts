import fs from "node:fs/promises";
import { findCatalogEntry, getAgencyCatalog, loadAgencyBundle } from "./agency-catalog.js";

const DEFAULT_AGENT_BUNDLE_FILES = {
  default: ["AGENTS.md"],
  ceo: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
} as const;

type DefaultAgentBundleRole = keyof typeof DEFAULT_AGENT_BUNDLE_FILES;

function resolveDefaultAgentBundleUrl(role: DefaultAgentBundleRole, fileName: string) {
  return new URL(`../onboarding-assets/${role}/${fileName}`, import.meta.url);
}

export async function loadDefaultAgentInstructionsBundle(role: DefaultAgentBundleRole): Promise<Record<string, string>> {
  const fileNames = DEFAULT_AGENT_BUNDLE_FILES[role];
  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const content = await fs.readFile(resolveDefaultAgentBundleUrl(role, fileName), "utf8");
      return [fileName, content] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function resolveDefaultAgentInstructionsBundleRole(role: string): DefaultAgentBundleRole {
  return role === "ceo" ? "ceo" : "default";
}

/**
 * Load an instructions bundle from the agency catalog by bundlePath.
 * Falls back to the default bundle for the role if the catalog path is not found.
 */
export async function loadAgentInstructionsFromCatalog(
  bundlePath: string,
  fallbackRole: string,
): Promise<Record<string, string>> {
  const bundle = await loadAgencyBundle(bundlePath);
  if (bundle) return bundle;
  return loadDefaultAgentInstructionsBundle(resolveDefaultAgentInstructionsBundleRole(fallbackRole));
}

/**
 * Score how well a catalog entry matches the requested agent name.
 * Higher score = better match.
 */
function scoreMatch(entryName: string, entryDescription: string, queryName: string): number {
  const eName = entryName.toLowerCase();
  const eDesc = entryDescription.toLowerCase();
  const qName = queryName.toLowerCase();
  const qWords = qName.split(/\s+/).filter(Boolean);

  // Exact name match
  if (eName === qName) return 100;

  // Name contains query or query contains name
  if (eName.includes(qName)) return 80;
  if (qName.includes(eName)) return 70;

  // Word overlap between query and entry name
  const eWords = eName.split(/\s+/);
  const nameOverlap = qWords.filter((w) => eWords.some((ew) => ew.includes(w) || w.includes(ew))).length;
  if (nameOverlap > 0) return 50 + nameOverlap * 10;

  // Word overlap with description
  const descOverlap = qWords.filter((w) => eDesc.includes(w)).length;
  if (descOverlap > 0) return 20 + descOverlap * 5;

  return 0;
}

function pickBestMatch(
  entries: import("./agency-catalog.js").AgencyCatalogEntry[],
  queryName: string,
): import("./agency-catalog.js").AgencyCatalogEntry {
  let best = entries[0];
  let bestScore = 0;
  for (const entry of entries) {
    const score = scoreMatch(entry.name, entry.description, queryName);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

export interface ResolvedAgentInstructions {
  files: Record<string, string>;
  desiredSkills?: string[];
  matchedCatalogEntry?: string;
}

/**
 * Resolve instructions for a new agent hire.
 * Priority:
 *   1. Explicit catalogPath provided in the hire request
 *   2. Best match from agency catalog by role + name
 *   3. Default bundle for the role (ceo → ceo/, else → default/)
 *
 * Returns files + optional desiredSkills from the matched catalog entry.
 */
export async function resolveAgentInstructionsForHire(
  role: string,
  name: string,
  catalogPath?: string | null,
): Promise<ResolvedAgentInstructions> {
  // 1. Explicit catalog path
  if (catalogPath) {
    const entry = await findCatalogEntry(catalogPath);
    const bundle = await loadAgencyBundle(catalogPath);
    if (bundle) {
      return {
        files: bundle,
        desiredSkills: entry?.desiredSkills,
        matchedCatalogEntry: entry?.bundlePath ?? catalogPath,
      };
    }
  }

  // 2. CEO always uses the ceo/ bundle
  if (role === "ceo") {
    return { files: await loadDefaultAgentInstructionsBundle("ceo") };
  }

  // 3. Look up agency catalog by role, pick best match by name similarity
  try {
    const catalog = await getAgencyCatalog();
    const byRole = catalog.filter((e) => e.defaultRole === role);

    if (byRole.length > 0) {
      const entry = pickBestMatch(byRole, name);
      const bundle = await loadAgencyBundle(entry.bundlePath);
      if (bundle) {
        return {
          files: bundle,
          desiredSkills: entry.desiredSkills,
          matchedCatalogEntry: entry.bundlePath,
        };
      }
    }
  } catch {
    // Catalog not available — fall through to default
  }

  // 4. Fallback
  return { files: await loadDefaultAgentInstructionsBundle("default") };
}
