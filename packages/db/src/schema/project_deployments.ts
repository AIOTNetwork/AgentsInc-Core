// packages/db/src/schema/project_deployments.ts
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectDeployments = pgTable(
  "project_deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    targetName: text("target_name").notNull(),
    type: text("type").notNull(),                   // 'preview' | 'production'
    provider: text("provider").notNull().default("vercel"),
    status: text("status").notNull().default("pending"),

    vercelProjectId: text("vercel_project_id"),
    vercelDeploymentId: text("vercel_deployment_id"),
    url: text("url"),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastDeployedAt: timestamp("last_deployed_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastCeoRunId: text("last_ceo_run_id"),
    requestedByUserId: text("requested_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectTargetUniqueIdx: uniqueIndex("project_deployments_project_target_idx")
      .on(table.projectId, table.targetName),
    companyStatusIdx: index("project_deployments_company_status_idx").on(table.companyId, table.status),
    projectStatusIdx: index("project_deployments_project_status_idx").on(table.projectId, table.status),
    statusUpdatedIdx: index("project_deployments_status_updated_idx").on(table.status, table.updatedAt),
  }),
);
