/**
 * GitHub App integration for authenticated git operations.
 *
 * Two modes:
 * 1. User-installed: company has a github_installations record → use installation token
 * 2. Default (AgentsInc org): no user installation → use the App's own installation on AIOTNetwork org
 *
 * Tokens are short-lived (1hr), generated on-demand, never stored.
 */
import crypto from "node:crypto";
import { resolvePaperclipInstanceId } from "../home-paths.js";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { githubInstallations } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const GITHUB_API = "https://api.github.com";

// --- Config ---

function getAppConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const defaultInstallationId = process.env.GITHUB_APP_DEFAULT_INSTALLATION_ID;
  const defaultOrg = process.env.GITHUB_APP_DEFAULT_ORG ?? "AIOTNetwork";

  if (!appId || !privateKey) return null;

  // Private key may be base64 encoded (for env vars that don't support newlines)
  let key = privateKey;
  if (!key.includes("-----BEGIN")) {
    key = Buffer.from(key, "base64").toString("utf-8");
  }

  return {
    appId,
    privateKey: key,
    defaultInstallationId: defaultInstallationId ? parseInt(defaultInstallationId, 10) : null,
    defaultOrg,
  };
}

// --- JWT ---

function base64url(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: appId,
    iat: now - 60,
    exp: now + 600, // 10 minutes
  })));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

// --- Installation Token ---

interface InstallationToken {
  token: string;
  expiresAt: string;
}

