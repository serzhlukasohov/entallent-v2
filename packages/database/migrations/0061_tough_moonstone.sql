CREATE TABLE IF NOT EXISTS "survey_engagement_collection_contracts" (
	"survey_definition_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_definition_id" uuid NOT NULL,
	"contract_version" text NOT NULL,
	CONSTRAINT "engagement_collection_version" CHECK ("survey_engagement_collection_contracts"."contract_version" = 'engagement-1-10-v1')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_collection_contracts" ADD CONSTRAINT "survey_engagement_collection_contracts_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_engagement_collection_contracts" ADD CONSTRAINT "survey_engagement_collection_contracts_source_definition_id_survey_definitions_id_fk" FOREIGN KEY ("source_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE FUNCTION engagement_collection_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=OLD.tenant_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'engagement_collection_immutable';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM survey_definitions target JOIN survey_definitions source ON source.id=NEW.source_definition_id
    WHERE target.id=NEW.survey_definition_id AND target.tenant_id=NEW.tenant_id AND source.tenant_id=NEW.tenant_id
      AND target.version='v2-report-engagement-1.0.0' AND source.version='v2-policy-1.0.0' AND NOT target.active
      AND target.configuration->>'engagementAnswerContract'=NEW.contract_version)
    OR (SELECT count(*) FROM survey_questions WHERE survey_definition_id=NEW.survey_definition_id)<>15
    OR (SELECT count(*) FROM survey_engagement_contract_questions WHERE survey_definition_id=NEW.survey_definition_id)<>3 THEN RAISE EXCEPTION 'engagement_collection_identity_mismatch'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_collection_immutable BEFORE INSERT OR UPDATE OR DELETE ON survey_engagement_collection_contracts FOR EACH ROW EXECUTE FUNCTION engagement_collection_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION engagement_question_immutable() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_engagement_collection_contracts WHERE survey_definition_id=OLD.survey_definition_id)
    OR EXISTS(SELECT 1 FROM survey_engagement_contract_questions WHERE survey_question_id=OLD.id) THEN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM survey_definitions WHERE id=OLD.survey_definition_id) THEN RETURN OLD; END IF;
    IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'engagement_question_immutable'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_question_delete_immutable BEFORE DELETE ON survey_questions FOR EACH ROW EXECUTE FUNCTION engagement_question_immutable();
--> statement-breakpoint
CREATE FUNCTION engagement_question_append_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM survey_engagement_collection_contracts WHERE survey_definition_id=NEW.survey_definition_id) THEN RAISE EXCEPTION 'engagement_catalog_complete'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_question_append_guard BEFORE INSERT ON survey_questions FOR EACH ROW EXECUTE FUNCTION engagement_question_append_guard();
