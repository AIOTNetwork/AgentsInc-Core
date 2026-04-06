# User Plans, Stripe Billing & Token Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded company limit with a plan-based subscription system using Stripe billing, rolling-window token rate limits, and full usage visibility in the Office UI.

**Architecture:** Two new DB tables (`plans`, `user_subscriptions`) + new billing service with Stripe SDK + token usage aggregation from existing `cost_events` + heartbeat throttle enforcement + Office UI pages for billing/usage.

**Tech Stack:** Drizzle ORM, Express, Stripe SDK, React (Office UI), Vite

**Spec:** `docs/superpowers/specs/2026-04-06-user-plans-token-usage-design.md`

**Team Assignment:**

| Task | Owner | Phase |
|------|-------|-------|
| 1-3 | `db-engineer` | Phase 1: Schema |
| 4-5 | `backend-api` | Phase 2: Billing Service |
| 6 | `backend-api` | Phase 2: Stripe Webhooks |
| 7 | `backend-api` | Phase 2: Plan Enforcement |
| 8 | `heartbeat-enforcer` | Phase 3: Token Metering |
| 9-10 | `backend-api` | Phase 3: Usage API |
| 11-12 | `frontend` | Phase 4: Office UI |
| 13-14 | `backend-api` | Phase 5: Admin API |
| Review gates | `code-reviewer`, `security`, `qa` | After each phase |

**Dependencies:**
- Tasks 1-3 must complete before all others
- Tasks 4-7 can run in parallel with Task 8 after Phase 1
- Tasks 9-10 depend on Task 8
- Tasks 11-12 depend on Tasks 4-10
- Tasks 13-14 can run in parallel with Tasks 11-12

---

## Phase 1: Schema + Seed (Owner: `db-engineer`)

### Task 1: Plans Table Schema

**Files:**
- Create: `packages/db/src/schema/plans.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the plans schema file**

```typescript
// packages/db/src/schema/plans.ts
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
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { plans } from "./plans.js";
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS (no type errors from new schema)

- [ ] **Step 4: Generate migration**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm db:generate`
Expected: Migration file created in `packages/db/drizzle/`

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/plans.ts packages/db/src/schema/index.ts packages/db/drizzle/
git commit -m "feat(db): add plans table schema and migration"
```

---

### Task 2: User Subscriptions Table Schema

**Files:**
- Create: `packages/db/src/schema/user_subscriptions.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create the user_subscriptions schema file**

```typescript
// packages/db/src/schema/user_subscriptions.ts
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
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts`:

```typescript
export { userSubscriptions } from "./user_subscriptions.js";
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 4: Generate migration**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm db:generate`
Expected: Migration file created

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/user_subscriptions.ts packages/db/src/schema/index.ts packages/db/drizzle/
git commit -m "feat(db): add user_subscriptions table schema and migration"
```

---

### Task 3: Shared Types + Seed Data

