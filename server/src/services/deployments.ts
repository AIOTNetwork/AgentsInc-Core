import type { Db } from "@paperclipai/db";
import {
  DEPLOYMENT_IDLE_STATUSES,
  DeploymentAction,
  DeploymentResultKind,
  DeploymentStatus,
  DeploymentWakeupKind,
  type Deployment,
  type DeploymentsPatchBody,
  type DeploymentResultBody,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { agentService } from "./agents.js";
import { deploymentQuotaService } from "./deployment-quota.js";
import {
  projectDeploymentsDbService,
  type ProjectDeploymentRow,
} from "./project-deployments-db.js";

const SWEEP_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export class DeploymentServiceError extends Error {
  constructor(public code: string, public details: Record<string, unknown> = {}) { super(code); }
}

export interface DeploymentsServiceDeps {
  // Return value is intentionally opaque — we don't consume it. The real
  // heartbeat.wakeup returns a heartbeat-runs row or null; tests pass any
  // stand-in. Keep it `unknown` to avoid coupling to the full row shape.
  heartbeatWakeup: (agentId: string, opts: Record<string, unknown>) => Promise<unknown>;
}

export function deploymentsService(db: Db, deps: DeploymentsServiceDeps) {
  const quota = deploymentQuotaService(db);
  // deploymentsDb is scoped to the outer `db`.
  // - Reads: getByCriteria defaults to the constructor db; pass txDb as the
  //   optional second arg to run queries inside a transaction.
  // - Writes: insert/updateById always receive an explicit tx/db as their first
  //   argument — the constructor db is never used for writes.
  const deploymentsDb = projectDeploymentsDbService(db);
  const agentSvc = agentService(db);

  async function loadCeoAgent(companyId: string): Promise<{ id: string } | null> {
    const rows = await agentSvc.getByCriteria({ companyId, role: "ceo" });
    return rows[0] ?? null;
  }

  async function applyPatch(input: {
    companyId: string; projectId: string; userId: string | null;
    body: DeploymentsPatchBody;
  }): Promise<{ deployments: Deployment[] }> {
    const { companyId, projectId, userId, body } = input;
    const ceo = await loadCeoAgent(companyId);
    if (!ceo) throw new DeploymentServiceError("no_ceo_agent");

    if (body.action === DeploymentAction.REFRESH) {
      const rows = await deploymentsDb.getByCriteria({
        companyId, projectId, activeOnly: true,
      });
      if (rows.length > 0) {
        const heartbeatPayload = {
          source: "on_demand" as const,
          triggerDetail: "system" as const,
          reason: `${DeploymentWakeupKind.RECONCILE} ${rows.length} target(s)`,
          payload: {
            kind: DeploymentWakeupKind.RECONCILE,
            companyId, projectId,
            deployments: rows.map(r => ({ deploymentId: r.id, targetName: r.targetName })),
            resultEndpoint: `/companies/${companyId}/projects/${projectId}/deployments/:id/result`,
          },
          requestedByActorType: "user" as const,
          requestedByActorId: userId,
          contextSnapshot: {
            projectId, action: DeploymentAction.REFRESH,
            targetNames: rows.map(r => r.targetName),
          },
          bypassCoalesce: true,
        }
        const result = await deps.heartbeatWakeup(ceo.id, heartbeatPayload);
        if (!result) {
          logger.warn({ heartbeatPayload }, "no heartbeatWakeup");
        }
      }
      return { deployments: rows.map(toDeployment) };
    }

    // deploy | stop
    const targetNames = body.targets!.map(t => t.targetName);

    if (body.action === DeploymentAction.DEPLOY) {
      const check = await quota.check(companyId, projectId, targetNames);
      if (!check.ok) throw new DeploymentServiceError("quota_exceeded", check);
    }

    const { results, kind } = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;

      // Read within the transaction using txDb as the explicit queryDb override,
      // with FOR UPDATE locking for safe concurrent deploys.
      const existingRows = await deploymentsDb.getByCriteria(
        { projectId, targetNames, forUpdate: true },
        txDb,
      );
      const existingByName = new Map(existingRows.map(r => [r.targetName, r]));

      const conflicts: Array<{ targetName: string; currentStatus: DeploymentStatus }> = [];
      for (const t of body.targets!) {
        const row = existingByName.get(t.targetName);
        const status = row?.status as DeploymentStatus | undefined;
        if (body.action === DeploymentAction.DEPLOY) {
          if (row && status !== DeploymentStatus.STOPPED &&
            !DEPLOYMENT_IDLE_STATUSES.includes(status!)) {
            conflicts.push({ targetName: t.targetName, currentStatus: status! });
          }
        } else {
          if (!row) throw new DeploymentServiceError("not_found", { targetName: t.targetName });
          if (!DEPLOYMENT_IDLE_STATUSES.includes(status!)) {
            conflicts.push({ targetName: t.targetName, currentStatus: status! });
          }
        }
      }
      if (conflicts.length > 0) throw new DeploymentServiceError("invalid_state", { conflicts });

      const now = new Date();
      const out: ProjectDeploymentRow[] = [];

      if (body.action === DeploymentAction.DEPLOY) {
        for (const t of body.targets!) {
          const existing = existingByName.get(t.targetName);
          if (!existing) {
            out.push(await deploymentsDb.insert(txDb, {
              companyId, projectId, targetName: t.targetName,
              type: t.type!, status: DeploymentStatus.PENDING,
              requestedByUserId: userId,
            }));
          } else {
            out.push(await deploymentsDb.updateById(txDb, existing.id, {
              status: DeploymentStatus.PENDING, type: t.type!, lastError: null,
              requestedByUserId: userId, updatedAt: now,
            }));
          }
        }
      } else {
        for (const t of body.targets!) {
          const existing = existingByName.get(t.targetName)!;
          out.push(await deploymentsDb.updateById(txDb, existing.id, {
            status: DeploymentStatus.STOPPING, lastError: null,
            requestedByUserId: userId, updatedAt: now,
          }));
        }
      }

      return {
        results: out,
        kind: body.action === DeploymentAction.DEPLOY
          ? DeploymentWakeupKind.DEPLOY
          : DeploymentWakeupKind.TEARDOWN,
      };
    });

    const heartbeatPayload = {
      source: "on_demand" as const,
      triggerDetail: "system" as const,
      reason: `${kind} ${results.length} target(s)`,
      payload: {
        kind,
        companyId, projectId,
        deployments: results.map(r => ({
          deploymentId: r.id,
          targetName: r.targetName,
          type: kind === DeploymentWakeupKind.DEPLOY ? r.type : undefined,
        })),
        resultEndpoint: `/companies/${companyId}/projects/${projectId}/deployments/:id/result`,
      },
      requestedByActorType: "user" as const,
      requestedByActorId: userId,
      contextSnapshot: {
        projectId, action: body.action,
        targetNames: results.map(r => r.targetName),
      },
      bypassCoalesce: true,
    }
    const result = await deps.heartbeatWakeup(ceo.id, heartbeatPayload);
    if (!result) {
      logger.warn({ heartbeatPayload }, "no heartbeatWakeup");
    }

    return { deployments: results.map(toDeployment) };
  }

  async function applyResult(input: {
    companyId: string; projectId: string; deploymentId: string;
    body: DeploymentResultBody;
  }): Promise<{ deployment: Deployment }> {
    const { companyId, projectId, deploymentId, body } = input;
    const now = new Date();
    const row = await deploymentsDb.getByCriteria({
      id: deploymentId, companyId, projectId,
    }).then(rows => rows[0] ?? null);
    if (!row) throw new DeploymentServiceError("not_found");

    const patch: Partial<Parameters<typeof deploymentsDb.updateById>[2]> = {
      lastSyncedAt: now, updatedAt: now,
    };

    switch (body.kind) {
      case DeploymentResultKind.DEPLOY_STARTED:
        patch.status = DeploymentStatus.DEPLOYING; break;
      case DeploymentResultKind.TEARDOWN_STARTED: break; // already STOPPING
      case DeploymentResultKind.RECONCILE_STARTED: break; // no-op
      case DeploymentResultKind.DEPLOY:
        if (body.success) {
          patch.status = DeploymentStatus.DEPLOYED;
          patch.vercelProjectId = body.vercelProjectId ?? row.vercelProjectId;
          patch.vercelDeploymentId = body.vercelDeploymentId ?? row.vercelDeploymentId;
          patch.url = body.url ?? row.url;
          patch.lastError = null;
          patch.lastDeployedAt = now;
        } else {
          patch.status = DeploymentStatus.DEPLOY_FAILED;
          patch.lastError = body.error ?? "unknown error";
        }
        break;
      case DeploymentResultKind.TEARDOWN:
        if (body.success) {
          patch.status = DeploymentStatus.STOPPED; patch.url = null; patch.lastError = null;
        } else {
          patch.status = DeploymentStatus.STOP_FAILED;
          patch.lastError = body.error ?? "unknown error";
        }
        break;
      case DeploymentResultKind.RECONCILE:
        if (body.success) {
          patch.url = body.url ?? row.url;
          patch.vercelProjectId = body.vercelProjectId ?? row.vercelProjectId;
          patch.vercelDeploymentId = body.vercelDeploymentId ?? row.vercelDeploymentId;
        } else {
          patch.lastError = body.error ?? "reconcile failed";
        }
        break;
    }
    // Single-row update outside a transaction: pass the outer db explicitly.
    const updated = await deploymentsDb.updateById(db, deploymentId, patch);
    return { deployment: toDeployment(updated) };
  }

  async function list(companyId: string, projectId: string) {
    const rows = await deploymentsDb.getByCriteria({ companyId, projectId });
    return rows.map(toDeployment);
  }

  /**
   * Flip rows stuck in DEPLOYING or STOPPING past the timeout window into
   * DEPLOY_FAILED / STOP_FAILED respectively. Called by the startup scheduler
   * tick; safe to call manually for tests. Uses the scoped `deploymentsDb`.
   */
  async function sweepStuck(
    opts: { now?: Date; timeoutMs?: number; projectId?: string } = {},
  ): Promise<{ swept: number; sweptIds: string[] }> {
    const now = opts.now ?? new Date();
    const timeoutMs = opts.timeoutMs ?? SWEEP_DEFAULT_TIMEOUT_MS;
    const { sweptIds } = await deploymentsDb.sweepStuck(now, timeoutMs, {
      projectId: opts.projectId,
    });
    if (sweptIds.length > 0) {
      logger.warn(
        { count: sweptIds.length, ids: sweptIds, projectId: opts.projectId },
        "deployment timeout sweep flipped stuck rows",
      );
    }
    return { swept: sweptIds.length, sweptIds };
  }

  return { applyPatch, applyResult, list, sweepStuck };
}


function toDeployment(row: ProjectDeploymentRow): Deployment {
  return {
    id: row.id, companyId: row.companyId, projectId: row.projectId,
    targetName: row.targetName,
    type: row.type as Deployment["type"],
    provider: row.provider as Deployment["provider"],
    status: row.status as Deployment["status"],
    url: row.url,
    vercelProjectId: row.vercelProjectId,
    vercelDeploymentId: row.vercelDeploymentId,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    lastDeployedAt: row.lastDeployedAt,
    requestedByUserId: row.requestedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
