import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { plans } from "@paperclipai/db";

const SEED_PLANS = [
  { slug: "free", name: "Free", maxCompanies: 1, hourlyTokenLimit: 50_000, weeklyTokenLimit: 500_000, priceMonthCents: 0, sortOrder: 0, isPublic: true },
  { slug: "pro", name: "Pro", maxCompanies: 3, hourlyTokenLimit: 500_000, weeklyTokenLimit: 5_000_000, priceMonthCents: 2000, sortOrder: 1, isPublic: true },
  { slug: "pro_max", name: "Pro Max", maxCompanies: 10, hourlyTokenLimit: 2_000_000, weeklyTokenLimit: 20_000_000, priceMonthCents: 10000, sortOrder: 2, isPublic: true },
  { slug: "pro_max_5x", name: "Pro Max 5X", maxCompanies: 50, hourlyTokenLimit: 5_000_000, weeklyTokenLimit: 50_000_000, priceMonthCents: 20000, sortOrder: 3, isPublic: true },
  { slug: "enterprise", name: "Enterprise", maxCompanies: null, hourlyTokenLimit: null, weeklyTokenLimit: null, priceMonthCents: 0, sortOrder: 4, isPublic: false },
] as const;

export async function seedPlans(db: Db): Promise<void> {
  for (const plan of SEED_PLANS) {
    const existing = await db.select().from(plans).where(eq(plans.slug, plan.slug)).limit(1);
    if (existing.length === 0) {
      await db.insert(plans).values(plan);
    }
  }
}

export async function getFreePlan(db: Db) {
  const [freePlan] = await db.select().from(plans).where(eq(plans.slug, "free")).limit(1);
  if (!freePlan) throw new Error("Free plan not found — run seedPlans first");
  return freePlan;
}
