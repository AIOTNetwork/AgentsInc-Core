DROP INDEX "pre_register_agents_user_unique_idx";--> statement-breakpoint
ALTER TABLE "pre_register_agents" ALTER COLUMN "pre_register_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_register_agents" ADD COLUMN "token_id" text;--> statement-breakpoint
ALTER TABLE "pre_register_agents" ADD COLUMN "mint_tx_hash" text;--> statement-breakpoint
ALTER TABLE "pre_register_agents" ADD COLUMN "wallet_address" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pre_register_agents_agent_id_unique_idx" ON "pre_register_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pre_register_agents_token_id_unique_idx" ON "pre_register_agents" USING btree ("token_id") WHERE "pre_register_agents"."token_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pre_register_agents_wallet_address_idx" ON "pre_register_agents" USING btree ("wallet_address") WHERE "pre_register_agents"."wallet_address" IS NOT NULL;