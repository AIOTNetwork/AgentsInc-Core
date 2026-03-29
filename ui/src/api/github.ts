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

  /** Returns the URL to redirect the user to for GitHub App installation */
  getInstallUrl: (companyId: string) =>
    `/api/github/install?companyId=${encodeURIComponent(companyId)}`,
};
