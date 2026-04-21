// Providers
export const DeploymentProvider = {
  VERCEL: "vercel",
} as const;
export type DeploymentProvider = (typeof DeploymentProvider)[keyof typeof DeploymentProvider];
export const DEPLOYMENT_PROVIDERS = Object.values(DeploymentProvider) as [DeploymentProvider, ...DeploymentProvider[]];

// Statuses (state machine)
export const DeploymentStatus = {
  PENDING:       "pending",
  DEPLOYING:     "deploying",
  DEPLOYED:      "deployed",
  DEPLOY_FAILED: "deploy_failed",
  STOPPING:      "stopping",
  STOPPED:       "stopped",
  STOP_FAILED:   "stop_failed",
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];
export const DEPLOYMENT_STATUSES = Object.values(DeploymentStatus) as [DeploymentStatus, ...DeploymentStatus[]];

// Active = counts toward quota (every status except STOPPED).
export const DEPLOYMENT_ACTIVE_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.PENDING,
  DeploymentStatus.DEPLOYING,
  DeploymentStatus.DEPLOYED,
  DeploymentStatus.STOPPING,
  DeploymentStatus.DEPLOY_FAILED,
  DeploymentStatus.STOP_FAILED,
];

// Idle = Stop allowed.
export const DEPLOYMENT_IDLE_STATUSES: readonly DeploymentStatus[] = [
  DeploymentStatus.DEPLOYED,
  DeploymentStatus.DEPLOY_FAILED,
  DeploymentStatus.STOP_FAILED,
];

// Deployment types
export const DeploymentType = {
  PREVIEW:    "preview",
  PRODUCTION: "production",
} as const;
export type DeploymentType = (typeof DeploymentType)[keyof typeof DeploymentType];
export const DEPLOYMENT_TYPES = Object.values(DeploymentType) as [DeploymentType, ...DeploymentType[]];

// PATCH body actions
export const DeploymentAction = {
  DEPLOY:  "deploy",
  STOP:    "stop",
  REFRESH: "refresh",
} as const;
export type DeploymentAction = (typeof DeploymentAction)[keyof typeof DeploymentAction];
export const DEPLOYMENT_ACTIONS = Object.values(DeploymentAction) as [DeploymentAction, ...DeploymentAction[]];

// CEO wakeup payload kinds
export const DeploymentWakeupKind = {
  DEPLOY:    "deploy",
  TEARDOWN:  "teardown",
  RECONCILE: "reconcile",
} as const;
export type DeploymentWakeupKind = (typeof DeploymentWakeupKind)[keyof typeof DeploymentWakeupKind];
export const DEPLOYMENT_WAKEUP_KINDS = Object.values(DeploymentWakeupKind) as [DeploymentWakeupKind, ...DeploymentWakeupKind[]];

// Agent -> server /result endpoint kinds.
export const DeploymentResultKind = {
  DEPLOY_STARTED:    "deploy_started",
  DEPLOY:            "deploy",
  TEARDOWN_STARTED:  "teardown_started",
  TEARDOWN:          "teardown",
  RECONCILE_STARTED: "reconcile_started",
  RECONCILE:         "reconcile",
} as const;
export type DeploymentResultKind = (typeof DeploymentResultKind)[keyof typeof DeploymentResultKind];
export const DEPLOYMENT_RESULT_KINDS = Object.values(DeploymentResultKind) as [DeploymentResultKind, ...DeploymentResultKind[]];

// "Started" subset — reported by the agent on entry; no `success` field expected.
// The corresponding final kinds (DEPLOY / TEARDOWN / RECONCILE) carry `success: boolean`.
export const DEPLOYMENT_RESULT_STARTED_KINDS: readonly DeploymentResultKind[] = [
  DeploymentResultKind.DEPLOY_STARTED,
  DeploymentResultKind.TEARDOWN_STARTED,
  DeploymentResultKind.RECONCILE_STARTED,
];

// Helpers

export function isActiveDeploymentStatus(status: DeploymentStatus): boolean {
  return DEPLOYMENT_ACTIVE_STATUSES.includes(status);
}

export function isIdleDeploymentStatus(status: DeploymentStatus): boolean {
  return DEPLOYMENT_IDLE_STATUSES.includes(status);
}

export function isStartedDeploymentResultKind(kind: DeploymentResultKind): boolean {
  return DEPLOYMENT_RESULT_STARTED_KINDS.includes(kind);
}

// Target name shape
export const DEPLOYMENT_TARGET_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Manifest filename (plain JSON; agent-maintained, occasionally hand-edited)
export const DEPLOYMENT_MANIFEST_FILENAME = "deploy-targets.json";
