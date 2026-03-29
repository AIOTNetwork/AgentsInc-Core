import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companies,
  companyLogos,
  assets,
  agents,
  agentApiKeys,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  issues,
  issueComments,
  projects,
  goals,
  heartbeatRuns,
  heartbeatRunEvents,
  costEvents,
  financeEvents,
  approvalComments,
  approvals,
  activityLog,
  companySecrets,
  joinRequests,
  invites,
  principalPermissionGrants,
  companyMemberships,
} from "@paperclipai/db";
import { notFound, unprocessable } from "../errors.js";

export function companyService(db: Db) {
  const ISSUE_PREFIX_FALLBACK = "CMP";

  const companySelection = {
    id: companies.id,
    name: companies.name,
    description: companies.description,
    status: companies.status,
    issuePrefix: companies.issuePrefix,
    issueCounter: companies.issueCounter,
    budgetMonthlyCents: companies.budgetMonthlyCents,
    spentMonthlyCents: companies.spentMonthlyCents,
    requireBoardApprovalForNewAgents: companies.requireBoardApprovalForNewAgents,
    feedbackDataSharingEnabled: companies.feedbackDataSharingEnabled,
    feedbackDataSharingConsentAt: companies.feedbackDataSharingConsentAt,
    feedbackDataSharingConsentByUserId: companies.feedbackDataSharingConsentByUserId,
    feedbackDataSharingTermsVersion: companies.feedbackDataSharingTermsVersion,
    brandColor: companies.brandColor,
    logoAssetId: companyLogos.assetId,
    createdAt: companies.createdAt,
    updatedAt: companies.updatedAt,
  };

  function enrichCompany<T extends { logoAssetId: string | null }>(company: T) {
    return {
      ...company,
      logoUrl: company.logoAssetId ? `/api/assets/${company.logoAssetId}/content` : null,
    };
  }

  function currentUtcMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)),
    };
  }

  async function getMonthlySpendByCompanyIds(
    companyIds: string[],
    database: Pick<Db, "select"> = db,
  ) {
    if (companyIds.length === 0) return new Map<string, number>();
    const { start, end } = currentUtcMonthWindow();
    const rows = await database
      .select({
        companyId: costEvents.companyId,
        spentMonthlyCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, start),
          lt(costEvents.occurredAt, end),
        ),
      )
      .groupBy(costEvents.companyId);
    return new Map(rows.map((row) => [row.companyId, Number(row.spentMonthlyCents ?? 0)]));
  }

  async function hydrateCompanySpend<T extends { id: string; spentMonthlyCents: number }>(
    rows: T[],
    database: Pick<Db, "select"> = db,
  ) {
    const spendByCompanyId = await getMonthlySpendByCompanyIds(rows.map((row) => row.id), database);
    return rows.map((row) => ({
      ...row,
      spentMonthlyCents: spendByCompanyId.get(row.id) ?? 0,
    }));
  }

  function getCompanyQuery(database: Pick<Db, "select">) {
    return database
      .select(companySelection)
      .from(companies)
      .leftJoin(companyLogos, eq(companyLogos.companyId, companies.id));
  }

  function deriveIssuePrefixBase(name: string) {
    const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
    return normalized.slice(0, 3) || ISSUE_PREFIX_FALLBACK;
  }

  function suffixForAttempt(attempt: number) {
    if (attempt <= 1) return "";
    return "A".repeat(attempt - 1);
  }

  function isIssuePrefixConflict(error: unknown) {
    const constraint = typeof error === "object" && error !== null && "constraint" in error
      ? (error as { constraint?: string }).constraint
      : typeof error === "object" && error !== null && "constraint_name" in error
        ? (error as { constraint_name?: string }).constraint_name
        : undefined;
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: string }).code === "23505"
      && constraint === "companies_issue_prefix_idx";
  }

  async function createCompanyWithUniquePrefix(data: typeof companies.$inferInsert) {
    const base = deriveIssuePrefixBase(data.name);
    let suffix = 1;
    while (suffix < 10000) {
      const candidate = `${base}${suffixForAttempt(suffix)}`;
      try {
        const rows = await db
          .insert(companies)
          .values({ ...data, issuePrefix: candidate })
          .returning();
        return rows[0];
      } catch (error) {
        if (!isIssuePrefixConflict(error)) throw error;
      }
      suffix += 1;
    }
    throw new Error("Unable to allocate unique issue prefix");
  }

  return {
    list: async () => {
      const rows = await getCompanyQuery(db);
      const hydrated = await hydrateCompanySpend(rows);
      return hydrated.map((row) => enrichCompany(row));
    },

    getById: async (id: string) => {
      const row = await getCompanyQuery(db)
        .where(eq(companies.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [hydrated] = await hydrateCompanySpend([row], db);
      return enrichCompany(hydrated);
    },

    create: async (data: typeof companies.$inferInsert) => {
      const created = await createCompanyWithUniquePrefix(data);
      const row = await getCompanyQuery(db)
        .where(eq(companies.id, created.id))
        .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Company not found after creation");
      const [hydrated] = await hydrateCompanySpend([row], db);
      return enrichCompany(hydrated);
    },

    update: (
      id: string,
      data: Partial<typeof companies.$inferInsert> & { logoAssetId?: string | null },
    ) =>
      db.transaction(async (tx) => {
        const existing = await getCompanyQuery(tx)
          .where(eq(companies.id, id))
          .then((rows) => rows[0] ?? null);
        if (!existing) return null;

        const { logoAssetId, ...companyPatch } = data;

        if (logoAssetId !== undefined && logoAssetId !== null) {
          const nextLogoAsset = await tx
            .select({ id: assets.id, companyId: assets.companyId })
            .from(assets)
            .where(eq(assets.id, logoAssetId))
            .then((rows) => rows[0] ?? null);
          if (!nextLogoAsset) throw notFound("Logo asset not found");
          if (nextLogoAsset.companyId !== existing.id) {
            throw unprocessable("Logo asset must belong to the same company");
          }
        }

        const updated = await tx
          .update(companies)
          .set({ ...companyPatch, updatedAt: new Date() })
          .where(eq(companies.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;

        if (logoAssetId === null) {
          await tx.delete(companyLogos).where(eq(companyLogos.companyId, id));
        } else if (logoAssetId !== undefined) {
          await tx
            .insert(companyLogos)
            .values({
              companyId: id,
              assetId: logoAssetId,
            })
            .onConflictDoUpdate({
              target: companyLogos.companyId,
              set: {
                assetId: logoAssetId,
                updatedAt: new Date(),
              },
            });
        }

        if (logoAssetId !== undefined && existing.logoAssetId && existing.logoAssetId !== logoAssetId) {
          await tx.delete(assets).where(eq(assets.id, existing.logoAssetId));
        }

        const [hydrated] = await hydrateCompanySpend([{
          ...updated,
          logoAssetId: logoAssetId === undefined ? existing.logoAssetId : logoAssetId,
        }], tx);

        return enrichCompany(hydrated);
      }),

    archive: (id: string) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(companies)
          .set({ status: "archived", updatedAt: new Date() })
          .where(eq(companies.id, id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) return null;
        const row = await getCompanyQuery(tx)
          .where(eq(companies.id, id))
          .then((rows) => rows[0] ?? null);
        if (!row) return null;
        const [hydrated] = await hydrateCompanySpend([row], tx);
        return enrichCompany(hydrated);
      }),

    remove: async (id: string) => {
      // Delete managed GitHub repos before cascade (fire-and-forget)
      try {
        const { githubAppService } = await import("./github-app.js");
        const { projectWorkspaces } = await import("@paperclipai/db");
        const github = githubAppService(db);
        const workspaces = await db
          .select({ repoUrl: projectWorkspaces.repoUrl })
          .from(projectWorkspaces)
          .where(eq(projectWorkspaces.companyId, id));
        for (const ws of workspaces) {
          if (!ws.repoUrl || !github.isManagedRepo(ws.repoUrl, id)) continue;
          const fullName = github.parseRepoFullName(ws.repoUrl);
          if (fullName) await github.deleteRepo(id, fullName);
        }
      } catch (err) {
        console.warn("[companies] GitHub repo cleanup on delete failed:", err instanceof Error ? err.message : err);
      }

      return db.transaction(async (tx) => {
        // Delete ALL referencing rows via raw SQL for reliability.
        // Drizzle delete doesn't handle deep FK chains well, and manually
        // tracking every table is error-prone. This uses a CTE approach
        // to delete from all tables that have a company_id column.
        // Each entry: [table_name, column_to_match]
        // Most tables have company_id, some use cascade or need subquery
        const directDeletes: Array<[string, string]> = [
          ['activity_log', 'company_id'],
          ['workspace_operations', 'company_id'],
          ['issue_work_products', 'company_id'],
          ['workspace_runtime_services', 'company_id'],
          ['execution_workspaces', 'company_id'],
          ['routine_runs', 'company_id'],
          ['routine_triggers', 'company_id'],
          ['routines', 'company_id'],
          ['budget_incidents', 'company_id'],
          ['budget_policies', 'company_id'],
          ['cost_events', 'company_id'],
          ['finance_events', 'company_id'],
          ['heartbeat_run_events', 'company_id'],
          ['agent_task_sessions', 'company_id'],
          ['heartbeat_runs', 'company_id'],
          ['agent_wakeup_requests', 'company_id'],
          ['agent_config_revisions', 'company_id'],
          ['agent_api_keys', 'company_id'],
          ['agent_runtime_state', 'company_id'],
          ['issue_read_states', 'company_id'],
          ['issue_attachments', 'company_id'],
          ['issue_labels', 'company_id'],
          ['issue_documents', 'company_id'],
          ['issue_approvals', 'company_id'],
          ['issue_comments', 'company_id'],
          ['document_revisions', 'company_id'],
          ['documents', 'company_id'],
          ['approval_comments', 'company_id'],
          ['approvals', 'company_id'],
          // company_secret_versions cascade-deletes via company_secrets.secretId
          ['company_secrets', 'company_id'],
          ['join_requests', 'company_id'],
          ['invites', 'company_id'],
          ['principal_permission_grants', 'company_id'],
          ['company_memberships', 'company_id'],
          ['plugin_company_settings', 'company_id'],
          ['company_skills', 'company_id'],
          ['project_goals', 'company_id'],
          ['project_workspaces', 'company_id'],
          ['issues', 'company_id'],
          ['company_logos', 'company_id'],
          ['assets', 'company_id'],
          ['labels', 'company_id'],
          ['projects', 'company_id'],
          ['goals', 'company_id'],
          ['agents', 'company_id'],
          ['companies', 'id'],
        ];
        for (const [table, col] of directDeletes) {
          try {
            await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${sql.identifier(col)} = ${id}`);
          } catch {
            // Table may not exist yet (pending migration) — skip
          }
        }
        return null;
      });
    },

    stats: () =>
      Promise.all([
        db
          .select({ companyId: agents.companyId, count: count() })
          .from(agents)
          .groupBy(agents.companyId),
        db
          .select({ companyId: issues.companyId, count: count() })
          .from(issues)
          .groupBy(issues.companyId),
      ]).then(([agentRows, issueRows]) => {
        const result: Record<string, { agentCount: number; issueCount: number }> = {};
        for (const row of agentRows) {
          result[row.companyId] = { agentCount: row.count, issueCount: 0 };
        }
        for (const row of issueRows) {
          if (result[row.companyId]) {
            result[row.companyId].issueCount = row.count;
          } else {
            result[row.companyId] = { agentCount: 0, issueCount: row.count };
          }
        }
        return result;
      }),
  };
}
