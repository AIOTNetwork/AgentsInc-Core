# User Plans, Stripe Billing & Token Usage Metering

**Date:** 2026-04-06
**Status:** Draft
**Scope:** AgentsInc-Core (server + DB) + AgentsInc-Office (UI)

---

## Problem

Company creation is hardcoded to 3 per user (`MAX_COMPANIES_PER_USER = 3` in `server/src/routes/companies.ts:264`). There is no plan system, no billing, and no token usage limits. Users cannot self-service upgrade, and there is no visibility into token consumption.

## Solution

A plan-based subscription system with Stripe billing, rolling-window token rate limits, and full usage visibility in the Office UI.

---

## 1. Plan Definitions

### Schema: `plans` table

```sql
CREATE TABLE plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  max_companies   INTEGER,          -- NULL = unlimited
  hourly_token_limit  BIGINT,       -- NULL = unlimited
  weekly_token_limit  BIGINT,       -- NULL = unlimited
  price_month_cents   INTEGER NOT NULL DEFAULT 0,
  price_year_cents    INTEGER,       -- NULL = no annual option
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly  TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_public       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Seed Data

| slug | name | max_companies | hourly_token_limit | weekly_token_limit | price_month_cents | is_public |
|------|------|---------------|--------------------|--------------------|-------------------|-----------|
| `free` | Free | 1 | 50,000 | 500,000 | 0 | true |
| `pro` | Pro | 3 | 500,000 | 5,000,000 | 2000 | true |
| `pro_max` | Pro Max | 10 | 2,000,000 | 20,000,000 | 10000 | true |
| `pro_max_5x` | Pro Max 5X | 50 | 5,000,000 | 50,000,000 | 20000 | true |
| `enterprise` | Enterprise | NULL | NULL | NULL | 0 | false |

Admins can create/edit plans via API. Stripe Price IDs are set after creating products in Stripe Dashboard.

---

## 2. User Subscriptions

### Schema: `user_subscriptions` table

```sql
CREATE TABLE user_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plan_id                 UUID NOT NULL REFERENCES plans(id),
  status                  TEXT NOT NULL DEFAULT 'active',
    -- active | trialing | past_due | canceled | paused
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT false,
  trial_ends_at           TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
```

### Behavior

- **New user signup:** Automatically insert a `user_subscriptions` row with `plan_id` pointing to the `free` plan. No Stripe customer created yet. Hook point: in the auth session creation flow (better-auth `afterSignUp` or equivalent), or lazily on first API request if no subscription row exists.
- **Upgrade:** Server creates a Stripe Checkout Session with the target plan's `stripe_price_id_monthly` (or yearly). On `checkout.session.completed` webhook, update the subscription row.
- **Downgrade:** Set `cancel_at_period_end = true`. At period end (`customer.subscription.updated` webhook), switch `plan_id` to the lower plan.
- **Enterprise:** Admin assigns via `PUT /api/admin/users/:userId/plan`. `stripe_subscription_id` can be null.
- **Cancellation:** Revert to `free` plan on `customer.subscription.deleted`.

### Company Limit Enforcement

Replace in `server/src/routes/companies.ts`:

```typescript
// BEFORE
const MAX_COMPANIES_PER_USER = 3;
// ...
if (owned.length >= MAX_COMPANIES_PER_USER) {
  throw forbidden(`You can create up to ${MAX_COMPANIES_PER_USER} companies`);
}

// AFTER
const subscription = await billing.getSubscription(userId);
const plan = await billing.getPlan(subscription.planId);
if (plan.maxCompanies !== null && owned.length >= plan.maxCompanies) {
  throw forbidden(`Your ${plan.name} plan allows up to ${plan.maxCompanies} companies. Upgrade to create more.`);
}
```

---

## 3. Token Usage Metering & Rate Limiting

### Data Source

No new table. Query rolling windows from existing `cost_events` which already tracks `input_tokens`, `output_tokens`, `company_id`, `occurred_at` per agent execution.

### Aggregation

Usage is **per-user** — summed across all companies the user owns.

```sql
-- Hourly usage for a user
SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
FROM cost_events
WHERE company_id = ANY($userCompanyIds)
  AND occurred_at > now() - INTERVAL '1 hour';

-- Weekly usage for a user
SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
FROM cost_events
WHERE company_id = ANY($userCompanyIds)
  AND occurred_at > now() - INTERVAL '7 days';
