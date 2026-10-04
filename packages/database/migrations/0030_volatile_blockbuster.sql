CREATE TABLE IF NOT EXISTS "survey_cycle_scoring_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"scoring_policy_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_cycle_scoring_policies_scope_key" UNIQUE("tenant_id","survey_definition_id","period_start","period_end"),
	CONSTRAINT "survey_cycle_scoring_policies_period_check" CHECK ("survey_cycle_scoring_policies"."period_end" > "survey_cycle_scoring_policies"."period_start")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_cycle_scoring_policies" ADD CONSTRAINT "survey_cycle_scoring_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_activate_cycle() RETURNS trigger AS $$
DECLARE
  scoped_definition survey_definitions%ROWTYPE;
  policy survey_scoring_policies%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.survey_definition_id::text || ':'
      || NEW.period_start::text || ':' || NEW.period_end::text,
    0
  ));
  IF statement_timestamp() >= NEW.period_start THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_activation_after_start';
  END IF;
  SELECT * INTO scoped_definition FROM survey_definitions
    WHERE id = NEW.survey_definition_id;
  IF NOT FOUND OR (scoped_definition.tenant_id IS NOT NULL AND scoped_definition.tenant_id <> NEW.tenant_id)
      OR scoped_definition.active IS NOT TRUE THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_definition_unavailable';
  END IF;
  SELECT * INTO policy FROM survey_scoring_policies
    WHERE id = NEW.scoring_policy_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR policy.approved_at > statement_timestamp() THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_policy_unapproved';
  END IF;
  IF (SELECT count(*) FROM survey_questions
      WHERE survey_definition_id = NEW.survey_definition_id AND response_type = 'open_ended') <> 12
    OR EXISTS (
      SELECT 1 FROM survey_questions question
      WHERE question.survey_definition_id = NEW.survey_definition_id
        AND question.response_type = 'open_ended'
        AND (
          question.question_group NOT IN ('autonomy', 'growth', 'purpose', 'belonging')
          OR jsonb_typeof(policy.rubrics -> question.stable_key) <> 'object'
          OR btrim(coalesce(policy.rubrics -> question.stable_key ->> 'version', '')) = ''
          OR btrim(coalesce(policy.rubrics -> question.stable_key ->> 'instructions', '')) = ''
          OR CASE WHEN jsonb_typeof(policy.rubrics -> question.stable_key -> 'anchors') = 'array'
            THEN jsonb_array_length(policy.rubrics -> question.stable_key -> 'anchors') < 2
            ELSE true END
        )
    )
    OR EXISTS (
      SELECT 1 FROM (VALUES ('autonomy'), ('growth'), ('purpose'), ('belonging')) AS groups(name)
      WHERE (SELECT count(*) FROM survey_questions question
        WHERE question.survey_definition_id = NEW.survey_definition_id
          AND question.response_type = 'open_ended' AND question.question_group = groups.name) <> 3
    ) THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_policy_incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM survey_windows cycle_window
      JOIN survey_window_scoring_policies binding ON binding.survey_window_id = cycle_window.id
    WHERE cycle_window.tenant_id = NEW.tenant_id
      AND cycle_window.survey_definition_id = NEW.survey_definition_id
      AND cycle_window.period_start = NEW.period_start AND cycle_window.period_end = NEW.period_end
      AND binding.scoring_policy_id <> NEW.scoring_policy_id
  ) OR EXISTS (
    SELECT 1 FROM survey_windows cycle_window
      JOIN survey_group_states state ON state.survey_window_id = cycle_window.id
    WHERE cycle_window.tenant_id = NEW.tenant_id
      AND cycle_window.survey_definition_id = NEW.survey_definition_id
      AND cycle_window.period_start = NEW.period_start AND cycle_window.period_end = NEW.period_end
      AND state.question_group IN ('autonomy', 'growth', 'purpose', 'belonging')
  ) OR EXISTS (
    SELECT 1 FROM survey_windows cycle_window
      JOIN survey_evidence evidence ON evidence.survey_window_id = cycle_window.id
      JOIN survey_questions question ON question.id = evidence.survey_question_id
    WHERE cycle_window.tenant_id = NEW.tenant_id
      AND cycle_window.survey_definition_id = NEW.survey_definition_id
      AND cycle_window.period_start = NEW.period_start AND cycle_window.period_end = NEW.period_end
      AND question.response_type = 'open_ended'
  ) OR EXISTS (
    SELECT 1 FROM survey_windows cycle_window
      JOIN survey_assessments assessment ON assessment.survey_window_id = cycle_window.id
      JOIN survey_questions question ON question.id = assessment.survey_question_id
    WHERE cycle_window.tenant_id = NEW.tenant_id
      AND cycle_window.survey_definition_id = NEW.survey_definition_id
      AND cycle_window.period_start = NEW.period_start AND cycle_window.period_end = NEW.period_end
      AND question.response_type = 'open_ended'
  ) THEN
    RAISE EXCEPTION 'survey_insight_v2_cycle_legacy_or_conflicting_state';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_cycle_activation_guard BEFORE INSERT ON survey_cycle_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_activate_cycle();
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_bind_cycle_windows() RETURNS trigger AS $$
BEGIN
  INSERT INTO survey_window_scoring_policies (survey_window_id, tenant_id, scoring_policy_id, bound_at)
  SELECT cycle_window.id, NEW.tenant_id, NEW.scoring_policy_id, NEW.activated_at
  FROM survey_windows cycle_window
  WHERE cycle_window.tenant_id = NEW.tenant_id
    AND cycle_window.survey_definition_id = NEW.survey_definition_id
    AND cycle_window.period_start = NEW.period_start AND cycle_window.period_end = NEW.period_end
  ON CONFLICT (survey_window_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_bind_existing_windows AFTER INSERT ON survey_cycle_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_bind_cycle_windows();
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_bind_new_window() RETURNS trigger AS $$
DECLARE
  cycle survey_cycle_scoring_policies%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.tenant_id::text || ':' || NEW.survey_definition_id::text || ':'
      || NEW.period_start::text || ':' || NEW.period_end::text,
    0
  ));
  SELECT * INTO cycle FROM survey_cycle_scoring_policies
    WHERE tenant_id = NEW.tenant_id
      AND survey_definition_id = NEW.survey_definition_id
      AND period_start = NEW.period_start AND period_end = NEW.period_end;
  IF FOUND THEN
    INSERT INTO survey_window_scoring_policies (survey_window_id, tenant_id, scoring_policy_id, bound_at)
      VALUES (NEW.id, NEW.tenant_id, cycle.scoring_policy_id, cycle.activated_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_bind_new_window AFTER INSERT ON survey_windows
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_bind_new_window();
--> statement-breakpoint
CREATE FUNCTION survey_insight_v2_cycle_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'survey_insight_v2_cycle_immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_insight_v2_cycle_immutable BEFORE UPDATE OR DELETE ON survey_cycle_scoring_policies
  FOR EACH ROW EXECUTE FUNCTION survey_insight_v2_cycle_immutable();
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_cycle_scoring_policies" ADD CONSTRAINT "survey_cycle_scoring_policies_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_cycle_scoring_policies" ADD CONSTRAINT "survey_cycle_scoring_policies_tenant_policy_fk" FOREIGN KEY ("tenant_id","scoring_policy_id") REFERENCES "public"."survey_scoring_policies"("tenant_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
