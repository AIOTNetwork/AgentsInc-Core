import { z } from "zod";
import {
  DEPLOYMENT_ACTIONS,
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_RESULT_KINDS,
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TARGET_NAME_RE,
  DEPLOYMENT_TYPES,
  DeploymentAction,
  isStartedDeploymentResultKind,
} from "../constants/deployment.js";

export const deploymentTargetNameSchema = z
  .string()
  .regex(DEPLOYMENT_TARGET_NAME_RE, "invalid target name");

export const deploymentTypeSchema = z.enum(DEPLOYMENT_TYPES);
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export const deploymentProviderSchema = z.enum(DEPLOYMENT_PROVIDERS);
export const deploymentActionSchema = z.enum(DEPLOYMENT_ACTIONS);
export const deploymentResultKindSchema = z.enum(DEPLOYMENT_RESULT_KINDS);

const deploymentTargetEntrySchema = z.object({
  targetName: deploymentTargetNameSchema,
  type: deploymentTypeSchema.optional(),
});

export const deploymentsPatchSchema = z
  .object({
    action: deploymentActionSchema,
    targets: z.array(deploymentTargetEntrySchema).min(1).max(20).optional(),
  })
  .refine(
    (data) => {
      if (data.action === DeploymentAction.REFRESH) return !data.targets;
      if (!data.targets || data.targets.length === 0) return false;
      if (data.action === DeploymentAction.DEPLOY) {
        return data.targets.every((t) => typeof t.type === "string");
      }
      return true; // STOP: targetName only; type not required
    },
    { message: "invalid body shape for action" },
  );
export type DeploymentsPatchBody = z.infer<typeof deploymentsPatchSchema>;

export const deploymentResultSchema = z
  .object({
    kind: deploymentResultKindSchema,
    success: z.boolean().optional(),
    vercelProjectId: z.string().optional(),
    vercelDeploymentId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  })
  .refine(
    (data) =>
      isStartedDeploymentResultKind(data.kind)
        ? data.success === undefined
        : typeof data.success === "boolean",
    { message: "success required on final kinds", path: ["success"] },
  );
export type DeploymentResultBody = z.infer<typeof deploymentResultSchema>;

export const deploymentSettingsUpdateSchema = z.object({
  maxDeployableProjects: z.number().int().min(0).optional(),
  maxDeploymentsPerRepo: z.number().int().min(0).optional(),
});
export type DeploymentSettingsUpdateBody = z.infer<typeof deploymentSettingsUpdateSchema>;

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  targetName: z.string(),
  type: deploymentTypeSchema,
  provider: deploymentProviderSchema,
  status: deploymentStatusSchema,
  url: z.string().nullable(),
  vercelProjectId: z.string().nullable(),
  vercelDeploymentId: z.string().nullable(),
  lastError: z.string().nullable(),
  lastSyncedAt: z.coerce.date().nullable(),
  requestedByUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Deployment = z.infer<typeof deploymentSchema>;

export const deploymentManifestTargetSchema = z.object({
  name: deploymentTargetNameSchema,
  framework: z.string().optional(),
  dependsOn: z.array(deploymentTargetNameSchema).optional(),
});
export type DeploymentManifestTarget = z.infer<typeof deploymentManifestTargetSchema>;

export const deploymentManifestSchema = z.object({
  targets: z.array(deploymentManifestTargetSchema).default([]),
});
export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;
