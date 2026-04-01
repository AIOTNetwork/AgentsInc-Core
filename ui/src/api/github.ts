import { api } from "./client";

export interface GitHubStatus {
  connected: boolean;
  enabled: boolean;
  hasPat?: boolean;
  account?: string;
  accountType?: string;
  isDefault?: boolean;
}

export interface GitHubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export const githubApi = {
  getStatus: (companyId: string) =>
    api.get<GitHubStatus>(`/github/status?companyId=${encodeURIComponent(companyId)}`),

  listRepos: (companyId: string) =>
    api.get<{ repos: GitHubRepo[] }>(`/github/repos?companyId=${encodeURIComponent(companyId)}`),

  disconnect: (companyId: string) =>
    api.post<{ ok: boolean }>("/github/disconnect", { companyId }),

  /** Get the default repo URL for a project */
  getDefaultRepoUrl: (companyId: string, projectName: string, projectId: string) =>
    api.get<{ defaultRepoUrl: string }>(
      `/github/default-repo-url?companyId=${encodeURIComponent(companyId)}&projectName=${encodeURIComponent(projectName)}&projectId=${encodeURIComponent(projectId)}`,
    ),

  /** Ensure a repo exists on GitHub, creating it if missing. Validates repoUrl matches expected default. */
  ensureRepo: (companyId: string, projectName: string, projectId: string, repoUrl: string) =>
    api.post<{ created: boolean; fullName?: string; cloneUrl?: string; message?: string }>(
      "/github/ensure-repo",
      { companyId, projectName, projectId, repoUrl },
    ),

  /** Returns the URL to redirect the user to for GitHub App installation */
  getInstallUrl: (companyId: string) =>
    `/api/github/install?companyId=${encodeURIComponent(companyId)}`,
};
