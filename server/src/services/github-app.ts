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
    } catch {
      return [];
    }
  }

  async function createDefaultRepo(
    companyId: string,
    repoName: string,
  ): Promise<{ fullName: string; cloneUrl: string; private: boolean }> {
    if (!config) throw new Error("GitHub App not configured");

    const tokenResult = await getInstallationToken(companyId);
    if (!tokenResult) throw new Error("No GitHub installation available");

    const org = config.defaultOrg;
    const safeName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 100);

    const res = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: safeName,
        private: true,
        auto_init: true, // creates with README so it has a default branch
        description: `Managed by AgentsInc for project: ${repoName}`,
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
  };
}