**Files:**
- Create: `packages/shared/src/types/billing.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `server/src/services/plan-seed.ts`

- [ ] **Step 1: Create shared billing types**

```typescript
// packages/shared/src/types/billing.ts

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
```

- [ ] **Step 2: Export from types index**

Add to `packages/shared/src/types/index.ts`:

```typescript
export type {
  Plan,
  UserSubscription,
  SubscriptionWithPlan,
  TokenUsage,
  TokenUsageHistory,
  SubscriptionStatus,
} from "./billing.js";
```

- [ ] **Step 3: Create seed service**

```typescript
// server/src/services/plan-seed.ts
import { eq } from "drizzle-orm";
import type { Db } from "@paperclip/db";
import { plans } from "@paperclip/db/schema";

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
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/billing.ts packages/shared/src/types/index.ts server/src/services/plan-seed.ts
git commit -m "feat: add billing types and plan seed data"
```

---

## Phase 1 Review Gate

**`code-reviewer`:** Review schema design, types, seed data for correctness and consistency.
**`qa`:** Run `pnpm -r typecheck && pnpm build` to verify no breakage.

---

## Phase 2: Billing Service + Stripe (Owner: `backend-api`)

### Task 4: Billing Service Core

**Files:**
- Create: `server/src/services/billing.ts`

- [ ] **Step 1: Create billing service**

```typescript
// server/src/services/billing.ts
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclip/db";
import { plans, userSubscriptions } from "@paperclip/db/schema";
import type { Plan, SubscriptionWithPlan } from "@paperclip/shared/types";
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
        return { ...row.subscription, plan: row.plan };
      }

      // Lazy provisioning: create free subscription if none exists
      const freePlan = await getFreePlan(db);
      const [newSub] = await db
        .insert(userSubscriptions)
        .values({ userId, planId: freePlan.id, status: "active" })
        .onConflictDoNothing()
        .returning();

      if (newSub) {
        return { ...newSub, plan: freePlan };
      }

      // Race condition: another request created it
      const [existing] = await db
        .select({ subscription: userSubscriptions, plan: plans })
        .from(userSubscriptions)
        .innerJoin(plans, eq(userSubscriptions.planId, plans.id))
        .where(eq(userSubscriptions.userId, userId))
        .limit(1);

      return { ...existing.subscription, plan: existing.plan };
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
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/services/billing.ts
git commit -m "feat: add billing service with subscription CRUD and lazy provisioning"
```

---

### Task 5: Billing Routes + Stripe Checkout

**Files:**
- Create: `server/src/routes/billing.ts`
- Modify: `server/src/routes/index.ts`

- [ ] **Step 1: Install stripe dependency**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm add stripe --filter server`

If the server package name differs, check `server/package.json` for the `name` field and use that.

- [ ] **Step 2: Create billing routes**

```typescript
// server/src/routes/billing.ts
import { Router } from "express";
import Stripe from "stripe";
import type { Db } from "@paperclip/db";
import { billingService } from "../services/billing.js";
import { assertBoard } from "./authz.js";

export function billingRoutes(db: Db) {
  const router = Router();
  const billing = billingService(db);

  const getStripe = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    return new Stripe(key);
  };

  // GET /api/plans — public, list plans
  router.get("/plans", async (_req, res) => {
    const planList = await billing.listPublicPlans();
    res.json(planList);
  });

  // GET /api/billing/subscription — current user subscription + plan
  router.get("/billing/subscription", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId || userId === "local-board") {
      res.json({ plan: await billing.getPlanBySlug("enterprise"), status: "active", isLocal: true });
      return;
    }
    const sub = await billing.getSubscription(userId);
    res.json(sub);
  });

  // POST /api/billing/checkout — create Stripe Checkout session
  router.post("/billing/checkout", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId || userId === "local-board") {
      res.status(400).json({ error: "Local mode does not support billing" });
      return;
    }

    const { planSlug, interval = "month" } = req.body as { planSlug: string; interval?: "month" | "year" };
    if (!planSlug) {
      res.status(400).json({ error: "planSlug is required" });
      return;
    }

    const plan = await billing.getPlanBySlug(planSlug);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    const priceId = interval === "year" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
    if (!priceId) {
      res.status(400).json({ error: `No Stripe price configured for ${plan.name} (${interval})` });
      return;
    }

    const stripe = getStripe();
    const sub = await billing.getSubscription(userId);

    let customerId = sub.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
      await billing.updateSubscription(userId, { stripeCustomerId: customerId });
    }

    const origin = req.headers.origin ?? `${req.protocol}://${req.get("host")}`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings/billing`,
      metadata: { userId, planId: plan.id },
    });

    res.json({ checkoutUrl: session.url });
  });

  // POST /api/billing/portal — create Stripe Customer Portal session
  router.post("/billing/portal", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId || userId === "local-board") {
      res.status(400).json({ error: "Local mode does not support billing" });
      return;
    }

    const sub = await billing.getSubscription(userId);
    if (!sub.stripeCustomerId) {
      res.status(400).json({ error: "No billing account found. Subscribe to a plan first." });
      return;
    }

    const stripe = getStripe();
    const origin = req.headers.origin ?? `${req.protocol}://${req.get("host")}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/settings/billing`,
    });

    res.json({ portalUrl: session.url });
  });

  return router;
}
```

- [ ] **Step 3: Mount billing routes**

Add to `server/src/routes/index.ts`:

```typescript
export { billingRoutes } from "./billing.js";
```

Then in the main server setup file (find where routes are mounted with `app.use`), add:

```typescript
app.use("/api", billingRoutes(db));
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/billing.ts server/src/routes/index.ts server/package.json pnpm-lock.yaml
git commit -m "feat: add billing routes with Stripe Checkout and Portal"
```

---

### Task 6: Stripe Webhook Handler

**Files:**
- Create: `server/src/services/stripe-webhooks.ts`
- Modify: `server/src/routes/billing.ts`

- [ ] **Step 1: Create webhook handler service**

```typescript
// server/src/services/stripe-webhooks.ts
import Stripe from "stripe";
import type { Db } from "@paperclip/db";
import { plans } from "@paperclip/db/schema";
import { eq } from "drizzle-orm";
import { billingService } from "./billing.js";
import { getFreePlan } from "./plan-seed.js";

