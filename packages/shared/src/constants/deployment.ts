export const DEPLOYMENT_PROVIDERS = ["vercel"] as const;
export type DeploymentProvider = (typeof DEPLOYMENT_PROVIDERS)[number];

export const DEPLOYMENT_STATUSES = [
  "pending",
  "deploying",
  "deployed",
  "deploy_failed",
  "stopping",
  "stopped",
  "stop_failed",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_ACTIVE_STATUSES: readonly DeploymentStatus[] = [
  "pending", "deploying", "deployed",
  "stopping", "deploy_failed", "stop_failed",
];

export const DEPLOYMENT_IDLE_STATUSES: readonly DeploymentStatus[] = [
  "deployed", "deploy_failed", "stop_failed",
];

export const DEPLOYMENT_TYPES = ["preview", "production"] as const;
export type DeploymentType = (typeof DEPLOYMENT_TYPES)[number];

export function isActiveDeploymentStatus(status: DeploymentStatus): boolean {
  return DEPLOYMENT_ACTIVE_STATUSES.includes(status);
}

export function isIdleDeploymentStatus(status: DeploymentStatus): boolean {
  return DEPLOYMENT_IDLE_STATUSES.includes(status);
}

export const DEPLOYMENT_TARGET_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
