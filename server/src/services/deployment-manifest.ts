import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../middleware/logger.js";
import {
  deploymentManifestTargetSchema,
  DEPLOYMENT_MANIFEST_FILENAME,
  type DeploymentManifestTarget,
} from "@paperclipai/shared";

export interface ReadManifestResult {
  targets: DeploymentManifestTarget[];
  warnings: string[];
}

export async function readDeploymentManifest(repoDir: string): Promise<ReadManifestResult> {
  const filePath = path.join(repoDir, DEPLOYMENT_MANIFEST_FILENAME);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { targets: [], warnings: [] };
    logger.warn({ err, filePath }, `${DEPLOYMENT_MANIFEST_FILENAME} read failed`);
    return { targets: [], warnings: [`read failed: ${(err as Error).message}`] };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (err) { return { targets: [], warnings: [`json parse error: ${(err as Error).message}`] }; }

  const warnings: string[] = [];
  const rawTargets = (parsed as { targets?: unknown[] } | null)?.targets ?? [];
  const ok: DeploymentManifestTarget[] = [];
  for (const [i, t] of rawTargets.entries()) {
    const check = deploymentManifestTargetSchema.safeParse(t);
    if (check.success) ok.push(check.data);
    else warnings.push(`target[${i}] invalid: ${check.error.issues[0]?.message ?? "unknown"}`);
  }
  return { targets: ok, warnings };
}
