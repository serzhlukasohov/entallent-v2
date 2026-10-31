CREATE TABLE IF NOT EXISTS "survey_report_input_coverage" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"supported_from" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD COLUMN "summary_support" text DEFAULT 'unverified_historical' NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_report_inbound_work" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_report_shown_components" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_input_coverage" ADD CONSTRAINT "survey_report_input_coverage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
INSERT INTO survey_report_input_coverage(tenant_id,supported_from) SELECT id,clock_timestamp() FROM tenants;
--> statement-breakpoint
CREATE FUNCTION pulse_input_coverage_birth() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO survey_report_input_coverage(tenant_id)VALUES(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER pulse_input_coverage_birth AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION pulse_input_coverage_birth();
--> statement-breakpoint
ALTER TABLE survey_question_insights ADD CONSTRAINT report_summary_support_check CHECK(summary_support IN ('unverified_historical','deidentified_employee_statement','generalized_signal'));
