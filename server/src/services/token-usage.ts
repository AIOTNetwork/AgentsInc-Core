import { sql, and, inArray, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { costEvents, companyMemberships } from "@paperclipai/db";
import type { TokenUsage } from "@paperclipai/shared";
import { billingService } from "./billing.js";

interface CachedUsage {
  usage: TokenUsage;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds
const cache = new Map<string, CachedUsage>();

export function tokenUsageService(db: Db) {
  const billing = billingService(db);

  async function getUserCompanyIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(
        and(
          sql`${companyMemberships.principalType} = 'user'`,
          sql`${companyMemberships.principalId} = ${userId}`,
          sql`${companyMemberships.status} = 'active'`,
        ),
      );
    return rows.map((r) => r.companyId);
  }

  async function queryHourlyTokens(companyIds: string[]): Promise<number> {
    if (companyIds.length === 0) return 0;
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.outputTokens}), 0)::bigint`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, sql`now() - interval '1 hour'`),
        ),
      );
    return Number(row?.total ?? 0);
  }

  async function queryWeeklyTokens(companyIds: string[]): Promise<number> {
    if (companyIds.length === 0) return 0;
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.outputTokens}), 0)::bigint`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, sql`now() - interval '7 days'`),
        ),
      );
    return Number(row?.total ?? 0);
  }

  return {
    getUsage: async (userId: string): Promise<TokenUsage> => {
      const cached = cache.get(userId);
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.usage;
      }

      const sub = await billing.getSubscription(userId);
      const companyIds = await getUserCompanyIds(userId);

      const [hourlyUsed, weeklyUsed] = await Promise.all([
        queryHourlyTokens(companyIds),
        queryWeeklyTokens(companyIds),
      ]);

      const hourlyLimit = sub.plan.hourlyTokenLimit;
      const weeklyLimit = sub.plan.weeklyTokenLimit;

      const usage: TokenUsage = {
        hourly: {
          used: hourlyUsed,
          limit: hourlyLimit,
          percent: hourlyLimit ? Math.round((hourlyUsed / hourlyLimit) * 100) : null,
        },
        weekly: {
          used: weeklyUsed,
          limit: weeklyLimit,
          percent: weeklyLimit ? Math.round((weeklyUsed / weeklyLimit) * 100) : null,
        },
      };

      cache.set(userId, { usage, fetchedAt: Date.now() });
      return usage;
    },

    /**
     * Returns throttle decision for heartbeat execution.
     * - "normal": proceed as usual
     * - "throttle": double the heartbeat sleep interval
     * - "pause": skip execution entirely
     */
    getThrottleDecision: async (userId: string): Promise<"normal" | "throttle" | "pause"> => {
      if (!userId || userId === "local-board") return "normal";

      const usage = await tokenUsageService(db).getUsage(userId);

      const hourlyPct = usage.hourly.percent ?? 0;
      const weeklyPct = usage.weekly.percent ?? 0;
      const maxPct = Math.max(hourlyPct, weeklyPct);

      if (maxPct > 120) return "pause";
      if (maxPct > 100) return "throttle";
      return "normal";
    },

    invalidateCache: (userId: string) => {
      cache.delete(userId);
    },
  };
}
