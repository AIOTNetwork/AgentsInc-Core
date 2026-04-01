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
import { githubInstallations, companies, companyMemberships, authUsers } from "@paperclipai/db";
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
  createDefaultRepo(companyId: string, repoName: string, projectId?: string): Promise<{ fullName: string; cloneUrl: string; private: boolean }>;

  /** Delete a GitHub repo by full name (e.g. "org/repo"). Non-fatal. */
  deleteRepo(companyId: string, repoFullName: string): Promise<void>;

  /** Rename a GitHub repo. Returns new clone URL or null on failure. */
  renameRepo(companyId: string, repoFullName: string, newName: string): Promise<string | null>;

  /** Derive the repo name for a company/project (without creating it) */
  deriveRepoName(companyId: string, projectName: string, projectId?: string, companyName?: string): string;

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

  function getEnvironment(): string {
    return (process.env.DEPLOY_ENVIRONMENT ?? "dev").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }

  function deriveRepoName(companyId: string, projectName: string, projectId?: string, companyName?: string): string {
    const env = getEnvironment();
    const companyShort = companyId.slice(0, 8);
    const projectShort = projectId ? projectId.slice(0, 6) : crypto.createHash("sha256").update(`${companyId}:${projectName}`).digest("hex").slice(0, 6);
    const safeProject = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    if (companyName) {
      const safeCompany = companyName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
      return `${env}-${safeCompany}-${companyShort}-${safeProject}-${projectShort}`.slice(0, 100);
    }
    return `${env}-${companyShort}-${safeProject}-${projectShort}`.slice(0, 100);
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

  function isManagedRepo(cloneUrl: string, _companyId: string): boolean {
    const fullName = parseRepoFullName(cloneUrl);
    if (!fullName) return false;
    const [org, repoName] = fullName.split("/");
    if (!org || !repoName) return false;
    if (org !== getDefaultOrg()) return false;
    const env = getEnvironment();
    // Match pattern: {env}-{companyName}-{project}
    return repoName.startsWith(`${env}-`);
  }

  // --- CRUD ---

  async function createDefaultRepo(
    companyId: string,
    repoName: string,
    projectId?: string,
  ): Promise<{ fullName: string; cloneUrl: string; private: boolean }> {
    const authToken = await resolveAuthToken(companyId);
    if (!authToken) throw new Error("No GitHub credentials available (need App installation or GITHUB_PAT)");

    // Look up company name and owners for a descriptive repo name + README
    const companyRow = await db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    const companyName = companyRow?.name ?? null;

    // Fetch company members (owners/admins) for README
    const members = await db
      .select({
        name: authUsers.name,
        email: authUsers.email,
        role: companyMemberships.membershipRole,
      })
      .from(companyMemberships)
      .innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId))
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.principalType, "user"),
        ),
      )
      .limit(10);

    const org = getDefaultOrg();
    const safeName = deriveRepoName(companyId, repoName, projectId, companyName ?? undefined);
    const env = getEnvironment();

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
        auto_init: false,
        description: `Managed by AgentsInc (${env}) for ${companyName ?? companyId}, project: ${repoName}`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub repo creation failed (${res.status}): ${body}`);
    }

    const data = await res.json() as { full_name: string; clone_url: string; private: boolean; default_branch: string };
    const result = {
      fullName: data.full_name,
      cloneUrl: data.clone_url,
      private: data.private,
    };

    // Push a detailed README with debug info for admins
    try {
      const readmeContent = generateProjectReadme({
        companyName: companyName ?? companyId,
        companyId,
        projectName: repoName,
        environment: env,
        repoFullName: data.full_name,
        createdAt: new Date().toISOString(),
        owners: members,
      });
      const encodedContent = Buffer.from(readmeContent).toString("base64");
      await fetch(`${GITHUB_API}/repos/${data.full_name}/contents/README.md`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: "Initial commit: add project README",
          content: encodedContent,
        }),
      });
    } catch (readmeErr) {
      logger.warn({ err: readmeErr, repo: data.full_name }, "Failed to push README (non-fatal)");
    }

    return result;
  }

  /** Generate a detailed README for new project repos. */
  function generateProjectReadme(info: {
    companyName: string;
    companyId: string;
    projectName: string;
    environment: string;
    repoFullName: string;
    createdAt: string;
    owners?: Array<{ name: string; email: string; role: string | null }>;
  }): string {
    const ownerRows = (info.owners ?? []).map(
      (o) => `| ${o.name} | ${o.email} | ${o.role ?? "member"} |`,
    );

    return [
      `# ${info.companyName} / ${info.projectName}`,
      ``,
      `> Managed by [AgentsInc](https://agentcompanies.io) — do not edit manually unless debugging.`,
      ``,
      `## Project Info`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| **Company** | ${info.companyName} |`,
      `| **Company ID** | \`${info.companyId}\` |`,
      `| **Project** | ${info.projectName} |`,
      `| **Environment** | \`${info.environment}\` |`,
      `| **Repo** | \`${info.repoFullName}\` |`,
      `| **Created** | ${info.createdAt} |`,
      ``,
      ...(ownerRows.length > 0
        ? [
            `## Owners`,
            ``,
            `| Name | Email | Role |`,
            `|------|-------|------|`,
            ...ownerRows,
            ``,
          ]
        : []),
      `## For Admins / Debugging`,
      ``,
      `### Architecture`,
      ``,
      `This repo is the source-of-truth for agent-modified code. Agents work in`,
      `isolated git worktrees and merge to \`main\` locally before pushing.`,
      ``,
      `### Common Debug Scenarios`,
      ``,
      `**Agent's changes aren't showing up:**`,
      `- Check if the agent's heartbeat is running: \`/instance/settings/heartbeats\``,
      `- Check workspace git status: \`GET /api/projects/{projectId}/workspace/git-status\``,
      `- Trigger manual push: \`POST /api/projects/{projectId}/workspace/git-push\``,
      ``,
      `**Merge conflict blocking pushes:**`,
      `- A high-priority issue is auto-created and assigned to the conflicting agent`,
      `- Check open issues in the project dashboard`,
      `- The agent will resolve the conflict in its worktree and retry`,
      ``,
      `**Workspace lost after pod redeploy (k3s):**`,
      `- The system auto-detects missing workspace directories`,
      `- It will re-clone from this repo on the next heartbeat`,
      `- Periodic auto-push (every 5 min) minimizes data loss`,
      ``,
      `**Preview shows stale code:**`,
      `- Use the "Sync to Git" button in the Office preview panel`,
      `- Or call \`POST /api/projects/{projectId}/workspace/git-push\` before snapshot`,
      ``,
      `### Useful API Endpoints`,
      ``,
      `| Endpoint | Description |`,
      `|----------|-------------|`,
      `| \`GET /api/projects/{id}/workspace/git-status\` | Check uncommitted/unpushed changes |`,
      `| \`POST /api/projects/{id}/workspace/git-push\` | Commit + merge + push all workspaces |`,
      `| \`POST /api/projects/{id}/workspace/snapshot\` | Create preview snapshot (auto-pushes first) |`,
      `| \`POST /api/projects/{id}/workspace/ensure\` | Re-clone workspace if missing |`,
      ``,
      `### Commit History`,
      ``,
      `Agent commits follow this format:`,
      `- \`{agent-name}: {issue-title}\` — normal task completion`,
      `- \`workspace sync: {project-name}\` — manual push from Office UI`,
      `- \`{agent-name}: work in progress (auto-sync)\` — periodic auto-push`,
      ``,
      `---`,
      `*Auto-generated by AgentsInc on ${info.createdAt.split("T")[0]}*`,
      ``,
    ].join("\n");
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
