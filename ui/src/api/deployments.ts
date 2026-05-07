import type {
  Deployment,
  DeploymentManifestTarget,
  DeploymentsPatchBody,
  DeploymentSettingsUpdateBody,
} from "@paperclipai/shared";
import { api } from "./client";

export interface DeploymentQuotaSnapshot {
  project: { used: number; limit: number; planCap: number };
  repo: { used: number; limit: number; planCap: number };
}

export interface DeploymentsListResponse {
  deployments: Deployment[];
  manifestTargets: DeploymentManifestTarget[];
  quota: DeploymentQuotaSnapshot;
}

export interface DeploymentsPatchResponse {
  deployments: Deployment[];
}

export interface DeploymentSettingsResponse {
  maxDeployableProjects: number;
  maxDeploymentsPerRepo: number;
  plan: {
    maxDeployableProjectsCap: number;
    maxDeploymentsPerRepoCap: number;
  };
}

function listPath(companyId: string, projectId: string) {
  return `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/deployments`;
}

function settingsPath(companyId: string) {
  return `/companies/${encodeURIComponent(companyId)}/deployment-settings`;
}

export interface DeploymentsSweepResponse {
  swept: number;
  sweptIds: string[];
}

export const deploymentsApi = {
  list: (companyId: string, projectId: string) =>
    api.get<DeploymentsListResponse>(listPath(companyId, projectId)),
  patch: (companyId: string, projectId: string, body: DeploymentsPatchBody) =>
    api.patch<DeploymentsPatchResponse>(listPath(companyId, projectId), body),
  sweep: (companyId: string, projectId: string) =>
    api.post<DeploymentsSweepResponse>(`${listPath(companyId, projectId)}/sweep`, {}),
  getSettings: (companyId: string) =>
    api.get<DeploymentSettingsResponse>(settingsPath(companyId)),
  patchSettings: (companyId: string, body: DeploymentSettingsUpdateBody) =>
    api.patch<DeploymentSettingsResponse>(settingsPath(companyId), body),
};