export function stripeWebhookService(db: Db) {
  const billing = billingService(db);

  return {
    handleCheckoutCompleted: async (session: Stripe.Checkout.Session) => {
      const userId = session.metadata?.userId;
      const planId = session.metadata?.planId;
      if (!userId || !planId) return;

      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

      await billing.updateSubscription(userId, {
        planId,
        status: "active",
        stripeSubscriptionId: subscriptionId ?? undefined,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id ?? undefined,
      });
    },

    handleSubscriptionUpdated: async (subscription: Stripe.Subscription) => {
      const customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;

      const sub = await billing.getSubscriptionByStripeCustomerId(customerId);
      if (!sub) return;

      // Resolve plan from Stripe price
      const priceId = subscription.items.data[0]?.price.id;
      let planId = sub.planId;
      if (priceId) {
        const allPlans = await db.select().from(plans);
        const matchedPlan = allPlans.find(
          (p) => p.stripePriceIdMonthly === priceId || p.stripePriceIdYearly === priceId,
        );
        if (matchedPlan) planId = matchedPlan.id;
      }

      await billing.updateSubscription(sub.userId, {
        planId,
        status: subscription.status === "active" ? "active"
          : subscription.status === "trialing" ? "trialing"
          : subscription.status === "past_due" ? "past_due"
          : subscription.status === "canceled" ? "canceled"
          : subscription.status === "paused" ? "paused"
          : "active",
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      });
    },

    handleSubscriptionDeleted: async (subscription: Stripe.Subscription) => {
      const customerId = typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;

      const sub = await billing.getSubscriptionByStripeCustomerId(customerId);
      if (!sub) return;

      const freePlan = await getFreePlan(db);
      await billing.updateSubscription(sub.userId, {
        planId: freePlan.id,
        status: "canceled",
        stripeSubscriptionId: undefined,
        cancelAtPeriodEnd: false,
      });
    },

    handleInvoicePaymentFailed: async (invoice: Stripe.Invoice) => {
      const customerId = typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer?.id;
      if (!customerId) return;

      const sub = await billing.getSubscriptionByStripeCustomerId(customerId);
      if (!sub) return;

      await billing.updateSubscription(sub.userId, { status: "past_due" });
    },
  };
}
```

- [ ] **Step 2: Add webhook route to billing.ts**

Add this route inside `billingRoutes()` in `server/src/routes/billing.ts`, **before** the other routes (webhook needs raw body):

```typescript
  // POST /api/billing/webhook — Stripe webhook
  // NOTE: This route needs raw body for signature verification.
  // Ensure express.raw() middleware is applied for this path in the server setup.
  router.post("/billing/webhook", async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"] as string;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;
    try {
      // req.body must be the raw buffer for signature verification
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    const { stripeWebhookService: webhookSvc } = await import("../services/stripe-webhooks.js");
    const handler = webhookSvc(db);

    switch (event.type) {
      case "checkout.session.completed":
        await handler.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
        await handler.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handler.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handler.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
    }

    res.json({ received: true });
  });
