import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { preRegisterUsers } from "./pre_register_users.js";

export const preRegisterAgents = pgTable(
  "pre_register_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    preRegisterUserId: uuid("pre_register_user_id").references(() => preRegisterUsers.id, {
      onDelete: "cascade",
    }),
    agentId: text("agent_id").notNull(),
    idea: text("idea").notNull(),
    tokenId: text("token_id"),
    mintTxHash: text("mint_tx_hash"),
    walletAddress: text("wallet_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdUniqueIdx: uniqueIndex("pre_register_agents_agent_id_unique_idx").on(table.agentId),
    tokenIdUniqueIdx: uniqueIndex("pre_register_agents_token_id_unique_idx")
      .on(table.tokenId)
      .where(sql`${table.tokenId} IS NOT NULL`),
    walletAddressIdx: index("pre_register_agents_wallet_address_idx")
      .on(table.walletAddress)
      .where(sql`${table.walletAddress} IS NOT NULL`),
  }),
);
