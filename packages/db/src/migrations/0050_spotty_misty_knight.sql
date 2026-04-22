CREATE TABLE "pre_register_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pre_register_user_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"idea" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_register_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"wallet_address" text,
	"provider" text,
	"chain_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pre_register_agents" ADD CONSTRAINT "pre_register_agents_pre_register_user_id_pre_register_users_id_fk" FOREIGN KEY ("pre_register_user_id") REFERENCES "public"."pre_register_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_register_agents_user_unique_idx" ON "pre_register_agents" USING btree ("pre_register_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_register_users_email_unique_idx" ON "pre_register_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_register_users_wallet_address_unique_idx" ON "pre_register_users" USING btree ("wallet_address");--> statement-breakpoint
ALTER TABLE "pre_register_users" ADD CONSTRAINT "pre_register_users_email_or_wallet_check" CHECK ("email" IS NOT NULL OR "wallet_address" IS NOT NULL);