async function createInstallationToken(installationId: number): Promise<InstallationToken> {
  const config = getAppConfig();
  if (!config) throw new Error("GitHub App not configured");

  const jwt = generateAppJwt(config.appId, config.privateKey);
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub installation token failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

// --- Public API ---

export interface GitHubAppService {
  readonly enabled: boolean;

  /** Get the installation ID for a company (user-installed or default) */
  getInstallationId(companyId: string): Promise<number | null>;

  /** Generate a short-lived token for git operations */
  getInstallationToken(companyId: string): Promise<InstallationToken | null>;

  /** Rewrite a repo URL with installation token credentials */
  getCredentialUrl(companyId: string, repoUrl: string): Promise<string>;

  /** Store a new GitHub App installation for a company */
  saveInstallation(companyId: string, data: {
    installationId: number;
    accountLogin: string;
    accountType: string;
    userId?: string | null;
  }): Promise<void>;

  /** Remove a company's GitHub installation */
  removeInstallation(companyId: string): Promise<void>;

  /** Get installation info for a company */
  getInstallation(companyId: string): Promise<{
    installationId: number;
    accountLogin: string;
    accountType: string;
    isDefault: boolean;
  } | null>;

  /** List repos accessible to a company's installation */
  listRepos(companyId: string): Promise<Array<{ fullName: string; private: boolean; defaultBranch: string }>>;

  /** Create a repo under the default org for a company/project */
  createDefaultRepo(companyId: string, repoName: string): Promise<{ fullName: string; cloneUrl: string; private: boolean }>;

  /** Delete a GitHub repo by full name (e.g. "org/repo"). Non-fatal. */
  deleteRepo(companyId: string, repoFullName: string): Promise<void>;

  /** Rename a GitHub repo. Returns new clone URL or null on failure. */
  renameRepo(companyId: string, repoFullName: string, newName: string): Promise<string | null>;

  /** Derive the repo name for a company/project (without creating it) */
  deriveRepoName(companyId: string, projectName: string): string;

  /** Parse "org/repo" from a clone URL. Returns null if unparseable. */
  parseRepoFullName(cloneUrl: string): string | null;

  /** Check if a clone URL points to a repo managed by this instance */
  isManagedRepo(cloneUrl: string, companyId: string): boolean;
}

export function githubAppService(db: Db): GitHubAppService {
  const config = getAppConfig();
  const enabled = config !== null;

  async function getInstallationId(companyId: string): Promise<number | null> {
    // Check company-specific installation first
    const row = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.companyId, companyId))
      .then((rows) => rows[0] ?? null);

    if (row) return row.installationId;

    // Fall back to default (AgentsInc org) installation
    return config?.defaultInstallationId ?? null;
  }

  async function getInstallationToken(companyId: string): Promise<InstallationToken | null> {
    if (!enabled) return null;
    const installId = await getInstallationId(companyId);
    if (!installId) return null;

    try {
      return await createInstallationToken(installId);
    } catch (err) {
      logger.warn({ err, companyId, installId }, "Failed to create GitHub installation token");
      return null;
    }
  }

  async function getCredentialUrl(companyId: string, repoUrl: string): Promise<string> {
    // 1. Try GitHub App installation token (company-specific or default)
    const token = await getInstallationToken(companyId);
    if (token) {
      try {
        const url = new URL(repoUrl);
        url.username = "x-access-token";
        url.password = token.token;
        return url.toString();
      } catch {
        return repoUrl;
      }
    }

    // 2. Fall back to GITHUB_PAT if set (org-wide PAT for AgentsInc repos)
    const pat = process.env.GITHUB_PAT;
    if (pat) {
      try {
        const url = new URL(repoUrl);
        url.username = "x-access-token";
        url.password = pat;
        return url.toString();
      } catch {
        return repoUrl;
      }
    }

    return repoUrl;
  }

  async function saveInstallation(companyId: string, data: {
    installationId: number;
    accountLogin: string;
    accountType: string;
    userId?: string | null;
  }): Promise<void> {
    // Upsert: replace existing installation for this company
    const existing = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.companyId, companyId))
      .then((rows) => rows[0] ?? null);

    if (existing) {
      await db
        .update(githubInstallations)
        .set({
          installationId: data.installationId,
          githubAccountLogin: data.accountLogin,
          githubAccountType: data.accountType,
          installedByUserId: data.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(githubInstallations.id, existing.id));
    } else {
      await db.insert(githubInstallations).values({
        companyId,
        installationId: data.installationId,
        githubAccountLogin: data.accountLogin,
        githubAccountType: data.accountType,
        installedByUserId: data.userId ?? null,
      });
    }
  }

  async function removeInstallation(companyId: string): Promise<void> {
    await db
      .delete(githubInstallations)
      .where(eq(githubInstallations.companyId, companyId));
  }

  async function getInstallation(companyId: string): Promise<{
    installationId: number;
    accountLogin: string;
    accountType: string;
    isDefault: boolean;
  } | null> {
    const row = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.companyId, companyId))
      .then((rows) => rows[0] ?? null);

    if (row) {
      return {
        installationId: row.installationId,
        accountLogin: row.githubAccountLogin,
        accountType: row.githubAccountType,
        isDefault: false,
      };
    }

    if (config?.defaultInstallationId) {
      return {
        installationId: config.defaultInstallationId,
        accountLogin: config.defaultOrg,
        accountType: "Organization",
        isDefault: true,
      };
    }

    return null;
  }

  async function listRepos(companyId: string): Promise<Array<{ fullName: string; private: boolean; defaultBranch: string }>> {
    const tokenResult = await getInstallationToken(companyId);
    if (!tokenResult) return [];

    try {
      const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) return [];
      const data = await res.json() as { repositories: Array<{ full_name: string; private: boolean; default_branch: string }> };
      return (data.repositories ?? []).map((r) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
      }));
    } catch (err) {
      logger.warn({ err, companyId }, "GitHub listRepositories failed");
      return [];
    }
  }

  // --- Shared helpers ---

  async function resolveAuthToken(companyId: string): Promise<string | null> {
    let authToken: string | null = null;
    try {
      const tokenResult = await getInstallationToken(companyId);
      if (tokenResult) authToken = tokenResult.token;
    } catch (err) {
      logger.debug({ err, companyId }, "GitHub App token fetch failed, falling back to PAT");
    }
    if (!authToken) {
      const pat = process.env.GITHUB_PAT;
      if (pat) authToken = pat;
    }
    return authToken;
  }

  function getDefaultOrg(): string {
    return config?.defaultOrg ?? process.env.GITHUB_APP_DEFAULT_ORG ?? "AIOTNetwork";
  }

  function deriveRepoName(companyId: string, projectName: string): string {
    const instanceId = resolvePaperclipInstanceId();
    const companyShort = companyId.slice(0, 8);
    const safeProject = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    return `${instanceId}-${companyShort}-${safeProject}`.slice(0, 100);
  }

  function parseRepoFullName(cloneUrl: string): string | null {
    try {
      const url = new URL(cloneUrl);
      const match = url.pathname.match(/^\/([^/]+\/[^/]+?)(?:\.git)?$/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function isManagedRepo(cloneUrl: string, companyId: string): boolean {
    const fullName = parseRepoFullName(cloneUrl);
    if (!fullName) return false;
    const [org, repoName] = fullName.split("/");
    if (!org || !repoName) return false;
    if (org !== getDefaultOrg()) return false;
    const instanceId = resolvePaperclipInstanceId();
    const companyShort = companyId.slice(0, 8);
    return repoName.startsWith(`${instanceId}-${companyShort}-`);
  }

  // --- CRUD ---

  async function createDefaultRepo(
    companyId: string,
    repoName: string,
  ): Promise<{ fullName: string; cloneUrl: string; private: boolean }> {
    const authToken = await resolveAuthToken(companyId);
    if (!authToken) throw new Error("No GitHub credentials available (need App installation or GITHUB_PAT)");

    const org = getDefaultOrg();
    const safeName = deriveRepoName(companyId, repoName);
    const instanceId = resolvePaperclipInstanceId();
    const companyShort = companyId.slice(0, 8);

    const res = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: safeName,
        private: true,
        auto_init: true,
        description: `Managed by AgentsInc (${instanceId}) for company ${companyShort}, project: ${repoName}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub repo creation failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { full_name: string; clone_url: string; private: boolean };
    return {
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      private: data.private,
    };
  }

  async function deleteRepo(companyId: string, repoFullName: string): Promise<void> {
    const authToken = await resolveAuthToken(companyId);
    if (!authToken) return;
    try {
      const res = await fetch(`${GITHUB_API}/repos/${repoFullName}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}`, Accept: "application/vnd.github+json" },
      });
      if (res.ok || res.status === 404) return;
      logger.warn({ status: res.status, repoFullName }, "GitHub repo deletion failed");
    } catch (err) {
      logger.warn({ err, repoFullName }, "GitHub repo deletion error");
    }
  }

  async function renameRepo(companyId: string, repoFullName: string, newName: string): Promise<string | null> {
    const authToken = await resolveAuthToken(companyId);
    if (!authToken) return null;
    try {
      const res = await fetch(`${GITHUB_API}/repos/${repoFullName}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, repoFullName, newName }, "GitHub repo rename failed");
        return null;
      }
      const data = await res.json() as { clone_url: string };
      return data.clone_url;
    } catch (err) {
      logger.warn({ err, repoFullName, newName }, "GitHub repo rename error");
      return null;
    }
  }

  return {
    enabled,
    getInstallationId,
    getInstallationToken,
    getCredentialUrl,
    saveInstallation,
    removeInstallation,
    getInstallation,
    listRepos,
    createDefaultRepo,
    deleteRepo,
    renameRepo,
    deriveRepoName,
    parseRepoFullName,
    isManagedRepo,
  };
}