```

**Important:** The webhook endpoint needs the raw request body for Stripe signature verification. In the main server setup, ensure `express.raw({ type: "application/json" })` is applied to the `/api/billing/webhook` path, OR use `express.json()` with `verify` option to preserve the raw body.

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/services/stripe-webhooks.ts server/src/routes/billing.ts
git commit -m "feat: add Stripe webhook handler for subscription lifecycle events"
```

---

### Task 7: Replace Hardcoded Company Limit

**Files:**
- Modify: `server/src/routes/companies.ts`

- [ ] **Step 1: Replace MAX_COMPANIES_PER_USER**

In `server/src/routes/companies.ts`, find and replace the hardcoded limit block (around line 264-284):

Remove:
```typescript
const MAX_COMPANIES_PER_USER = 5;
```

In the `router.post("/", ...)` handler, replace the limit check:

**Before:**
```typescript
if (owned.length >= MAX_COMPANIES_PER_USER) {
  throw forbidden(`You can create up to ${MAX_COMPANIES_PER_USER} companies`);
}
```

**After:**
```typescript
const billing = (await import("../services/billing.js")).billingService(db);
const sub = await billing.getSubscription(userId);
if (sub.plan.maxCompanies !== null && owned.length >= sub.plan.maxCompanies) {
  throw forbidden(
    `Your ${sub.plan.name} plan allows up to ${sub.plan.maxCompanies} companies. Upgrade to create more.`,
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/companies.ts
git commit -m "feat: replace hardcoded company limit with plan-based lookup"
```

---

## Phase 2 Review Gate

**`code-reviewer`:** Review billing service, Stripe integration, webhook security, company limit replacement.
**`security`:** Verify Stripe webhook signature validation, checkout session metadata handling, no secret leakage in responses. Check that billing endpoints require proper auth. Verify raw body handling for webhook.
**`qa`:** Run `pnpm -r typecheck && pnpm build`. Test the `/api/plans` endpoint returns seeded plans. Test company creation fails when limit is reached.

---

## Phase 3: Token Metering (Owner: `heartbeat-enforcer` + `backend-api`)

### Task 8: Token Usage Service + Heartbeat Enforcement (Owner: `heartbeat-enforcer`)

**Files:**
- Create: `server/src/services/token-usage.ts`
- Modify: `server/src/services/heartbeat.ts`

- [ ] **Step 1: Create token usage service**

```typescript
// server/src/services/token-usage.ts
import { sql, and, inArray, gte } from "drizzle-orm";
import type { Db } from "@paperclip/db";
import { costEvents, companyMemberships } from "@paperclip/db/schema";
import type { TokenUsage } from "@paperclip/shared/types";
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

  async function queryTokens(companyIds: string[], interval: string): Promise<number> {
    if (companyIds.length === 0) return 0;
    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.outputTokens}), 0)::bigint`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, sql`now() - ${sql.raw(`interval '${interval}'`)}`),
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
        queryTokens(companyIds, "1 hour"),
        queryTokens(companyIds, "7 days"),
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
```

- [ ] **Step 2: Add throttle check in heartbeat**

In `server/src/services/heartbeat.ts`, find the section before `adapter.execute()` is called (around line 3076). Add the throttle check:

```typescript
// Before adapter.execute(), add:
import { tokenUsageService } from "./token-usage.js";

