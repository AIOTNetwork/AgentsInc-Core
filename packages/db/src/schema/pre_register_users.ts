import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const preRegisterUsers = pgTable(
  "pre_register_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    walletAddress: text("wallet_address"),
    provider: text("provider"),
    chainId: text("chain_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUniqueIdx: uniqueIndex("pre_register_users_email_unique_idx").on(table.email),
    walletAddressUniqueIdx: uniqueIndex("pre_register_users_wallet_address_unique_idx").on(
      table.walletAddress,
    ),
  }),
);
