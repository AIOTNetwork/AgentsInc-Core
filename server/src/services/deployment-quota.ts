import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies } from "@paperclipai/db";
import { billingService } from "./billing.js";
import { projectDeploymentsDbService } from "./project-deployments-db.js";

export type QuotaCheckResult =
  | { ok: true }
  | { ok: false; scope: "project" | "repo"; used: number; limit: number; requested: number };

export function deploymentQuotaService(db: Db) {
  const billing = billingService(db);
  const deploymentsDb = projectDeploymentsDbService(db);

  async function loadLimits(companyId: string) {
    const [row] = await db
      .select({
        maxProjects: companies.deploymentMaxDeployableProjects,
        maxPerRepo: companies.deploymentMaxDeploymentsPerRepo,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!row) throw new Error("company_not_found");

    const subscription = await billing.getSubscriptionForCompany(companyId).catch(() => null);
    const cap = {
      maxProjects: subscription?.plan?.deploymentMaxDeployableProjectsCap ?? 1,
      maxPerRepo: subscription?.plan?.deploymentMaxDeploymentsPerRepoCap ?? 1,
    };
    return {
      projectLimit: Math.min(row.maxProjects, cap.maxProjects),
      repoLimit: Math.min(row.maxPerRepo, cap.maxPerRepo),
    };
  }

  async function check(
    companyId: string,
    projectId: string,
    targetNames: string[],
  ): Promise<QuotaCheckResult> {
    const limits = await loadLimits(companyId);

    const activeInRepo = await deploymentsDb.getByCriteria({ projectId, activeOnly: true });
    const activeRepoNames = new Set(activeInRepo.map((r) => r.targetName));
    const newTargets = targetNames.filter((n) => !activeRepoNames.has(n));
    const repoUsedAfter = activeRepoNames.size + newTargets.length;
    if (repoUsedAfter > limits.repoLimit) {
      return {
        ok: false,
        scope: "repo",
        used: activeRepoNames.size,
        limit: limits.repoLimit,
        requested: newTargets.length,
      };
    }

    const projectIsNew = activeRepoNames.size === 0 && newTargets.length > 0;
    if (projectIsNew) {
      const activeProjects = await deploymentsDb.countActiveProjectsInCompany(companyId);
      if (activeProjects + 1 > limits.projectLimit) {
        return {
          ok: false,
          scope: "project",
          used: activeProjects,
          limit: limits.projectLimit,
          requested: 1,
        };
      }
    }
    return { ok: true };
  }

  async function snapshot(companyId: string, projectId: string) {
    const limits = await loadLimits(companyId);
    const repoRows = await deploymentsDb.getByCriteria({ projectId, activeOnly: true });
    const projectCount = await deploymentsDb.countActiveProjectsInCompany(companyId);
    const repoUsed = new Set(repoRows.map((r) => r.targetName)).size;
    return {
      project: { used: projectCount, limit: limits.projectLimit, planCap: limits.projectLimit },
      repo: { used: repoUsed, limit: limits.repoLimit, planCap: limits.repoLimit },
    };
  }

  return { check, snapshot, loadLimits };
}
