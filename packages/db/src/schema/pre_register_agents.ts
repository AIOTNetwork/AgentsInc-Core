import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { preRegisterUsers } from "./pre_register_users.js";

export const preRegisterAgents = pgTable(
  "pre_register_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    preRegisterUserId: uuid("pre_register_user_id")
      .notNull()
      .references(() => preRegisterUsers.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    idea: text("idea").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    preRegisterUserUniqueIdx: uniqueIndex("pre_register_agents_user_unique_idx").on(
      table.preRegisterUserId,
    ),
  }),
);
