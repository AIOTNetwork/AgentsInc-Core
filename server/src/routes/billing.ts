import { Router } from "express";
import Stripe from "stripe";
import { sql, and, eq, inArray, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { plans, companyMemberships, costEvents } from "@paperclipai/db";
import { billingService } from "../services/billing.js";
import { assertBoard, assertInstanceAdmin } from "./authz.js";

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
    // Return only safe fields — never expose Stripe internal IDs to the client
    res.json({
      id: sub.id,
      userId: sub.userId,
      planId: sub.planId,
      status: sub.status,
      plan: sub.plan,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      createdAt: sub.createdAt,
    });
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

  // POST /api/billing/webhook — Stripe webhook
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
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: "Missing raw body" });
        return;
      }
      event = stripe.webhooks.constructEvent(rawBody.toString("utf-8"), sig, webhookSecret);
    } catch {
      res.status(400).json({ error: "Invalid webhook signature" });
      return;
    }

    const { stripeWebhookService } = await import("../services/stripe-webhooks.js");
    const handler = stripeWebhookService(db);

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
  router.get("/billing/usage/history", async (req, res, next) => {
    try {
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

    // Safe: values are from hardcoded map, never from user input
    const truncMap: Record<string, string> = { hourly: "hour", daily: "day", weekly: "week" };
    const truncVal = truncMap[granularity];
    if (!truncVal) {
      res.status(400).json({ error: "Invalid granularity" });
      return;
    }

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

    // Use sql.raw for the date_trunc interval — safe because truncVal comes from hardcoded map
    const dtExpr = sql.raw(`date_trunc('${truncVal}', "occurred_at")`);

    const buckets = await db
      .select({
        timestamp: sql<string>`${dtExpr}::text`,
        inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::bigint`,
        outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::bigint`,
        totalTokens: sql<number>`coalesce(sum(${costEvents.inputTokens} + ${costEvents.outputTokens}), 0)::bigint`,
      })
      .from(costEvents)
      .where(
        and(
          inArray(costEvents.companyId, companyIds),
          gte(costEvents.occurredAt, from),
          sql`${costEvents.occurredAt} < ${to.toISOString()}`,
        ),
      )
      .groupBy(sql`${dtExpr}`)
      .orderBy(sql`${dtExpr}`);

    res.json({
      buckets: buckets.map((b) => ({
        timestamp: b.timestamp,
        inputTokens: Number(b.inputTokens),
        outputTokens: Number(b.outputTokens),
        totalTokens: Number(b.totalTokens),
      })),
      granularity,
    });
    } catch (err) { next(err); }
  });

  // POST /api/admin/plans — create a plan (instance admin only)
  router.post("/admin/plans", async (req, res) => {
    assertInstanceAdmin(req);

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
    assertInstanceAdmin(req);

    const planId = req.params.planId;
    const body = req.body as Record<string, unknown>;

    // Allowlist: only accept known plan fields to prevent mass assignment
    const allowedFields = [
      "slug", "name", "maxCompanies", "hourlyTokenLimit", "weeklyTokenLimit",
      "priceMonthCents", "priceYearCents", "stripePriceIdMonthly", "stripePriceIdYearly",
      "sortOrder", "isPublic",
    ] as const;
    const update: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) update[key] = body[key];
    }

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

  // PUT /api/admin/users/:userId/plan — override user's plan (instance admin)
  router.put("/admin/users/:userId/plan", async (req, res) => {
    assertInstanceAdmin(req);

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

  return router;
}
