import { pgTable, uuid, text, integer, bigint, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    maxCompanies: integer("max_companies"),
    hourlyTokenLimit: bigint("hourly_token_limit", { mode: "number" }),
    weeklyTokenLimit: bigint("weekly_token_limit", { mode: "number" }),
    priceMonthCents: integer("price_month_cents").notNull().default(0),
    priceYearCents: integer("price_year_cents"),
    stripePriceIdMonthly: text("stripe_price_id_monthly"),
    stripePriceIdYearly: text("stripe_price_id_yearly"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("plans_slug_unique_idx").on(table.slug),
  }),
);
