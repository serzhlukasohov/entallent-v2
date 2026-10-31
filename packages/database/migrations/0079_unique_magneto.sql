ALTER TABLE "survey_report_shown_components" ADD COLUMN "body_disposition" text DEFAULT 'retained' NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_private_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data messages%ROWTYPE;
BEGIN
 row_data:=OLD;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND tenant_id=OLD.tenant_id) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF OLD.direction='outbound' AND (TG_OP='DELETE' OR OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN UPDATE survey_report_shown_components SET body_disposition='deleted' WHERE prompt_message_id=OLD.id AND tenant_id=OLD.tenant_id AND user_id=OLD.user_id; END IF;
 IF OLD.direction='inbound' AND (TG_OP='DELETE' OR OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||OLD.tenant_id::text||':'||OLD.user_id::text,0));
  UPDATE survey_report_inbound_work SET capture=CASE WHEN capture IN ('pending','blocked') THEN 'deleted' ELSE capture END,native_verdict=CASE WHEN native_verdict IN ('pending','claimed','blocked') THEN 'deleted' ELSE native_verdict END,evidence=CASE WHEN evidence IN ('pending','blocked','delegated') THEN 'deleted' ELSE evidence END,finalization=CASE WHEN finalization IN ('pending','blocked') THEN 'deleted' ELSE finalization END,attempt_token=NULL,lease_until=NULL,failure_code=NULL WHERE inbound_receipt_id=OLD.id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE survey_report_shown_components ADD CONSTRAINT report_shown_body_disposition CHECK(body_disposition IN ('retained','deleted'));
--> statement-breakpoint
CREATE FUNCTION pulse_input_work_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.inbound_receipt_id,NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.received_at,NEW.trust,NEW.recorded_at) IS DISTINCT FROM ROW(OLD.inbound_receipt_id,OLD.tenant_id,OLD.user_id,OLD.conversation_id,OLD.received_at,OLD.trust,OLD.recorded_at) THEN RAISE EXCEPTION 'pulse_work_identity_immutable'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM messages m WHERE m.id=NEW.inbound_receipt_id AND m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id AND m.conversation_id=NEW.conversation_id AND m.direction='inbound' AND m.received_at IS NOT DISTINCT FROM NEW.received_at AND (NEW.trust<>'db-receipt-v1' OR m.receipt_trust='db-receipt-v1')) THEN RAISE EXCEPTION 'pulse_work_source_identity_mismatch'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER pulse_input_work_identity_guard BEFORE INSERT OR UPDATE ON survey_report_inbound_work FOR EACH ROW EXECUTE FUNCTION pulse_input_work_identity_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_input_watermark_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.insight_id,NEW.tenant_id,NEW.user_id,NEW.lineage_id,NEW.confirmation_message_id,NEW.confirmation_received_at,NEW.accepted_source_receipts,NEW.expires_at) IS DISTINCT FROM ROW(OLD.insight_id,OLD.tenant_id,OLD.user_id,OLD.lineage_id,OLD.confirmation_message_id,OLD.confirmation_received_at,OLD.accepted_source_receipts,OLD.expires_at) OR OLD.state<>'retained' AND NEW.state='retained' THEN RAISE EXCEPTION 'pulse_watermark_identity_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pulse_input_watermark_identity_guard BEFORE UPDATE ON survey_report_topic_watermarks FOR EACH ROW EXECUTE FUNCTION pulse_input_watermark_identity_guard();

--> statement-breakpoint
CREATE FUNCTION pulse_input_receipt_in_scope(t uuid,u uuid,cycle uuid,receipt timestamptz,frontier timestamptz,numeric_answer boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id AND c.tenant_id=p.tenant_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id AND o.tenant_id=c.tenant_id
  WHERE p.tenant_id=t AND p.user_id=u AND c.id=cycle AND receipt>=greatest(c.period_start,o.opened_at,CASE WHEN numeric_answer THEN c.period_end-interval '14 days' ELSE c.period_start END) AND receipt<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end),frontier));
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_ingress_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (OLD.direction='inbound' OR NEW.direction='inbound') AND ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.received_at,NEW.receipt_trust,NEW.direction) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.conversation_id,OLD.received_at,OLD.receipt_trust,OLD.direction) THEN RAISE EXCEPTION 'pulse_receipt_identity_immutable'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.direction<>'inbound' THEN NEW.receipt_trust:=NULL; RETURN NEW; END IF;
 -- All writers, including admissionless dev and generic saves, obey the formation fence.
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||NEW.tenant_id::text||':'||NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id AND user_id=NEW.user_id) THEN RAISE EXCEPTION 'pulse_receipt_owner_mismatch'; END IF;
 IF NEW.received_at IS NULL THEN
  NEW.received_at:=clock_timestamp(); NEW.receipt_trust:='db-receipt-v1';
 ELSE
  NEW.receipt_trust:='unverified_explicit_receipt';
  IF EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id JOIN survey_report_final_timings f ON f.tenant_id=p.tenant_id AND f.cycle_scoring_policy_id=c.id WHERE p.tenant_id=NEW.tenant_id AND p.user_id=NEW.user_id AND f.status='started' AND NEW.received_at>=greatest(c.period_start,o.opened_at) AND NEW.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end),f.report_data_cutoff)) THEN RAISE EXCEPTION 'pulse_receipt_backdate_after_formation'; END IF;
 END IF;
 RETURN NEW;
END $$;
