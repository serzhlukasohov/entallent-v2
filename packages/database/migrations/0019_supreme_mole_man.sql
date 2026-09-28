CREATE TABLE IF NOT EXISTS "org_advisor_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"advisor_person_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_advisor_assignments_lifecycle_status_valid" CHECK ("org_advisor_assignments"."lifecycle_status" IN ('draft', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_employee_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_person_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"team_id" uuid,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_employee_placements_lifecycle_status_valid" CHECK ("org_employee_placements"."lifecycle_status" IN ('draft', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_hrbp_scopes" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_mode" text NOT NULL,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "org_hrbp_scopes_mode_valid" CHECK ("org_hrbp_scopes"."scope_mode" IN ('all_units', 'selected_units')),
	CONSTRAINT "org_hrbp_scopes_lifecycle_status_valid" CHECK ("org_hrbp_scopes"."lifecycle_status" IN ('draft', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_person_capabilities" (
	"person_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "org_person_capabilities_person_id_capability_pk" PRIMARY KEY("person_id","capability"),
	CONSTRAINT "org_person_capabilities_name_valid" CHECK ("org_person_capabilities"."capability" = 'company_admin'),
	CONSTRAINT "org_person_capabilities_lifecycle_status_valid" CHECK ("org_person_capabilities"."lifecycle_status" IN ('draft', 'active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_team_key" text NOT NULL,
	"name" text NOT NULL,
	"team_lead_person_id" uuid,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_teams_customer_key_not_blank" CHECK (length(btrim("org_teams"."customer_team_key")) > 0),
	CONSTRAINT "org_teams_name_not_blank" CHECK (length(btrim("org_teams"."name")) > 0),
	CONSTRAINT "org_teams_lifecycle_status_valid" CHECK ("org_teams"."lifecycle_status" IN ('draft', 'active', 'inactive')),
	CONSTRAINT "org_teams_active_has_lead" CHECK ("org_teams"."lifecycle_status" <> 'active' OR "org_teams"."team_lead_person_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_unit_key" text NOT NULL,
	"name" text NOT NULL,
	"manager_person_id" uuid,
	"lifecycle_status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_customer_key_not_blank" CHECK (length(btrim("org_units"."customer_unit_key")) > 0),
	CONSTRAINT "org_units_name_not_blank" CHECK (length(btrim("org_units"."name")) > 0),
	CONSTRAINT "org_units_lifecycle_status_valid" CHECK ("org_units"."lifecycle_status" IN ('draft', 'active', 'inactive')),
	CONSTRAINT "org_units_active_has_manager" CHECK ("org_units"."lifecycle_status" <> 'active' OR "org_units"."manager_person_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_id_tenant_id_unique_idx" ON "people" USING btree ("id","tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_units_id_tenant_id_unique_idx" ON "org_units" USING btree ("id","tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_teams_id_unit_tenant_unique_idx" ON "org_teams" USING btree ("id","unit_id","tenant_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_advisor_assignments" ADD CONSTRAINT "org_advisor_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_advisor_assignments" ADD CONSTRAINT "org_advisor_assignments_advisor_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("advisor_person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_advisor_assignments" ADD CONSTRAINT "org_advisor_assignments_unit_id_tenant_id_org_units_id_tenant_id_fk" FOREIGN KEY ("unit_id","tenant_id") REFERENCES "public"."org_units"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_employee_placements" ADD CONSTRAINT "org_employee_placements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_employee_placements" ADD CONSTRAINT "org_employee_placements_employee_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("employee_person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_employee_placements" ADD CONSTRAINT "org_employee_placements_unit_id_tenant_id_org_units_id_tenant_id_fk" FOREIGN KEY ("unit_id","tenant_id") REFERENCES "public"."org_units"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_employee_placements" ADD CONSTRAINT "org_employee_placements_team_id_unit_id_tenant_id_org_teams_id_unit_id_tenant_id_fk" FOREIGN KEY ("team_id","unit_id","tenant_id") REFERENCES "public"."org_teams"("id","unit_id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_hrbp_scopes" ADD CONSTRAINT "org_hrbp_scopes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_hrbp_scopes" ADD CONSTRAINT "org_hrbp_scopes_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_person_capabilities" ADD CONSTRAINT "org_person_capabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_person_capabilities" ADD CONSTRAINT "org_person_capabilities_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_teams" ADD CONSTRAINT "org_teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_teams" ADD CONSTRAINT "org_teams_unit_id_tenant_id_org_units_id_tenant_id_fk" FOREIGN KEY ("unit_id","tenant_id") REFERENCES "public"."org_units"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_teams" ADD CONSTRAINT "org_teams_team_lead_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("team_lead_person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_units" ADD CONSTRAINT "org_units_manager_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("manager_person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_advisor_assignments_active_pair_idx" ON "org_advisor_assignments" USING btree ("advisor_person_id","unit_id") WHERE "org_advisor_assignments"."lifecycle_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_employee_placements_active_person_idx" ON "org_employee_placements" USING btree ("employee_person_id") WHERE "org_employee_placements"."lifecycle_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_teams_tenant_customer_key_idx" ON "org_teams" USING btree ("tenant_id","customer_team_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_teams_active_lead_idx" ON "org_teams" USING btree ("team_lead_person_id") WHERE "org_teams"."lifecycle_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_units_tenant_customer_key_idx" ON "org_units" USING btree ("tenant_id","customer_unit_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_units_active_manager_idx" ON "org_units" USING btree ("manager_person_id") WHERE "org_units"."lifecycle_status" = 'active';
