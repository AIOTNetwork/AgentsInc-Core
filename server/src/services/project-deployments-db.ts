import { and, countDistinct, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectDeployments } from "@paperclipai/db";
import { DEPLOYMENT_ACTIVE_STATUSES } from "@paperclipai/shared";

export type ProjectDeploymentRow = typeof projectDeployments.$inferSelect;
export type ProjectDeploymentInsert = typeof projectDeployments.$inferInsert;

export interface ProjectDeploymentCriteria {
  id?: string;
  companyId?: string;
  projectId?: string;
  targetName?: string;
  targetNames?: string[];
  statuses?: string[];
  activeOnly?: boolean;
  forUpdate?: boolean;
}

export function projectDeploymentsDbService(db: Db) {
  const ACTIVE = DEPLOYMENT_ACTIVE_STATUSES as unknown as string[];

  async function getByCriteria(
    criteria: ProjectDeploymentCriteria,
    queryDb: Db = db,
  ): Promise<ProjectDeploymentRow[]> {
    const conditions = [];
    if (criteria.id) conditions.push(eq(projectDeployments.id, criteria.id));
    if (criteria.companyId) conditions.push(eq(projectDeployments.companyId, criteria.companyId));
    if (criteria.projectId) conditions.push(eq(projectDeployments.projectId, criteria.projectId));
    if (criteria.targetName) conditions.push(eq(projectDeployments.targetName, criteria.targetName));
    if (criteria.targetNames && criteria.targetNames.length > 0) {
      conditions.push(inArray(projectDeployments.targetName, criteria.targetNames));
    }
    if (criteria.activeOnly) {
      conditions.push(inArray(projectDeployments.status, ACTIVE));
    } else if (criteria.statuses && criteria.statuses.length > 0) {
      conditions.push(inArray(projectDeployments.status, criteria.statuses));
    }

    const query = queryDb
      .select()
      .from(projectDeployments)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return criteria.forUpdate ? query.for("update") : query;
  }

  async function countActiveProjectsInCompany(companyId: string): Promise<number> {
    const [{ n }] = await db
      .select({ n: countDistinct(projectDeployments.projectId) })
      .from(projectDeployments)
      .where(and(
        eq(projectDeployments.companyId, companyId),
        inArray(projectDeployments.status, ACTIVE),
      ));
    return Number(n);
  }

  async function insert(tx: Db, values: ProjectDeploymentInsert): Promise<ProjectDeploymentRow> {
    const [row] = await tx.insert(projectDeployments).values(values).returning();
    return row!;
  }

  async function updateById(
    tx: Db,
    id: string,
    patch: Partial<ProjectDeploymentInsert>,
  ): Promise<ProjectDeploymentRow> {
    const [row] = await tx.update(projectDeployments)
      .set(patch)
      .where(eq(projectDeployments.id, id))
      .returning();
    return row!;
  }

  return {
    getByCriteria,
    countActiveProjectsInCompany,
    insert,
    updateById,
  };
}