// Inside the execution function, before the adapter.execute() call:
const tokenUsage = tokenUsageService(db);
const ownerUserId = await resolveCompanyOwnerUserId(db, agent.companyId);
if (ownerUserId) {
  const throttle = await tokenUsage.getThrottleDecision(ownerUserId);
  if (throttle === "pause") {
    logger.warn({ agentId: agent.id, companyId: agent.companyId, ownerUserId }, "Token usage exceeded 120%, pausing agent");
    await logActivity(db, {
      companyId: agent.companyId,
      actorType: "system",
      actorId: "token-usage-enforcer",
      action: "budget_token_limit",
      entityType: "agent",
      entityId: agent.id,
      details: { reason: "Token usage exceeded 120% of plan limit" },
    });
    // Skip execution — return early or set a flag
    return { skipped: true, reason: "token_limit_exceeded" };
  }
  if (throttle === "throttle") {
    logger.info({ agentId: agent.id, ownerUserId }, "Token usage over 100%, throttling heartbeat");
    // Double the sleep interval for this agent's next heartbeat
    // (implementation depends on how heartbeat scheduling works — 
    //  set a flag or multiply the computed sleep duration by 2)
  }
}
```

**Note:** The exact integration depends on how `resolveCompanyOwnerUserId` is implemented. Add a helper to query company membership:

```typescript
async function resolveCompanyOwnerUserId(db: Db, companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: companyMemberships.principalId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/services/token-usage.ts server/src/services/heartbeat.ts
git commit -m "feat: add token usage metering with rolling-window rate limiting in heartbeat"
```

---

### Task 9: Usage API Endpoints (Owner: `backend-api`)

**Files:**
- Modify: `server/src/routes/billing.ts`

- [ ] **Step 1: Add usage endpoints to billing routes**

Add inside `billingRoutes()`:

```typescript
  // GET /api/billing/usage — current hourly/weekly token usage
  router.get("/billing/usage", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId || userId === "local-board") {
      res.json({
        hourly: { used: 0, limit: null, percent: null },
        weekly: { used: 0, limit: null, percent: null },
      });
      return;
    }
    const { tokenUsageService } = await import("../services/token-usage.js");
    const usage = await tokenUsageService(db).getUsage(userId);
    res.json(usage);
  });

  // GET /api/billing/usage/history — token usage over time
  router.get("/billing/usage/history", async (req, res) => {
    assertBoard(req);
    const userId = req.actor.userId;
    if (!userId || userId === "local-board") {
      res.json({ buckets: [], granularity: "hourly" });
      return;
    }

    const granularity = (req.query.granularity as string) || "hourly";
    const fromRaw = req.query.from as string | undefined;
    const toRaw = req.query.to as string | undefined;

    if (!["hourly", "daily", "weekly"].includes(granularity)) {
      res.status(400).json({ error: "granularity must be hourly, daily, or weekly" });
      return;
    }

    const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = toRaw ? new Date(toRaw) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    const truncExpr = granularity === "hourly" ? "hour"
      : granularity === "daily" ? "day"
      : "week";

    // Get user's company IDs
    const companyIds = await db
      .select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(
        and(
          sql`${companyMemberships.principalType} = 'user'`,
          sql`${companyMemberships.principalId} = ${userId}`,
          sql`${companyMemberships.status} = 'active'`,
        ),
      )
      .then((rows) => rows.map((r) => r.companyId));

    if (companyIds.length === 0) {
      res.json({ buckets: [], granularity });
      return;
    }

    const buckets = await db
      .select({
        timestamp: sql<string>`date_trunc(${sql.raw(`'${truncExpr}'`)}, ${costEvents.occurredAt})::text`,
        inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::bigint`,
        totalTokens: sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.outputTokens}), 0)::bigint`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, from),
          sql`${costEvents.occurredAt} < ${to}`,
        ),
      )
      .groupBy(sql`date_trunc(${sql.raw(`'${truncExpr}'`)}, ${costEvents.occurredAt})`)
      .orderBy(sql`date_trunc(${sql.raw(`'${truncExpr}'`)}, ${costEvents.occurredAt})`);

    res.json({
      buckets: buckets.map((b) => ({
        timestamp: b.timestamp,
        inputTokens: Number(b.inputTokens),
        outputTokens: Number(b.outputTokens),
        totalTokens: Number(b.totalTokens),
      })),
      granularity,
    });
  });
