/**
 * GitHub App installation flow routes.
 *
 * GET  /api/github/install     → redirect to GitHub App install page
 * GET  /api/github/callback    → handle post-install callback
 * GET  /api/github/status      → get connection status for a company
 * GET  /api/github/repos       → list accessible repos
 * POST /api/github/disconnect  → remove installation
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { githubAppService } from "../services/github-app.js";
import { assertCompanyAccess } from "./authz.js";
import { logger } from "../middleware/logger.js";

const GITHUB_APP_SLUG = process.env.GITHUB_APP_SLUG ?? "agentsinc";

export function githubRoutes(db: Db) {
  const router = Router();
  const github = githubAppService(db);

  // Redirect to GitHub App installation page
  router.get("/github/install", (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
    const state = companyId ?? "";
    const installUrl = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
    res.redirect(installUrl);
  });

  // GitHub redirects here after app installation
  router.get("/github/callback", async (req, res) => {
    const installationId = typeof req.query.installation_id === "string"
      ? parseInt(req.query.installation_id, 10)
      : null;
    const setupAction = typeof req.query.setup_action === "string" ? req.query.setup_action : null;
    const state = typeof req.query.state === "string" ? req.query.state : "";

    if (!installationId || isNaN(installationId)) {
      res.status(400).json({ error: "Missing installation_id" });
      return;
    }

    // State carries the companyId
    const companyId = state || null;

    if (companyId) {
      try {
        // Fetch installation details from GitHub
        const token = await github.getInstallationToken(companyId);

        // Get account info from the installation
        let accountLogin = "unknown";
        let accountType = "User";
        try {
          const appConfig = process.env.GITHUB_APP_ID;
          if (appConfig) {
            // We can derive account info from the callback or fetch it
            // For now, store what we have — the installation ID is the key piece
            accountLogin = typeof req.query.account_login === "string" ? req.query.account_login : "connected";
            accountType = typeof req.query.account_type === "string" ? req.query.account_type : "User";
          }
        } catch { /* use defaults */ }

        await github.saveInstallation(companyId, {
          installationId,
          accountLogin,
          accountType,
          userId: req.actor?.type === "board" ? req.actor.userId : null,
        });
      } catch (err) {
        // Still redirect — the installation exists on GitHub even if we fail to save
        console.error("[github] Failed to save installation:", err);
      }
    }

    // Redirect back to the UI — default to company settings page
    const redirectUrl = process.env.GITHUB_CALLBACK_REDIRECT_URL ?? "/company/settings";
    res.redirect(`${redirectUrl}?github=connected&companyId=${companyId ?? ""}`);
  });

  // Get GitHub connection status for a company
  router.get("/github/status", async (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const hasPat = !!process.env.GITHUB_PAT;

    if (!github.enabled) {
      res.json({ connected: false, enabled: false, hasPat });
      return;
    }

    const installation = await github.getInstallation(companyId);
    if (!installation) {
      res.json({ connected: false, enabled: true, hasPat });
      return;
    }

    res.json({
      connected: true,
      enabled: true,
      hasPat,
      account: installation.accountLogin,
      accountType: installation.accountType,
      isDefault: installation.isDefault,
    });
  });

  // Get the default repo URL for a project
  router.get("/github/default-repo-url", async (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
    const projectName = typeof req.query.projectName === "string" ? req.query.projectName : null;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    if (!companyId || !projectName) {
      res.status(400).json({ error: "companyId and projectName required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const defaultOrg = process.env.GITHUB_APP_DEFAULT_ORG ?? "AIOTNetwork";

    let companyName: string | undefined;
    try {
      const row = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);
      if (row) companyName = row.name;
    } catch (err) {
      logger.warn({ err, companyId, route: "default-repo-url" }, "[github] Failed to fetch company name");
    }

    const repoName = github.deriveRepoName(companyId, projectName, projectId, companyName);

    let account = defaultOrg;
    try {
      const installation = await github.getInstallation(companyId);
      if (installation) account = installation.accountLogin;
    } catch (err) {
      logger.warn({ err, companyId, route: "default-repo-url" }, "[github] Failed to fetch installation, using defaultOrg");
    }

    res.json({ defaultRepoUrl: `https://github.com/${account}/${repoName}` });
  });

  // List repos accessible to the company's installation
  router.get("/github/repos", async (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const repos = await github.listRepos(companyId);
    res.json({ repos });
  });

  // Disconnect GitHub (remove installation record)
  router.post("/github/disconnect", async (req, res) => {
    const companyId = typeof req.body.companyId === "string" ? req.body.companyId : null;
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    await github.removeInstallation(companyId);
    res.json({ ok: true });
  });

  // Ensure a repo exists on GitHub — creates it if missing
  // Validates that the requested repoUrl matches the expected default before creating.
  router.post("/github/ensure-repo", async (req, res) => {
    const companyId = typeof req.body.companyId === "string" ? req.body.companyId : null;
    const projectName = typeof req.body.projectName === "string" ? req.body.projectName : null;
    const projectId = typeof req.body.projectId === "string" ? req.body.projectId : undefined;
    const repoUrl = typeof req.body.repoUrl === "string" ? req.body.repoUrl : null;
    if (!companyId || !projectName) {
      res.status(400).json({ error: "companyId and projectName required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    // Derive the expected default repo URL
    const defaultOrg = process.env.GITHUB_APP_DEFAULT_ORG ?? "AIOTNetwork";
    let companyName: string | undefined;
    try {
      const row = await db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);
      if (row) companyName = row.name;
    } catch (err) {
      logger.warn({ err, companyId, route: "ensure-repo" }, "[github] Failed to fetch company name");
    }

    const expectedRepoName = github.deriveRepoName(companyId, projectName, projectId, companyName);

    let account = defaultOrg;
    try {
      const installation = await github.getInstallation(companyId);
      if (installation) account = installation.accountLogin;
    } catch (err) {
      logger.warn({ err, companyId, route: "ensure-repo" }, "[github] Failed to fetch installation, using defaultOrg");
    }

    const expectedUrl = `https://github.com/${account}/${expectedRepoName}`;

    // Validate: if a repoUrl was provided, it must match the expected default
    if (repoUrl && repoUrl !== expectedUrl) {
      res.status(400).json({
        error: "Repo URL does not match expected default",
        expected: expectedUrl,
        received: repoUrl,
      });
      return;
    }

    try {
      const repo = await github.createDefaultRepo(companyId, projectName, projectId);
      res.json({ created: true, fullName: repo.fullName, cloneUrl: repo.cloneUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // GitHub returns 422 when repo already exists
      if (msg.includes("422")) {
        res.json({ created: false, message: "Repo already exists" });
        return;
      }
      res.status(500).json({ error: msg });
    }
  });

  // Get a credential-injected clone URL for a repo (short-lived token)
  router.post("/github/credential-url", async (req, res) => {
    const companyId = typeof req.body.companyId === "string" ? req.body.companyId : null;
    const repoUrl = typeof req.body.repoUrl === "string" ? req.body.repoUrl : null;
    if (!companyId || !repoUrl) {
      res.status(400).json({ error: "companyId and repoUrl required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const credentialUrl = await github.getCredentialUrl(companyId, repoUrl);
    res.json({ credentialUrl });
  });

  return router;
}
