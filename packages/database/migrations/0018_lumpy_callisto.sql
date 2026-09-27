CREATE TABLE IF NOT EXISTS "people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_employee_id" text NOT NULL,
	"work_email" text NOT NULL,
	"display_name" text NOT NULL,
	"job_title" text,
	"primary_role" text NOT NULL,
	"pulse_participant" boolean NOT NULL,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_customer_employee_id_not_blank" CHECK (length(btrim("people"."customer_employee_id")) > 0),
	CONSTRAINT "people_work_email_normalized" CHECK ("people"."work_email" = lower(btrim("people"."work_email")) AND "people"."work_email" <> ''),
	CONSTRAINT "people_display_name_not_blank" CHECK (length(btrim("people"."display_name")) > 0),
	CONSTRAINT "people_role_pulse_mapping" CHECK (("people"."primary_role" IN ('employee', 'team_lead') AND "people"."pulse_participant" = true) OR ("people"."primary_role" IN ('manager', 'hr', 'hrbp', 'leadership') AND "people"."pulse_participant" = false)),
	CONSTRAINT "people_lifecycle_status_valid" CHECK ("people"."lifecycle_status" IN ('draft', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_id_tenant_id_unique_idx" ON "users" USING btree ("id","tenant_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people" ADD CONSTRAINT "people_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_tenant_customer_employee_id_idx" ON "people" USING btree ("tenant_id","customer_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_tenant_work_email_idx" ON "people" USING btree ("tenant_id","work_email");