```

Add necessary imports at top of `billing.ts`:

```typescript
import { sql, and, inArray, gte, eq } from "drizzle-orm";
import { companyMemberships, costEvents } from "@paperclip/db/schema";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/billing.ts
git commit -m "feat: add token usage and usage history API endpoints"
```

---

### Task 10: Seed Plans on Server Startup

**Files:**
- Modify: server startup file (find the main entry point, likely `server/src/index.ts`)

- [ ] **Step 1: Call seedPlans on startup**

Find the server startup file and add after DB initialization:

```typescript
import { seedPlans } from "./services/plan-seed.js";

// After db is initialized, before server starts listening:
await seedPlans(db);
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: seed plans on server startup"
```

---

## Phase 3 Review Gate

**`code-reviewer`:** Review token usage service, SQL queries (injection risk?), cache implementation, heartbeat integration.
**`security`:** Verify SQL parameterization in usage queries. Check that usage endpoints don't leak other users' data. Verify rate limiting can't be bypassed.
**`qa`:** Run `pnpm -r typecheck && pnpm build`. Verify `/api/billing/usage` returns valid data. Verify `/api/billing/usage/history` handles all granularities. Test throttle logic with mock data.

---

## Phase 4: Office UI (Owner: `frontend`)

### Task 11: Billing API Client + Billing Page

**Files:**
- Create: `AgentsInc-Office/src/data/billing.ts`
- Create: `AgentsInc-Office/src/ui/BillingPage.tsx` (or equivalent path matching existing page structure)

- [ ] **Step 1: Check Office UI structure**

Read `AgentsInc-Office/src/` directory to confirm page/component conventions, router setup, and API client patterns before creating files. Adapt the following code to match existing patterns.

- [ ] **Step 2: Create billing API client**

```typescript
// AgentsInc-Office/src/data/billing.ts
import { getApiBase } from "./config"

const base = getApiBase()

async function fetchJson<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem("paperclip_board_token")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${base}${path}`, { ...opts, headers, credentials: "include" })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export interface Plan {
  id: string
  slug: string
  name: string
  maxCompanies: number | null
  hourlyTokenLimit: number | null
  weeklyTokenLimit: number | null
  priceMonthCents: number
  priceYearCents: number | null
  sortOrder: number
  isPublic: boolean
}

export interface Subscription {
  id: string
  userId: string
  planId: string
  status: string
  plan: Plan
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  isLocal?: boolean
}

export interface TokenUsage {
  hourly: { used: number; limit: number | null; percent: number | null }
  weekly: { used: number; limit: number | null; percent: number | null }
}

export interface UsageHistoryBucket {
  timestamp: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export const billingApi = {
  getPlans: () => fetchJson<Plan[]>("/api/plans"),
  getSubscription: () => fetchJson<Subscription>("/api/billing/subscription"),
  getUsage: () => fetchJson<TokenUsage>("/api/billing/usage"),
  getUsageHistory: (granularity = "hourly", from?: string, to?: string) => {
    const params = new URLSearchParams({ granularity })
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    return fetchJson<{ buckets: UsageHistoryBucket[]; granularity: string }>(
      `/api/billing/usage/history?${params}`,
    )
  },
  createCheckout: (planSlug: string, interval: "month" | "year" = "month") =>
    fetchJson<{ checkoutUrl: string }>("/api/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ planSlug, interval }),
    }),
  createPortalSession: () =>
    fetchJson<{ portalUrl: string }>("/api/billing/portal", { method: "POST" }),
}
```

