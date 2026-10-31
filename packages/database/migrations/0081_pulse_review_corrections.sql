ALTER TABLE "survey_report_shown_components" ADD COLUMN "full_body_hash" text;--> statement-breakpoint
ALTER TABLE "survey_report_shown_components" ADD COLUMN "form_start_character" integer;--> statement-breakpoint
ALTER TABLE "survey_report_shown_components" ADD COLUMN "form_character_length" integer;
--> statement-breakpoint
-- Keep the immutable suffix proof and separately bind new mappings to the full shown body.
-- Existing mappings retain NULL full-body proof; no historical receipt or form is upgraded.
CREATE OR REPLACE FUNCTION pulse_input_shown_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.components IS NOT NULL AND NEW.prompt_message_id IS NOT NULL AND EXISTS(SELECT 1 FROM survey_report_window_bindings WHERE survey_window_id=NEW.survey_window_id) THEN
  INSERT INTO survey_report_shown_components(tenant_id,user_id,conversation_id,bundle_id,prompt_message_id,survey_window_id,survey_question_id,question_version,ordinal,working_insight_id,working_revision_hash,component_hash,form_hash,full_body_hash,form_start_character,form_character_length,sent_at,acknowledged_at)
  SELECT NEW.tenant_id,NEW.user_id,m.conversation_id,NEW.id,m.id,NEW.survey_window_id,w.survey_question_id,w.question_version,c.ordinality::integer,w.id,
    encode(sha256(convert_to(coalesce(w.working_summary,'')||':'||w.updated_at::text,'UTF8')),'hex'),encode(sha256(convert_to(c.value->>'statement','UTF8')),'hex'),
    encode(sha256(convert_to(NEW.displayed_text,'UTF8')),'hex'),encode(sha256(convert_to(m.text,'UTF8')),'hex'),strpos(m.text,NEW.displayed_text),char_length(NEW.displayed_text),m.sent_at,m.delivery_recorded_at
  FROM jsonb_array_elements(NEW.components) WITH ORDINALITY c(value,ordinality) JOIN survey_question_working_insights w ON w.tenant_id=NEW.tenant_id AND w.user_id=NEW.user_id AND w.survey_window_id=NEW.survey_window_id AND w.survey_question_id=(c.value->>'surveyQuestionId')::uuid AND w.question_version=c.value->>'questionVersion' JOIN messages m ON m.id=NEW.prompt_message_id AND m.tenant_id=NEW.tenant_id AND m.user_id=NEW.user_id
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_shown_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.bundle_id,NEW.prompt_message_id,NEW.survey_window_id,NEW.survey_question_id,NEW.question_version,NEW.ordinal,NEW.working_insight_id,NEW.working_revision_hash,NEW.component_hash,NEW.form_hash,NEW.full_body_hash,NEW.form_start_character,NEW.form_character_length)
  IS DISTINCT FROM ROW(OLD.tenant_id,OLD.user_id,OLD.conversation_id,OLD.bundle_id,OLD.prompt_message_id,OLD.survey_window_id,OLD.survey_question_id,OLD.question_version,OLD.ordinal,OLD.working_insight_id,OLD.working_revision_hash,OLD.component_hash,OLD.form_hash,OLD.full_body_hash,OLD.form_start_character,OLD.form_character_length)
  OR OLD.sent_at IS NOT NULL AND ROW(OLD.sent_at,OLD.acknowledged_at) IS DISTINCT FROM ROW(NEW.sent_at,NEW.acknowledged_at) THEN RAISE EXCEPTION 'pulse_shown_identity_immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Rights/erasure remain current, but a different team's candidate has no changed audience or input.
