import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { plans } from "./plans.js";

export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    status: text("status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdUniqueIdx: uniqueIndex("user_subscriptions_user_id_unique_idx").on(table.userId),
    planIdIdx: index("user_subscriptions_plan_id_idx").on(table.planId),
    stripeCustomerIdx: index("user_subscriptions_stripe_customer_idx").on(table.stripeCustomerId),
    statusIdx: index("user_subscriptions_status_idx").on(table.status),
  }),
);
