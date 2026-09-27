CREATE TABLE IF NOT EXISTS "org_onboarding_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"external_workspace_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"external_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_onboarding_deliveries_status_valid" CHECK ("org_onboarding_deliveries"."status" IN ('pending', 'sending', 'delivered', 'failed')),
	CONSTRAINT "org_onboarding_deliveries_workspace_not_blank" CHECK (length(btrim("org_onboarding_deliveries"."external_workspace_id")) > 0),
	CONSTRAINT "org_onboarding_deliveries_attempt_nonnegative" CHECK ("org_onboarding_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_onboarding_deliveries" ADD CONSTRAINT "org_onboarding_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_onboarding_deliveries" ADD CONSTRAINT "org_onboarding_deliveries_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_onboarding_deliveries" ADD CONSTRAINT "org_onboarding_deliveries_unit_id_tenant_id_org_units_id_tenant_id_fk" FOREIGN KEY ("unit_id","tenant_id") REFERENCES "public"."org_units"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_onboarding_deliveries_tenant_person_idx" ON "org_onboarding_deliveries" USING btree ("tenant_id","person_id");