CREATE OR REPLACE FUNCTION pulse_input_bump(t uuid,u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation)
 SELECT tenant_id,cycle_scoring_policy_id,1 FROM survey_report_participants WHERE tenant_id=t AND user_id=u ORDER BY cycle_scoring_policy_id
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
 UPDATE survey_report_input_candidates candidate SET invalidated_at=clock_timestamp()
 WHERE candidate.tenant_id=t AND candidate.invalidated_at IS NULL AND (
  EXISTS(SELECT 1 FROM survey_report_scope_memberships m JOIN survey_report_participants p ON p.id=m.participant_id AND p.tenant_id=m.tenant_id AND p.cycle_scoring_policy_id=m.cycle_scoring_policy_id WHERE m.scope_id=candidate.scope_id AND m.tenant_id=t AND p.user_id=u)
  OR EXISTS(SELECT 1 FROM survey_report_candidate_sources source WHERE source.candidate_id=candidate.id AND source.tenant_id=t AND source.user_id=u));
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_bump_receipt(t uuid,u uuid,r uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE receipts uuid[]; affected record;
BEGIN
 WITH RECURSIVE dependents(id) AS (
  SELECT r UNION SELECT d.inbound_receipt_id FROM survey_report_work_dependencies d JOIN dependents previous ON d.depends_on_receipt_id=previous.id WHERE d.tenant_id=t AND d.user_id=u
 ) SELECT array_agg(id) INTO receipts FROM dependents;
 FOR affected IN SELECT DISTINCT c.id FROM survey_report_participants p
   JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id AND c.tenant_id=p.tenant_id
   JOIN survey_report_inbound_work work ON work.tenant_id=p.tenant_id AND work.user_id=p.user_id
   LEFT JOIN survey_report_final_timings timing ON timing.tenant_id=p.tenant_id AND timing.cycle_scoring_policy_id=c.id
   WHERE p.tenant_id=t AND p.user_id=u AND work.inbound_receipt_id=ANY(receipts) AND work.trust='db-receipt-v1'
     AND pulse_input_receipt_in_scope(t,u,c.id,work.received_at,CASE WHEN timing.status='started' THEN timing.report_data_cutoff ELSE NULL END,false)
   ORDER BY c.id
 LOOP
  INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation) VALUES(t,affected.id,1)
   ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
  UPDATE survey_report_input_candidates candidate SET invalidated_at=clock_timestamp()
   WHERE candidate.tenant_id=t AND candidate.cycle_id=affected.id AND candidate.invalidated_at IS NULL
    AND EXISTS(SELECT 1 FROM survey_report_scope_memberships m JOIN survey_report_participants p ON p.id=m.participant_id AND p.tenant_id=m.tenant_id WHERE m.scope_id=candidate.scope_id AND m.tenant_id=t AND p.user_id=u)
    AND EXISTS(SELECT 1 FROM survey_report_inbound_work work WHERE work.inbound_receipt_id=ANY(receipts) AND work.tenant_id=t AND work.user_id=u AND work.trust='db-receipt-v1' AND pulse_input_receipt_in_scope(t,u,candidate.cycle_id,work.received_at,candidate.frontier,false));
 END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_progress_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.capture,NEW.native_verdict,NEW.evidence,NEW.finalization,NEW.failure_code) IS DISTINCT FROM ROW(OLD.capture,OLD.native_verdict,OLD.evidence,OLD.finalization,OLD.failure_code) THEN PERFORM pulse_input_bump_receipt(NEW.tenant_id,NEW.user_id,NEW.inbound_receipt_id); END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_permanent_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_topic_watermarks(insight_id,tenant_id,user_id,lineage_id,confirmation_message_id,confirmation_received_at,accepted_source_receipts,state,expires_at)
 SELECT NEW.insight_id,NEW.tenant_id,NEW.user_id,NEW.lineage_id,NEW.confirmation_message_id,NEW.confirmation_received_at,NEW.accepted_source_receipts,'retained',i.processed_at+engagement_retention_days(t.retention_policy)*interval '1 day'
 FROM survey_question_insights i JOIN tenants t ON t.id=i.tenant_id WHERE i.id=NEW.insight_id AND NEW.proof_status='receipt_backed';
 PERFORM pulse_input_bump_receipt(NEW.tenant_id,NEW.user_id,NEW.confirmation_message_id);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_claim(t uuid,u uuid,r uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE work survey_report_inbound_work%ROWTYPE; token uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 SELECT * INTO work FROM survey_report_inbound_work WHERE tenant_id=t AND user_id=u AND inbound_receipt_id=r;
 IF work.inbound_receipt_id IS NULL THEN RAISE EXCEPTION 'pulse_input_missing_receipt'; END IF;
 IF work.trust<>'db-receipt-v1' OR work.native_verdict NOT IN ('pending','claimed','blocked') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id WHERE p.tenant_id=t AND p.user_id=u AND pulse_input_receipt_in_scope(t,u,c.id,work.received_at,null,false)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM survey_report_inbound_work earlier JOIN survey_report_participants p ON p.tenant_id=earlier.tenant_id AND p.user_id=earlier.user_id JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id
  WHERE earlier.tenant_id=t AND earlier.user_id=u AND earlier.trust='db-receipt-v1' AND (earlier.received_at,earlier.inbound_receipt_id)<(work.received_at,r) AND earlier.native_verdict IN ('pending','claimed','blocked')
    AND pulse_input_receipt_in_scope(t,u,c.id,work.received_at,null,false) AND pulse_input_receipt_in_scope(t,u,c.id,earlier.received_at,null,false)) THEN RAISE EXCEPTION 'pulse_input_earlier_native_stage'; END IF;
 IF work.native_verdict='claimed' AND work.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'pulse_input_native_lease_busy'; END IF;
 token:=gen_random_uuid();
 UPDATE survey_report_inbound_work SET native_verdict='claimed',attempt_token=token,lease_until=clock_timestamp()+interval '10 minutes',failure_code=NULL WHERE inbound_receipt_id=r;
 RETURN token;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulse_input_bump_lineage(t uuid,u uuid,lineage uuid,revision uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation)
 SELECT tenant_id,cycle_scoring_policy_id,1 FROM survey_report_question_lineages WHERE id=lineage AND tenant_id=t AND user_id=u
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
 UPDATE survey_report_input_candidates candidate SET invalidated_at=clock_timestamp() WHERE candidate.tenant_id=t AND candidate.invalidated_at IS NULL
  AND EXISTS(SELECT 1 FROM survey_report_candidate_sources source WHERE source.candidate_id=candidate.id AND source.tenant_id=t AND source.user_id=u AND source.lineage_id=lineage AND (revision IS NULL OR source.revision_id=revision));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_insight_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mark survey_report_topic_watermarks%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||OLD.tenant_id::text||':'||OLD.user_id::text,0));
 IF TG_OP='DELETE' OR NEW.withdrawn_at IS NOT NULL THEN
  UPDATE survey_report_topic_watermarks SET state=CASE WHEN TG_OP='UPDATE' THEN 'withdrawn' WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE 'deleted' END WHERE insight_id=OLD.id;
  FOR mark IN SELECT * FROM survey_report_topic_watermarks WHERE insight_id=OLD.id LOOP PERFORM pulse_input_bump_lineage(OLD.tenant_id,OLD.user_id,mark.lineage_id,OLD.id); END LOOP;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_negative_subject(t uuid,u uuid,kind text,lineage uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 UPDATE survey_report_topic_watermarks SET state=CASE WHEN kind='deleted' THEN 'deleted' ELSE 'withdrawn' END WHERE tenant_id=t AND user_id=u AND (lineage IS NULL OR lineage_id=lineage);
 IF lineage IS NULL THEN
  UPDATE survey_report_inbound_work SET capture=kind,native_verdict=kind,evidence=kind,finalization=kind,attempt_token=NULL,lease_until=NULL WHERE tenant_id=t AND user_id=u;
  PERFORM pulse_input_bump(t,u);
 ELSE PERFORM pulse_input_bump_lineage(t,u,lineage);
 END IF;
END $$;
