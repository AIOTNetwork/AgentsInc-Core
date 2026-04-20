import { z } from "zod";
import {
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TYPES,
  DEPLOYMENT_PROVIDERS,
  DEPLOYMENT_TARGET_NAME_RE,
} from "../constants/deployment.js";

export const deploymentTargetNameSchema = z
  .string()
  .regex(DEPLOYMENT_TARGET_NAME_RE, "invalid target name");

export const deploymentTypeSchema = z.enum(DEPLOYMENT_TYPES);
export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);
export const deploymentProviderSchema = z.enum(DEPLOYMENT_PROVIDERS);

const deployTargetSchema = z.object({
  targetName: deploymentTargetNameSchema,
  type: deploymentTypeSchema,
});
const stopTargetSchema = z.object({ targetName: deploymentTargetNameSchema });

export const deploymentsPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deploy"), targets: z.array(deployTargetSchema).min(1).max(20) }),
  z.object({ action: z.literal("stop"),   targets: z.array(stopTargetSchema).min(1).max(20) }),
  z.object({ action: z.literal("refresh") }),
]);
export type DeploymentsPatchBody = z.infer<typeof deploymentsPatchSchema>;

export const deploymentResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deploy_started") }),
  z.object({
    kind: z.literal("deploy"),
    success: z.boolean(),
    vercelProjectId: z.string().optional(),
    vercelDeploymentId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("teardown_started") }),
  z.object({
    kind: z.literal("teardown"),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal("reconcile_started") }),
  z.object({
    kind: z.literal("reconcile"),
    success: z.boolean(),
    vercelProjectId: z.string().optional(),
    vercelDeploymentId: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  }),
]);
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