- [ ] **Step 3: Create Billing Page**

Create a billing page that shows:
- Current plan card with name, company limit, token limits
- Two usage meters (hourly/weekly) with color coding (green < 80%, amber 80-100%, red > 100%)
- Plan comparison grid with upgrade buttons
- Enterprise "Contact Sales" CTA

Adapt to match the existing page patterns in the Office UI (check existing pages for layout components, styling conventions, routing).

- [ ] **Step 4: Add route for billing page**

Add the billing page to the router configuration (check `AgentsInc-Office/src/` for the routing pattern — could be in `main.ts`, `App.tsx`, or a dedicated router file).

- [ ] **Step 5: Run typecheck and build**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Office && npm run typecheck` (or the equivalent command from `package.json`)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add AgentsInc-Office/src/data/billing.ts AgentsInc-Office/src/ui/BillingPage.tsx
git commit -m "feat(office): add billing page with plan comparison and usage meters"
```

---

### Task 12: Usage Dashboard + Warning Banner + Company Gate

**Files:**
- Create: `AgentsInc-Office/src/ui/UsageDashboard.tsx`
- Create: `AgentsInc-Office/src/ui/UsageWarningBanner.tsx`
- Modify: company creation UI (find the existing "New Company" button/dialog)

- [ ] **Step 1: Create Usage Dashboard page**

Build a page showing:
- Time-series chart of token consumption (use existing charting library if one is already in the project, otherwise a simple SVG/canvas bar chart)
- Granularity toggle (hourly/daily/weekly)
- Breakdown by company/agent/model (these can be future iterations — start with the aggregate chart)
- Rolling window progress bars

- [ ] **Step 2: Create Warning Banner component**

```typescript
// A banner component that:
// - Polls /api/billing/usage every 60 seconds
// - Shows amber warning at 80%+ usage
// - Shows red non-dismissable warning at 100%+
// - Includes "Upgrade Plan" link to /settings/billing
// - Renders at the top of the main layout
```

Integrate the banner into the root layout component so it appears on all pages.

- [ ] **Step 3: Update Company Creation gate**

Find the existing "New Company" button (likely in the company selector or onboarding flow). Modify it to:
- Fetch `/api/billing/subscription` to get current plan limits
- Compare owned company count against `plan.maxCompanies`
- If at limit: disable button, show message: "Your {plan.name} plan allows up to {maxCompanies} companies. Upgrade to {nextPlan} for {nextLimit}."
- Include upgrade CTA link

- [ ] **Step 4: Add usage dashboard route**

Add `/settings/usage` route pointing to the UsageDashboard page.

