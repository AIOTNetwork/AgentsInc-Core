export interface Plan {
  id: string;
  slug: string;
  name: string;
  maxCompanies: number | null;
  hourlyTokenLimit: number | null;
  weeklyTokenLimit: number | null;
  priceMonthCents: number;
  priceYearCents: number | null;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
  sortOrder: number;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSubscription {
  id: string;
  userId: string;
  planId: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "paused";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionWithPlan extends UserSubscription {
  plan: Plan;
}

export interface TokenUsage {
  hourly: { used: number; limit: number | null; percent: number | null };
  weekly: { used: number; limit: number | null; percent: number | null };
}

export interface TokenUsageHistory {
  buckets: Array<{
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  granularity: "hourly" | "daily" | "weekly";
}

export type SubscriptionStatus = UserSubscription["status"];
