CREATE TABLE IF NOT EXISTS "onboarding_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"track" text NOT NULL,
	"intro_status" text DEFAULT 'pending' NOT NULL,
	"participation" text NOT NULL,
	"management_ack_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"reminder_status" text DEFAULT 'none' NOT NULL,
	"reminder_origin_at" timestamp with time zone,
	"reminder_due_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"intro_channel_id" text,
	"intro_actions_message_ts" text,
	"buttons_active" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_states_track_valid" CHECK ("onboarding_states"."track" IN ('employee', 'team_lead', 'management')),
	CONSTRAINT "onboarding_states_intro_valid" CHECK ("onboarding_states"."intro_status" IN ('pending', 'delivered', 'completed')),
	CONSTRAINT "onboarding_states_participation_valid" CHECK ("onboarding_states"."participation" IN ('undecided', 'deferred', 'active', 'declined', 'not_applicable')),
	CONSTRAINT "onboarding_states_management_not_applicable" CHECK (("onboarding_states"."track" = 'management') = ("onboarding_states"."participation" = 'not_applicable')),
	CONSTRAINT "onboarding_states_reminder_valid" CHECK ("onboarding_states"."reminder_status" IN ('none', 'scheduled', 'sent', 'cancelled')),
	CONSTRAINT "onboarding_states_scheduled_has_due" CHECK ("onboarding_states"."reminder_status" <> 'scheduled' OR "onboarding_states"."reminder_due_at" IS NOT NULL),
	CONSTRAINT "onboarding_states_management_no_reminder" CHECK ("onboarding_states"."track" <> 'management' OR "onboarding_states"."reminder_status" IN ('none', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_work_calendars" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"working_days" smallint[] NOT NULL,
	"work_start" text NOT NULL,
	"work_end" text NOT NULL,
	"onboarding_language" text DEFAULT 'en' NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_work_calendars_hours_valid" CHECK ("tenant_work_calendars"."work_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "tenant_work_calendars"."work_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "tenant_work_calendars"."work_start" < "tenant_work_calendars"."work_end"),
	CONSTRAINT "tenant_work_calendars_days_valid" CHECK (cardinality("tenant_work_calendars"."working_days") > 0 AND "tenant_work_calendars"."working_days" <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
	CONSTRAINT "tenant_work_calendars_language_valid" CHECK ("tenant_work_calendars"."onboarding_language" = 'en')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "onboarding_states" ADD CONSTRAINT "onboarding_states_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_work_calendars" ADD CONSTRAINT "tenant_work_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_states_tenant_person_idx" ON "onboarding_states" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_states_due_reminder_idx" ON "onboarding_states" USING btree ("reminder_status","reminder_due_at");