- [ ] **Step 5: Run typecheck and build**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Office && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add AgentsInc-Office/src/ui/UsageDashboard.tsx AgentsInc-Office/src/ui/UsageWarningBanner.tsx
git commit -m "feat(office): add usage dashboard, warning banner, and company creation plan gate"
```

---

## Phase 4 Review Gate

**`code-reviewer`:** Review UI components for correctness, proper error handling, accessibility.
**`security`:** Verify no auth tokens leaked in client-side code. Check that billing API client uses credentials properly.
**`qa`:** Build the Office UI. Verify billing page renders with mock/real data. Test warning banner threshold behavior. Test company creation gate.

---

## Phase 5: Admin API (Owner: `backend-api`)

### Task 13: Admin Plan Management Endpoints

**Files:**
- Modify: `server/src/routes/billing.ts`

- [ ] **Step 1: Add admin plan CRUD routes**

Add inside `billingRoutes()`:

```typescript
  // POST /api/admin/plans — create a plan (instance admin only)
  router.post("/admin/plans", async (req, res) => {
    assertBoard(req);
    if (!req.actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin required" });
      return;
    }

    const { slug, name, maxCompanies, hourlyTokenLimit, weeklyTokenLimit, priceMonthCents, priceYearCents, stripePriceIdMonthly, stripePriceIdYearly, sortOrder, isPublic } = req.body;

    if (!slug || !name) {
      res.status(400).json({ error: "slug and name are required" });
      return;
    }

    const [plan] = await db
      .insert(plans)
      .values({
        slug,
        name,
        maxCompanies: maxCompanies ?? null,
        hourlyTokenLimit: hourlyTokenLimit ?? null,
        weeklyTokenLimit: weeklyTokenLimit ?? null,
        priceMonthCents: priceMonthCents ?? 0,
        priceYearCents: priceYearCents ?? null,
        stripePriceIdMonthly: stripePriceIdMonthly ?? null,
        stripePriceIdYearly: stripePriceIdYearly ?? null,
        sortOrder: sortOrder ?? 0,
        isPublic: isPublic ?? true,
      })
      .returning();

    res.status(201).json(plan);
  });

  // PUT /api/admin/plans/:planId — edit a plan
  router.put("/admin/plans/:planId", async (req, res) => {
    assertBoard(req);
    if (!req.actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin required" });
      return;
    }

    const planId = req.params.planId;
    const update = req.body;

    const [plan] = await db
      .update(plans)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(plans.id, planId))
      .returning();

    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }

    res.json(plan);
  });
```

Add `plans` import at top:

```typescript
import { plans, userSubscriptions } from "@paperclip/db/schema";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/billing.ts
git commit -m "feat: add admin plan management endpoints (create/edit)"
```

---

### Task 14: Admin User Plan Override

**Files:**
- Modify: `server/src/routes/billing.ts`

- [ ] **Step 1: Add admin user plan override route**

Add inside `billingRoutes()`:

```typescript
  // PUT /api/admin/users/:userId/plan — override user's plan (instance admin)
  router.put("/admin/users/:userId/plan", async (req, res) => {
    assertBoard(req);
    if (!req.actor.isInstanceAdmin) {
      res.status(403).json({ error: "Instance admin required" });
      return;
    }

    const { userId } = req.params;
    const { planSlug } = req.body as { planSlug: string };

    if (!planSlug) {
      res.status(400).json({ error: "planSlug is required" });
      return;
    }

    const plan = await billing.getPlanBySlug(planSlug);
    if (!plan) {
      res.status(404).json({ error: `Plan '${planSlug}' not found` });
      return;
    }

    // Ensure subscription exists (lazy provision)
    await billing.getSubscription(userId);

    const updated = await billing.updateSubscription(userId, {
      planId: plan.id,
      status: "active",
    });

    if (!updated) {
      res.status(404).json({ error: "User subscription not found" });
      return;
    }

    res.json({ ...updated, plan });
  });
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/gem/Workspaces/AIOTWorkspace/AgentLand/AgentsInc-Core && pnpm -r typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/billing.ts
git commit -m "feat: add admin endpoint to override user plan assignment"
```

---

## Phase 5 Review Gate

**`code-reviewer`:** Review admin endpoints for proper authorization, input validation.
**`security`:** Verify all admin endpoints check `isInstanceAdmin`. Verify no privilege escalation paths. Check that plan slug is validated.
**`qa`:** Run full verification: `pnpm -r typecheck && pnpm test:run && pnpm build`. Test admin endpoints with admin and non-admin actors.

---

## Final Verification (Owner: `qa`)

- [ ] Full typecheck: `pnpm -r typecheck`
- [ ] Full test suite: `pnpm test:run`
- [ ] Full build: `pnpm build`
- [ ] Manual test: start dev server, create company, verify plan limit, check billing page
- [ ] Verify all API endpoints return expected responses
- [ ] Verify Stripe webhook signature validation works (use Stripe CLI for local testing)
- [ ] Verify token usage queries return accurate data
- [ ] Verify heartbeat throttle logic triggers correctly