```

### Caching

In-memory cache with ~30s TTL per user to avoid DB load on every heartbeat check.

### Throttle Behavior

| Usage % of limit | Effect |
|------------------|--------|
| < 80% | Normal operation |
| 80–100% | Warning banner in Office UI. Agents continue normally. |
| 100–120% | Agents throttled — heartbeat interval doubled. Warning persists. |
| > 120% | Agents paused until window resets. Hard notification. Activity log entry: `budget_token_limit`. |

### Enforcement Point

In `server/src/services/heartbeat.ts`, before `adapter.execute()`:

1. Resolve the user who owns the company being executed
2. Load their subscription + plan
3. Query cached token usage for hourly and weekly windows
4. If either window exceeds 120%: skip execution, log activity
5. If either window exceeds 100%: increase heartbeat sleep interval (2x)
6. Otherwise: proceed normally

---

## 4. Stripe Integration

### Dependencies

- `stripe` npm package added to `server/`

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server-side Stripe API calls |
| `STRIPE_WEBHOOK_SECRET` | Verify webhook signatures |
| `STRIPE_PUBLISHABLE_KEY` | Passed to Office UI for Checkout redirect |

### New Files

| File | Purpose |
|------|---------|
| `server/src/routes/billing.ts` | HTTP routes for billing endpoints |
| `server/src/services/billing.ts` | Stripe SDK calls, subscription CRUD, usage queries |
| `server/src/services/stripe-webhooks.ts` | Webhook event handlers |

### Stripe Checkout Flow

1. User clicks "Upgrade to Pro" in Office UI
2. `POST /api/billing/checkout` with `{ planSlug: "pro", interval: "month" }`
3. Server creates Stripe Checkout Session:
   - If user has no `stripe_customer_id`, create one first
   - Set `success_url` and `cancel_url` back to Office `/settings/billing`
   - Attach `metadata: { userId, planId }`
4. Return `{ checkoutUrl }` to UI
5. UI redirects to Stripe Checkout
6. On success, Stripe sends `checkout.session.completed` webhook
7. Server updates `user_subscriptions` row

### Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create/update subscription, set plan |
| `customer.subscription.updated` | Sync status, period dates, plan changes |
| `customer.subscription.deleted` | Set status `canceled`, revert to free plan |
| `invoice.payment_failed` | Set status `past_due`, notify user |

---

## 5. API Surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/plans` | Public | List public plans with limits & pricing |
| `GET` | `/api/billing/subscription` | Board | Current user's subscription + usage summary |
| `POST` | `/api/billing/checkout` | Board | Create Stripe Checkout session |
| `POST` | `/api/billing/portal` | Board | Create Stripe Customer Portal session |
| `POST` | `/api/billing/webhook` | Stripe signature | Handle Stripe events |
| `GET` | `/api/billing/usage` | Board | Current hourly/weekly token usage vs. limits |
| `GET` | `/api/billing/usage/history` | Board | Token usage over time. Query params: `granularity` (hourly/daily/weekly), `from`/`to` ISO timestamps. |
| `PUT` | `/api/admin/users/:userId/plan` | Instance admin | Override a user's plan |
| `POST` | `/api/admin/plans` | Instance admin | Create plan |
| `PUT` | `/api/admin/plans/:planId` | Instance admin | Edit plan |

---

## 6. Office UI (AgentsInc-Office)

### 6.1 Plan & Billing Page (`/settings/billing`)

- **Current plan card:** Tier name, company limit (used/max), token limits
- **Usage meters:** Two gauges — hourly and weekly token usage. Color-coded: green < 80%, amber 80–100%, red > 100%
- **Plan comparison grid:** All public plans side-by-side with limits and pricing
- **Upgrade/downgrade buttons:** Redirect to Stripe Checkout or open Stripe Portal
- **Invoice history:** Link to Stripe Customer Portal
- **Enterprise:** "Contact Sales" button instead of checkout

### 6.2 Usage Dashboard (`/settings/usage`)

- **Token consumption chart:** Time-series (hourly/daily/weekly granularity toggle)
- **Breakdown tables:** By company, by agent, by model
- **Rolling window indicators:** Current hourly and weekly usage as progress bars against plan limits
- **Throttle/pause status:** If limits are hit, banner with countdown to window reset

### 6.3 Global Warning Banner

Appears across all Office pages when usage exceeds 80% of either window:

> "You've used 92% of your hourly token limit. Agents may slow down." [Upgrade Plan]

- Dismissable per session, reappears if usage keeps climbing
- Escalates to red/non-dismissable at > 100%

### 6.4 Company Creation Gate

When user hits max companies for their plan:

- "New Company" button disabled
- Inline message: "Your Pro plan allows up to 3 companies. Upgrade to Pro Max for 10." [Upgrade]

---

## 7. Migration & Rollout

### Phase 1: Schema + Seed
1. Add `plans` table with Drizzle schema + migration
2. Add `user_subscriptions` table with Drizzle schema + migration
3. Seed the 5 plan tiers
4. Backfill: create `free` plan subscriptions for all existing users

### Phase 2: Plan Enforcement
5. Replace hardcoded `MAX_COMPANIES_PER_USER` with plan-based lookup
6. Add billing service + routes (Stripe integration)
7. Add webhook handler

### Phase 3: Token Metering
8. Add usage aggregation service with rolling-window queries
9. Add throttle logic in heartbeat execution path
10. Add usage API endpoints

### Phase 4: Office UI
11. Plan & Billing settings page
12. Usage dashboard with charts
13. Global warning banner component
14. Company creation gate update

### Phase 5: Admin
15. Admin plan management endpoints
16. Admin user plan override endpoint

---

## 8. Files Changed / Created

### AgentsInc-Core — New Files
- `packages/db/src/schema/plans.ts`
- `packages/db/src/schema/user_subscriptions.ts`
- `server/src/routes/billing.ts`
- `server/src/services/billing.ts`
- `server/src/services/stripe-webhooks.ts`
- `server/src/services/token-usage.ts`

### AgentsInc-Core — Modified Files
- `packages/db/src/schema/index.ts` — export new tables
- `server/src/routes/companies.ts` — replace hardcoded limit with plan lookup
- `server/src/routes/index.ts` — mount billing routes
- `server/src/services/heartbeat.ts` — add token usage check before execution
- `packages/shared/src/types/` — add plan + subscription + usage types
- `package.json` — add `stripe` dependency

### AgentsInc-Office — New Files
- `src/pages/settings/BillingPage.tsx`
- `src/pages/settings/UsagePage.tsx`
- `src/components/UsageMeter.tsx`
- `src/components/UsageWarningBanner.tsx`
- `src/api/billing.ts`

### AgentsInc-Office — Modified Files
- `src/App.tsx` or router config — add billing/usage routes
- Company creation UI — add plan gate
