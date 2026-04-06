import Stripe from "stripe";
import type { Db } from "@paperclipai/db";
import { plans } from "@paperclipai/db";
import { billingService } from "./billing.js";
import { getFreePlan } from "./plan-seed.js";

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return new Stripe(key);
}

export function stripeWebhookService(db: Db) {
  const billing = billingService(db);

  return {
    handleCheckoutCompleted: async (session: Stripe.Checkout.Session) => {
      const userId = session.metadata?.userId;
      if (!userId) return;

      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;

      const customerId = typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;

      // Cross-check: verify userId matches the Stripe customer metadata
      if (customerId) {
        const stripe = getStripe();
        const customer = await stripe.customers.retrieve(customerId);
        if (customer.deleted) return;
        if (customer.metadata?.userId && customer.metadata.userId !== userId) return;
      }

      // Resolve plan from the actual Stripe subscription price,
      // not from checkout metadata (which could be stale or tampered pre-signature)
      let verifiedPlanId: string | undefined;
      if (subscriptionId) {
        const stripe = getStripe();
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id;
        if (priceId) {
          const allPlans = await db.select().from(plans);
          const matchedPlan = allPlans.find(
            (p) => p.stripePriceIdMonthly === priceId || p.stripePriceIdYearly === priceId,
          );
          if (matchedPlan) {
            verifiedPlanId = matchedPlan.id;
          }
        }
      }

      if (!verifiedPlanId) return;

      await billing.updateSubscription(userId, {
        planId: verifiedPlanId,
        status: "active",
        stripeSubscriptionId: subscriptionId ?? undefined,
        stripeCustomerId: customerId ?? undefined,
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
        currentPeriodStart: subscription.items.data[0]
          ? new Date(subscription.items.data[0].current_period_start * 1000)
          : undefined,
        currentPeriodEnd: subscription.items.data[0]
          ? new Date(subscription.items.data[0].current_period_end * 1000)
          : undefined,
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
