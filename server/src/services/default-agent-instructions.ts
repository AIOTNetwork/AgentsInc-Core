import fs from "node:fs/promises";
import { loadAgencyBundle } from "./agency-catalog.js";

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
