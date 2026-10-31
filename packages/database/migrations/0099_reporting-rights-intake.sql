CREATE TABLE IF NOT EXISTS "survey_reporting_rights_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"action_ts" text NOT NULL,
	"request_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"lineage_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"received_at" timestamp with time zone DEFAULT date_trunc('milliseconds', clock_timestamp()) NOT NULL,
	"status" text DEFAULT 'admitted' NOT NULL,
	"failure_reason" text,
	"permission_revision" integer,
	"apply_attempts" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"confirmation_message_id" uuid,
	CONSTRAINT "reporting_rights_admission_menu" UNIQUE("menu_id"),
	CONSTRAINT "reporting_rights_admission_action" UNIQUE("channel_type","external_workspace_id","external_user_id","action_ts"),
	CONSTRAINT "reporting_rights_admission_request" UNIQUE("tenant_id","request_id"),
	CONSTRAINT "reporting_rights_admission_request_derived" CHECK ("survey_reporting_rights_admissions"."request_id" = 'reporting-rights:' || "survey_reporting_rights_admissions"."id"::text),
	CONSTRAINT "reporting_rights_admission_target" CHECK (("survey_reporting_rights_admissions"."target_kind" = 'full_reporting' AND cardinality("survey_reporting_rights_admissions"."lineage_ids") = 0) OR ("survey_reporting_rights_admissions"."target_kind" = 'partial_reporting' AND cardinality("survey_reporting_rights_admissions"."lineage_ids") > 0)),
	CONSTRAINT "reporting_rights_admission_status" CHECK (("survey_reporting_rights_admissions"."status" = 'admitted' AND "survey_reporting_rights_admissions"."settled_at" IS NULL AND "survey_reporting_rights_admissions"."failure_reason" IS NULL AND "survey_reporting_rights_admissions"."permission_revision" IS NULL)
    OR ("survey_reporting_rights_admissions"."status" = 'applied' AND "survey_reporting_rights_admissions"."settled_at" IS NOT NULL AND "survey_reporting_rights_admissions"."failure_reason" IS NULL AND "survey_reporting_rights_admissions"."permission_revision" IS NOT NULL)
    OR ("survey_reporting_rights_admissions"."status" IN ('rejected', 'failed') AND "survey_reporting_rights_admissions"."settled_at" IS NOT NULL AND "survey_reporting_rights_admissions"."failure_reason" IN ('stale_target', 'subject_mismatch', 'idempotency_conflict', 'apply_attempts_exhausted') AND "survey_reporting_rights_admissions"."permission_revision" IS NULL)),
	CONSTRAINT "reporting_rights_admission_attempts" CHECK ("survey_reporting_rights_admissions"."apply_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_reporting_rights_menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"external_channel_id" text NOT NULL,
	"locale" text NOT NULL,
	"kind" text NOT NULL,
	"parent_menu_id" uuid,
	"target_kind" text,
	"lineage_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "reporting_rights_menu_subject_id" UNIQUE("tenant_id","user_id","id"),
	CONSTRAINT "reporting_rights_menu_shape" CHECK (("survey_reporting_rights_menus"."kind" = 'root' AND "survey_reporting_rights_menus"."parent_menu_id" IS NULL AND "survey_reporting_rights_menus"."target_kind" IS NULL)
    OR ("survey_reporting_rights_menus"."kind" = 'confirm' AND "survey_reporting_rights_menus"."parent_menu_id" IS NOT NULL AND (("survey_reporting_rights_menus"."target_kind" = 'full_reporting' AND cardinality("survey_reporting_rights_menus"."lineage_ids") = 0) OR ("survey_reporting_rights_menus"."target_kind" = 'partial_reporting' AND cardinality("survey_reporting_rights_menus"."lineage_ids") > 0)))),
	CONSTRAINT "reporting_rights_menu_expiry" CHECK ("survey_reporting_rights_menus"."expires_at" > "survey_reporting_rights_menus"."created_at")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_rights_admissions" ADD CONSTRAINT "survey_reporting_rights_admissions_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_rights_admissions" ADD CONSTRAINT "reporting_rights_admission_menu_fk" FOREIGN KEY ("tenant_id","user_id","menu_id") REFERENCES "public"."survey_reporting_rights_menus"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_rights_menus" ADD CONSTRAINT "survey_reporting_rights_menus_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_rights_menus" ADD CONSTRAINT "survey_reporting_rights_menus_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_reporting_rights_menus" ADD CONSTRAINT "reporting_rights_menu_parent_fk" FOREIGN KEY ("tenant_id","user_id","parent_menu_id") REFERENCES "public"."survey_reporting_rights_menus"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reporting_rights_admission_repair" ON "survey_reporting_rights_admissions" USING btree ("status","received_at");