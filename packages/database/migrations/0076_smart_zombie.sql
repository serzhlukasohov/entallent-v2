ALTER TABLE "survey_report_shown_components" ADD CONSTRAINT "report_shown_subject_identity" UNIQUE("tenant_id","user_id","prompt_message_id","ordinal");
--> statement-breakpoint
ALTER TABLE "survey_report_component_verdicts" DROP CONSTRAINT "survey_report_component_verdicts_prompt_message_id_ordinal_survey_report_shown_components_prompt_message_id_ordinal_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_component_verdicts" ADD CONSTRAINT "survey_report_component_verdicts_tenant_id_user_id_prompt_message_id_ordinal_survey_report_shown_components_tenant_id_user_id_prompt_message_id_ordinal_fk" FOREIGN KEY ("tenant_id","user_id","prompt_message_id","ordinal") REFERENCES "public"."survey_report_shown_components"("tenant_id","user_id","prompt_message_id","ordinal") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_private_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data messages%ROWTYPE;
BEGIN
 row_data:=OLD;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND tenant_id=OLD.tenant_id) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF OLD.direction='inbound' AND (TG_OP='DELETE' OR OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||OLD.tenant_id::text||':'||OLD.user_id::text,0));
  UPDATE survey_report_inbound_work SET capture=CASE WHEN capture IN ('pending','blocked') THEN 'deleted' ELSE capture END,native_verdict=CASE WHEN native_verdict IN ('pending','claimed','blocked') THEN 'deleted' ELSE native_verdict END,evidence=CASE WHEN evidence IN ('pending','blocked','delegated') THEN 'deleted' ELSE evidence END,finalization=CASE WHEN finalization IN ('pending','blocked') THEN 'deleted' ELSE finalization END,attempt_token=NULL,lease_until=NULL,failure_code=NULL WHERE inbound_receipt_id=OLD.id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_working_finalized() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='confirmed' AND NEW.confirmation_message_id IS NOT NULL AND NEW.finalized_at IS NULL THEN
  UPDATE survey_report_inbound_work SET finalization='pending' WHERE inbound_receipt_id=NEW.confirmation_message_id;
 END IF;
 IF NEW.finalized_at IS NOT NULL AND OLD.finalized_at IS NULL AND OLD.confirmation_message_id IS NOT NULL THEN
  UPDATE survey_report_inbound_work SET finalization='applied' WHERE inbound_receipt_id=OLD.confirmation_message_id AND NOT EXISTS(SELECT 1 FROM survey_question_working_insights w WHERE w.id<>NEW.id AND w.tenant_id=NEW.tenant_id AND w.user_id=NEW.user_id AND w.confirmation_message_id=OLD.confirmation_message_id AND w.status='confirmed' AND w.finalized_at IS NULL);
 END IF; RETURN NEW;
END $$;
