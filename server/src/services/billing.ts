import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, plans, userSubscriptions } from "@paperclipai/db";
import type { Plan, SubscriptionWithPlan, SubscriptionStatus } from "@paperclipai/shared";
import { getFreePlan } from "./plan-seed.js";

export function billingService(db: Db) {
  return {
    listPublicPlans: async (): Promise<Plan[]> => {
      return db
        .select()
        .from(plans)
        .where(eq(plans.isPublic, true))
        .orderBy(plans.sortOrder);
    },

    getPlan: async (planId: string): Promise<Plan | undefined> => {
      const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      return plan;
    },

    getPlanBySlug: async (slug: string): Promise<Plan | undefined> => {
      const [plan] = await db.select().from(plans).where(eq(plans.slug, slug)).limit(1);
      return plan;
    },

    getSubscription: async (userId: string): Promise<SubscriptionWithPlan> => {
      const [row] = await db
        .select({
          subscription: userSubscriptions,
          plan: plans,
        })
        .from(userSubscriptions)
        .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
        .where(eq(userSubscriptions.userId, userId))
        .limit(1);

      if (row) {
        return { ...row.subscription, status: row.subscription.status as SubscriptionStatus, plan: row.plan };
      }

      // Lazy provisioning: create free subscription if none exists
      const freePlan = await getFreePlan(db);
      const [newSub] = await db
        .insert(userSubscriptions)
        .values({ userId, planId: freePlan.id, status: "active" })
        .onConflictDoNothing()
        .returning();

      if (newSub) {
        return { ...newSub, status: newSub.status as SubscriptionStatus, plan: freePlan };
      }

      // Race condition: another request created it
      const [existing] = await db
        .select({ subscription: userSubscriptions, plan: plans })
        .from(userSubscriptions)
        .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
        .where(eq(userSubscriptions.userId, userId))
        .limit(1);

      return { ...existing.subscription, status: existing.subscription.status as SubscriptionStatus, plan: existing.plan };
    },

    updateSubscription: async (
      userId: string,
      update: Partial<{
        planId: string;
        status: string;
        stripeCustomerId: string;
        stripeSubscriptionId: string;
        currentPeriodStart: Date;
        currentPeriodEnd: Date;
        cancelAtPeriodEnd: boolean;
        trialEndsAt: Date | null;
      }>,
    ) => {
      const [updated] = await db
        .update(userSubscriptions)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(userSubscriptions.userId, userId))
        .returning();
      return updated;
    },

    getSubscriptionByStripeCustomerId: async (stripeCustomerId: string) => {
      const [row] = await db
        .select({ subscription: userSubscriptions, plan: plans })
        .from(userSubscriptions)
        .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
        .where(eq(userSubscriptions.stripeCustomerId, stripeCustomerId))
        .limit(1);
      return row ? { ...row.subscription, plan: row.plan } : undefined;
    },

    // Look up a company's subscription via its owner user membership. Returns
    // null when no owner or no subscription exists; callers fall back to plan
    // defaults. Read-only (no lazy provisioning).
    getSubscriptionForCompany: async (companyId: string): Promise<SubscriptionWithPlan | null> => {
      const [membership] = await db
        .select({ userId: companyMemberships.principalId })
        .from(companyMemberships)
        .where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.membershipRole, "owner"),
          eq(companyMemberships.status, "active"),
        ))
        .limit(1);
      if (!membership) return null;

      const [row] = await db
        .select({ subscription: userSubscriptions, plan: plans })
        .from(userSubscriptions)
        .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
        .where(eq(userSubscriptions.userId, membership.userId))
        .limit(1);
      if (!row) return null;
      return { ...row.subscription, status: row.subscription.status as SubscriptionStatus, plan: row.plan };
    },
  };
}
