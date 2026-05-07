import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  deploymentsPatchSchema,
  deploymentResultSchema,
  deploymentSettingsUpdateSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import {
  agentService,
  companyService,
  deploymentsService,
  DeploymentServiceError,
  heartbeatService,
  logActivity,
  projectService,
} from "../services/index.js";
import { deploymentQuotaService } from "../services/deployment-quota.js";
import { readDeploymentManifest } from "../services/deployment-manifest.js";
import {
  DEFAULT_MANUAL_SWEEP_MIN_INTERVAL_MS,
  tryAcquireSweepLock,
} from "../services/deployment-sweep-lock.js";
import { forbidden, notFound } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function deploymentRoutes(db: Db) {
  const router = Router();
  const heartbeat = heartbeatService(db);
  const svc = deploymentsService(db, { heartbeatWakeup: heartbeat.wakeup });
  const quota = deploymentQuotaService(db);
  const projects = projectService(db);
  const agents = agentService(db);
  const companies = companyService(db);

  // Scoped CEO-or-board gate. Parallel to the inline pattern in routes/companies.ts
  // (assertCanUpdateBranding etc.); kept local to avoid touching unrelated code.
  // remark : if duplicated with routes/companies.ts, move the function to authz.ts. And remove duplicated implementation
  async function assertCompanyAdmin(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");
    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (actorAgent.role !== "ceo") {
      throw forbidden("Only CEO agents can update deployment settings");
    }
  }

  router.get("/companies/:companyId/projects/:projectId/deployments", async (req, res) => {
    const { companyId, projectId } = req.params as { companyId: string; projectId: string };
    assertCompanyAccess(req, companyId);

    const project = await projects.getById(projectId);
    if (!project || project.companyId !== companyId) throw notFound("Project not found");
    const dir =
      project.primaryWorkspace?.cwd ?? project.codebase?.effectiveLocalFolder ?? null;

    const [deployments, quotaSnap, manifest] = await Promise.all([
      svc.list(companyId, projectId),
      quota.snapshot(companyId, projectId),
      dir ? readDeploymentManifest(dir) : Promise.resolve({ targets: [], warnings: [] }),
    ]);
    res.json({ deployments, manifestTargets: manifest.targets, quota: quotaSnap });
  });

  router.patch(
    "/companies/:companyId/projects/:projectId/deployments",
    validate(deploymentsPatchSchema),
    async (req, res) => {
      const { companyId, projectId } = req.params as { companyId: string; projectId: string };
      assertCompanyAccess(req, companyId);
      try {
        const actor = getActorInfo(req);
        const result = await svc.applyPatch({
          companyId,
          projectId,
          userId: req.actor.type === "board" ? (req.actor.userId ?? null) : null,
          body: req.body,
        });
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: `deployment.${req.body.action}_requested`,
          entityType: "project",
          entityId: projectId,
          details: {
            targetNames:
              req.body.action === "refresh"
                ? []
                : req.body.targets.map((t: { targetName: string }) => t.targetName),
          },
        });
        if (req.body.action === "refresh") {
          res.status(202).json(result);
          return;
        }
        const hasNewRow = result.deployments.some((d) => d.status === "pending" && !d.url);
        res.status(hasNewRow ? 201 : 200).json(result);
      } catch (err) {
        if (!(err instanceof DeploymentServiceError)) throw err;
        const statusMap: Record<string, number> = {
          quota_exceeded: 403,
          invalid_state: 409,
          not_found: 404,
          no_ceo_agent: 500,
        };
        res.status(statusMap[err.code] ?? 500).json({ error: err.code, ...err.details });
      }
    },
  );

  router.post(
    "/companies/:companyId/projects/:projectId/deployments/sweep",
    async (req, res) => {
      const { companyId, projectId } = req.params as { companyId: string; projectId: string };
      assertCompanyAccess(req, companyId);
      const project = await projects.getById(projectId);
      if (!project || project.companyId !== companyId) throw notFound("Project not found");

      const lock = tryAcquireSweepLock(projectId);
      if (!lock.acquired) {
        res.setHeader("Retry-After", String(lock.retryAfterSeconds));
        res.status(429).json({
          error: "sweep_throttled",
          retryAfterSeconds: lock.retryAfterSeconds,
          minIntervalSeconds: Math.round(DEFAULT_MANUAL_SWEEP_MIN_INTERVAL_MS / 1000),
        });
        return;
      }

      const { swept, sweptIds } = await svc.sweepStuck({ projectId });
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "deployment.sweep_requested",
        entityType: "project",
        entityId: projectId,
        details: { swept, sweptIds },
      });
      res.json({ swept, sweptIds });
    },
  );

  router.post(
    "/companies/:companyId/projects/:projectId/deployments/:id/result",
    validate(deploymentResultSchema),
    async (req, res) => {
      const { companyId, projectId, id } = req.params as {
        companyId: string;
        projectId: string;
        id: string;
      };
      assertCompanyAccess(req, companyId);
      if (req.actor.type !== "agent" || !req.actor.agentId) {
        res.status(403).json({ error: "agent_required" });
        return;
      }
      const actorAgent = await agents.getById(req.actor.agentId);
      if (!actorAgent || actorAgent.companyId !== companyId || actorAgent.role !== "ceo") {
        res.status(403).json({ error: "ceo_required" });
        return;
      }
      try {
        const result = await svc.applyResult({
          companyId,
          projectId,
          deploymentId: id,
          body: req.body,
        });
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: `deployment.${req.body.kind}`,
          entityType: "project_deployment",
          entityId: id,
          details: { success: (req.body as { success?: boolean }).success ?? null },
        });
        res.json(result);
      } catch (err) {
        if (err instanceof DeploymentServiceError && err.code === "not_found") {
          res.status(404).json({ error: err.code });
          return;
        }
        throw err;
      }
    },
  );

  router.get("/companies/:companyId/deployment-settings", async (req, res) => {
    const { companyId } = req.params as { companyId: string };
    assertCompanyAccess(req, companyId);
    const limits = await quota.loadLimits(companyId);
    res.json({
      maxDeployableProjects: limits.projectLimit,
      maxDeploymentsPerRepo: limits.repoLimit,
      plan: {
        maxDeployableProjectsCap: limits.projectLimit,
        maxDeploymentsPerRepoCap: limits.repoLimit,
      },
    });
  });

  router.patch(
    "/companies/:companyId/deployment-settings",
    validate(deploymentSettingsUpdateSchema),
    async (req, res) => {
      const { companyId } = req.params as { companyId: string };
      await assertCompanyAdmin(req, companyId);

      const limits = await quota.loadLimits(companyId);
      const clamp = (requested: number | undefined, cap: number, current: number) =>
        requested == null ? current : Math.min(Math.max(0, requested), cap);

      const patch: {
        deploymentMaxDeployableProjects?: number;
        deploymentMaxDeploymentsPerRepo?: number;
      } = {};
      if (req.body.maxDeployableProjects != null) {
        patch.deploymentMaxDeployableProjects = clamp(
          req.body.maxDeployableProjects,
          limits.projectLimit,
          limits.projectLimit,
        );
      }
      if (req.body.maxDeploymentsPerRepo != null) {
        patch.deploymentMaxDeploymentsPerRepo = clamp(
          req.body.maxDeploymentsPerRepo,
          limits.repoLimit,
          limits.repoLimit,
        );
      }
      if (Object.keys(patch).length > 0) {
        await companies.update(companyId, patch);
      }

      const fresh = await quota.loadLimits(companyId);
      res.json({
        maxDeployableProjects: fresh.projectLimit,
        maxDeploymentsPerRepo: fresh.repoLimit,
        plan: {
          maxDeployableProjectsCap: fresh.projectLimit,
          maxDeploymentsPerRepoCap: fresh.repoLimit,
        },
      });
    },
  );

  return router;
}