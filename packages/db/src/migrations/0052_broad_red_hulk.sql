CREATE TABLE "project_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"target_name" text NOT NULL,
	"type" text NOT NULL,
	"provider" text DEFAULT 'vercel' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"vercel_project_id" text,
	"vercel_deployment_id" text,
	"url" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"last_ceo_run_id" text,
	"requested_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "deployment_max_deployable_projects" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "deployment_max_deployments_per_repo" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "deployment_max_deployable_projects_cap" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "deployment_max_deployments_per_repo_cap" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_deployments" ADD CONSTRAINT "project_deployments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deployments" ADD CONSTRAINT "project_deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_deployments_project_target_idx" ON "project_deployments" USING btree ("project_id","target_name");--> statement-breakpoint
CREATE INDEX "project_deployments_company_status_idx" ON "project_deployments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "project_deployments_project_status_idx" ON "project_deployments" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "project_deployments_status_updated_idx" ON "project_deployments" USING btree ("status","updated_at");