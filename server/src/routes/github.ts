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
import type { Db } from "@paperclipai/db";
import { githubAppService } from "../services/github-app.js";
import { assertCompanyAccess } from "./authz.js";

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

  return router;
}
