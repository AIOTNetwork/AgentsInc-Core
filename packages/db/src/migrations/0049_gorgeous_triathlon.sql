CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"installation_id" integer NOT NULL,
	"github_account_login" text NOT NULL,
	"github_account_type" text DEFAULT 'User' NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"max_companies" integer,
	"hourly_token_limit" bigint,
	"weekly_token_limit" bigint,
	"price_month_cents" integer DEFAULT 0 NOT NULL,
	"price_year_cents" integer,
	"stripe_price_id_monthly" text,
	"stripe_price_id_yearly" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installations_company_idx" ON "github_installations" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "github_installations_installation_idx" ON "github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_slug_unique_idx" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "user_subscriptions_user_id_unique_idx" ON "user_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_subscriptions_plan_id_idx" ON "user_subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "user_subscriptions_stripe_customer_idx" ON "user_subscriptions" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "user_subscriptions_status_idx" ON "user_subscriptions" USING btree ("status");