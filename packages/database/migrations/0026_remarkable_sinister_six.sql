CREATE TABLE IF NOT EXISTS "survey_question_confirmation_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"question_group" text NOT NULL,
	"version" text NOT NULL,
	"displayed_text" text,
	"components" jsonb,
	"prompt_message_id" uuid,
	"status" text DEFAULT 'pending_delivery' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone,
	CONSTRAINT "survey_question_confirmation_bundles_version_key" UNIQUE("tenant_id","user_id","survey_window_id","question_group","version"),
	CONSTRAINT "survey_question_confirmation_bundles_purged_content_check" CHECK ("survey_question_confirmation_bundles"."purged_at" IS NULL OR ("survey_question_confirmation_bundles"."displayed_text" IS NULL AND "survey_question_confirmation_bundles"."components" IS NULL)),
	CONSTRAINT "survey_question_confirmation_bundles_status_check" CHECK ("survey_question_confirmation_bundles"."status" IN ('pending_delivery', 'awaiting_confirmation', 'resolved', 'rejected', 'purged'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_question_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"question_group" text NOT NULL,
	"deidentified_summary" text NOT NULL,
	"score" numeric NOT NULL,
	"signal_direction" text NOT NULL,
	"signal_severity" text NOT NULL,
	"root_cause_category" text NOT NULL,
	"scoring_policy_version" text NOT NULL,
	"question_rubric_version" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"confidence" numeric NOT NULL,
	"privacy_policy_version" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"scored_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "survey_question_insights_scope_key" UNIQUE("tenant_id","user_id","survey_window_id","survey_definition_id","survey_question_id","question_version"),
	CONSTRAINT "survey_question_insights_score_range" CHECK ("survey_question_insights"."score" >= 0 AND "survey_question_insights"."score" <= 100),
	CONSTRAINT "survey_question_insights_direction_check" CHECK ("survey_question_insights"."signal_direction" IN ('adverse', 'mixed', 'favorable')),
	CONSTRAINT "survey_question_insights_severity_check" CHECK ("survey_question_insights"."signal_severity" IN ('low', 'moderate', 'high')),
	CONSTRAINT "survey_question_insights_category_check" CHECK ("survey_question_insights"."root_cause_category" IN ('workload', 'clarity', 'autonomy', 'growth', 'purpose', 'belonging', 'support', 'other')),
	CONSTRAINT "survey_question_insights_confidence_range" CHECK ("survey_question_insights"."confidence" >= 0 AND "survey_question_insights"."confidence" <= 1),
	CONSTRAINT "survey_question_insights_summary_not_blank" CHECK (btrim("survey_question_insights"."deidentified_summary") <> ''),
	CONSTRAINT "survey_question_insights_versions_not_blank" CHECK (btrim("survey_question_insights"."question_version") <> '' AND btrim("survey_question_insights"."scoring_policy_version") <> '' AND btrim("survey_question_insights"."question_rubric_version") <> '' AND btrim("survey_question_insights"."model_id") <> '' AND btrim("survey_question_insights"."prompt_version") <> '' AND btrim("survey_question_insights"."privacy_policy_version") <> '')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_question_working_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"question_version" text NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"working_summary" text,
	"confirmed_semantic_summary" text,
	"source_message_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"confirmation_bundle_id" uuid,
	"confirmation_message_id" uuid,
	"confirmed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_question_working_insights_scope_key" UNIQUE("tenant_id","user_id","survey_window_id","survey_question_id","question_version"),
	CONSTRAINT "survey_question_working_insights_status_check" CHECK ("survey_question_working_insights"."status" IN ('collecting', 'pending_confirmation', 'pending_clarification', 'confirmed', 'declined', 'no_data', 'reset')),
	CONSTRAINT "survey_question_working_insights_purged_content_check" CHECK ("survey_question_working_insights"."purged_at" IS NULL OR ("survey_question_working_insights"."working_summary" IS NULL AND "survey_question_working_insights"."confirmed_semantic_summary" IS NULL AND cardinality("survey_question_working_insights"."source_message_ids") = 0))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_scoring_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" text NOT NULL,
	"rubrics" jsonb NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_scoring_policies_tenant_version_key" UNIQUE("tenant_id","version"),
	CONSTRAINT "survey_scoring_policies_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "survey_scoring_policies_version_not_blank" CHECK (btrim("survey_scoring_policies"."version") <> ''),
	CONSTRAINT "survey_scoring_policies_rubrics_object" CHECK (jsonb_typeof("survey_scoring_policies"."rubrics") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_window_scoring_policies" (
	"survey_window_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scoring_policy_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_confirmation_bundles" ADD CONSTRAINT "survey_question_confirmation_bundles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_confirmation_bundles" ADD CONSTRAINT "survey_question_confirmation_bundles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_confirmation_bundles" ADD CONSTRAINT "survey_question_confirmation_bundles_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_confirmation_bundles" ADD CONSTRAINT "survey_question_confirmation_bundles_prompt_message_id_messages_id_fk" FOREIGN KEY ("prompt_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_insights" ADD CONSTRAINT "survey_question_insights_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_confirmation_bundle_id_survey_question_confirmation_bundles_id_fk" FOREIGN KEY ("confirmation_bundle_id") REFERENCES "public"."survey_question_confirmation_bundles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_working_insights" ADD CONSTRAINT "survey_question_working_insights_confirmation_message_id_messages_id_fk" FOREIGN KEY ("confirmation_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_scoring_policies" ADD CONSTRAINT "survey_scoring_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_window_scoring_policies" ADD CONSTRAINT "survey_window_scoring_policies_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_window_scoring_policies" ADD CONSTRAINT "survey_window_scoring_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_window_scoring_policies" ADD CONSTRAINT "survey_window_scoring_policies_tenant_policy_fk" FOREIGN KEY ("tenant_id","scoring_policy_id") REFERENCES "public"."survey_scoring_policies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_question_insights_window_group_idx" ON "survey_question_insights" USING btree ("tenant_id","survey_window_id","question_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_question_working_insights_window_idx" ON "survey_question_working_insights" USING btree ("tenant_id","survey_window_id");
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_validate_scope() RETURNS trigger AS $$
DECLARE
  scoped_window survey_windows%ROWTYPE;
  scoped_question survey_questions%ROWTYPE;
  scoped_bundle survey_question_confirmation_bundles%ROWTYPE;
BEGIN
  SELECT * INTO scoped_window FROM survey_windows WHERE id = NEW.survey_window_id;
  IF NOT FOUND OR scoped_window.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'survey_insight_v2_window_tenant_mismatch';
  END IF;

  IF TG_TABLE_NAME = 'survey_window_scoring_policies' THEN
    RETURN NEW;
  END IF;

  IF scoped_window.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'survey_insight_v2_window_user_mismatch';
  END IF;

  IF TG_TABLE_NAME = 'survey_question_confirmation_bundles' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO scoped_question FROM survey_questions WHERE id = NEW.survey_question_id;
  IF NOT FOUND OR scoped_question.survey_definition_id <> scoped_window.survey_definition_id
      OR scoped_question.version <> NEW.question_version THEN
    RAISE EXCEPTION 'survey_insight_v2_question_scope_mismatch';
  END IF;

  IF TG_TABLE_NAME = 'survey_question_working_insights' THEN
    IF NEW.confirmation_bundle_id IS NOT NULL THEN
      SELECT * INTO scoped_bundle FROM survey_question_confirmation_bundles WHERE id = NEW.confirmation_bundle_id;
      IF NOT FOUND OR scoped_bundle.tenant_id <> NEW.tenant_id
          OR scoped_bundle.user_id <> NEW.user_id
          OR scoped_bundle.survey_window_id <> NEW.survey_window_id
          OR scoped_bundle.question_group <> scoped_question.question_group THEN
        RAISE EXCEPTION 'survey_insight_v2_bundle_scope_mismatch';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.survey_definition_id <> scoped_window.survey_definition_id
      OR NEW.question_group <> scoped_question.question_group THEN
    RAISE EXCEPTION 'survey_insight_v2_final_scope_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM survey_window_scoring_policies binding
      JOIN survey_scoring_policies policy ON policy.id = binding.scoring_policy_id
    WHERE binding.survey_window_id = NEW.survey_window_id
      AND binding.tenant_id = NEW.tenant_id
      AND policy.version = NEW.scoring_policy_version
  ) THEN
    RAISE EXCEPTION 'survey_insight_v2_unbound_scoring_policy';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_binding_scope_guard BEFORE INSERT OR UPDATE ON survey_window_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_validate_scope();
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_bundle_scope_guard BEFORE INSERT OR UPDATE ON survey_question_confirmation_bundles
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_validate_scope();
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_working_scope_guard BEFORE INSERT OR UPDATE ON survey_question_working_insights
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_validate_scope();
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_final_scope_guard BEFORE INSERT OR UPDATE ON survey_question_insights
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_validate_scope();
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'survey_insight_v2_immutable_%', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_policy_immutable BEFORE UPDATE ON survey_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_immutable();
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_binding_immutable BEFORE UPDATE ON survey_window_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_immutable();
