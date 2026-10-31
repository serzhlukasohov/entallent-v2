ALTER TABLE "survey_cycle_scoring_policies" ADD CONSTRAINT "survey_cycle_scoring_policies_tenant_id_key" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "survey_report_cycle_openings" DROP CONSTRAINT "survey_report_cycle_openings_cycle_scoring_policy_id_survey_cycle_scoring_policies_id_fk";
--> statement-breakpoint
ALTER TABLE "survey_report_question_lineages" DROP CONSTRAINT "survey_report_question_lineages_cycle_scoring_policy_id_survey_cycle_scoring_policies_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_cycle_openings" ADD CONSTRAINT "survey_report_cycle_openings_tenant_id_cycle_scoring_policy_id_survey_cycle_scoring_policies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id") REFERENCES "public"."survey_cycle_scoring_policies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_question_lineages" ADD CONSTRAINT "survey_report_question_lineages_tenant_id_cycle_scoring_policy_id_survey_cycle_scoring_policies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cycle_scoring_policy_id") REFERENCES "public"."survey_cycle_scoring_policies"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION pulse_report_metadata_identity_guard() RETURNS trigger AS $$
BEGIN
 IF TG_TABLE_NAME = 'survey_report_insight_revisions' THEN
   IF TG_OP = 'DELETE' AND (NOT EXISTS(SELECT 1 FROM survey_question_insights WHERE id = OLD.insight_id) OR NOT EXISTS(SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id)) THEN RETURN OLD; END IF;
   IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'pulse_report_revision_metadata_immutable'; END IF;
   IF NOT EXISTS(SELECT 1 FROM survey_question_insights i JOIN survey_report_question_lineages l ON l.id = NEW.lineage_id AND l.tenant_id = i.tenant_id AND l.user_id = i.user_id AND l.survey_question_id = i.survey_question_id AND l.question_version = i.question_version JOIN survey_windows w ON w.id = i.survey_window_id AND w.tenant_id = i.tenant_id AND w.user_id = i.user_id JOIN survey_cycle_scoring_policies c ON c.id = l.cycle_scoring_policy_id AND c.tenant_id = l.tenant_id AND c.survey_definition_id = w.survey_definition_id AND c.period_start = w.period_start AND c.period_end = w.period_end WHERE i.id = NEW.insight_id AND i.tenant_id = NEW.tenant_id AND i.user_id = NEW.user_id) THEN RAISE EXCEPTION 'pulse_report_revision_metadata_scope_mismatch'; END IF;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM survey_cycle_scoring_policies c JOIN survey_questions q ON q.survey_definition_id = c.survey_definition_id AND q.id = NEW.survey_question_id AND q.stable_key = NEW.question_stable_key AND q.version = NEW.question_version JOIN survey_scoring_policies policy ON policy.id = c.scoring_policy_id AND policy.tenant_id = c.tenant_id AND jsonb_typeof(policy.rubrics -> q.stable_key) = 'object' WHERE c.id = NEW.cycle_scoring_policy_id AND c.tenant_id = NEW.tenant_id AND c.scoring_policy_id = NEW.scoring_policy_id) THEN RAISE EXCEPTION 'pulse_report_lineage_scope_mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_revision_metadata_identity BEFORE INSERT OR UPDATE OR DELETE ON survey_report_insight_revisions FOR EACH ROW EXECUTE FUNCTION pulse_report_metadata_identity_guard();
CREATE TRIGGER report_lineage_identity BEFORE INSERT ON survey_report_question_lineages FOR EACH ROW EXECUTE FUNCTION pulse_report_metadata_identity_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_window_identity_guard() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id = OLD.id) AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.survey_definition_id IS DISTINCT FROM OLD.survey_definition_id OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end OR NEW.reporting_cohort_id IS DISTINCT FROM OLD.reporting_cohort_id OR NEW.reporting_team_id IS DISTINCT FROM OLD.reporting_team_id OR NEW.reporting_roster_user_ids IS DISTINCT FROM OLD.reporting_roster_user_ids) THEN RAISE EXCEPTION 'pulse_report_window_identity_immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_window_identity BEFORE UPDATE ON survey_windows FOR EACH ROW EXECUTE FUNCTION pulse_report_window_identity_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_report_legacy_opening_immutable() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'pulse_report_legacy_opening_immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER report_legacy_opening_immutable BEFORE UPDATE OR DELETE ON survey_report_legacy_cycle_openings FOR EACH ROW EXECUTE FUNCTION pulse_report_legacy_opening_immutable();
