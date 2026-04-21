import { createHash } from "node:crypto";

const MAX_LEN = 100;

export interface BuildNameInput {
  env: string;
  companyId: string;
  companySlug: string;
  projectId: string;
  projectSlug: string;
  targetName: string;
}

export function buildVercelProjectName(input: BuildNameInput): string {
  const env = input.env.trim() || "local";
  const hash = createHash("sha1")
    .update(`${input.companyId}:${input.projectId}`)
    .digest("hex")
    .slice(0, 8);

  // Four separator dashes + the fixed (non-projectSlug) segments define how many chars remain for projectSlug.
  const fixedLength =
    env.length + input.companySlug.length + input.targetName.length + hash.length + 4;
  const projectBudget = Math.max(1, MAX_LEN - fixedLength);
  const projectSlug = input.projectSlug.slice(0, projectBudget);

  return [env, input.companySlug, projectSlug, input.targetName, hash].join("-");
}
