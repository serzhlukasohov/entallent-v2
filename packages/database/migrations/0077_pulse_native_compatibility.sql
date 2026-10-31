CREATE OR REPLACE FUNCTION pulse_input_claim(t uuid,u uuid,r uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE w survey_report_inbound_work%ROWTYPE; token uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||t::text||':'||u::text,0));
 SELECT * INTO w FROM survey_report_inbound_work WHERE tenant_id=t AND user_id=u AND inbound_receipt_id=r;
 IF w.inbound_receipt_id IS NULL THEN RAISE EXCEPTION 'pulse_input_missing_receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id WHERE p.tenant_id=t AND p.user_id=u AND w.received_at>=greatest(c.period_start,o.opened_at) AND w.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end))) THEN RETURN NULL; END IF;
 IF w.native_verdict NOT IN ('pending','claimed','blocked') THEN RETURN NULL; END IF;
 IF w.trust<>'db-receipt-v1' THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM survey_report_inbound_work earlier WHERE earlier.tenant_id=t AND earlier.user_id=u AND (earlier.received_at,earlier.inbound_receipt_id)<(w.received_at,r) AND earlier.native_verdict IN ('pending','claimed','blocked') AND EXISTS(SELECT 1 FROM survey_report_participants p JOIN survey_cycle_scoring_policies c ON c.id=p.cycle_scoring_policy_id JOIN survey_report_cycle_openings o ON o.cycle_scoring_policy_id=c.id WHERE p.tenant_id=t AND p.user_id=u AND earlier.received_at>=greatest(c.period_start,o.opened_at) AND earlier.received_at<least(c.period_end,coalesce(p.collection_stopped_at,c.period_end)))) THEN RAISE EXCEPTION 'pulse_input_earlier_native_stage'; END IF;
 IF w.native_verdict='claimed' AND w.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'pulse_input_native_lease_busy'; END IF;
 token:=gen_random_uuid();
 UPDATE survey_report_inbound_work SET native_verdict='claimed',attempt_token=token,lease_until=clock_timestamp()+interval '10 minutes',failure_code=NULL WHERE inbound_receipt_id=r;
 RETURN token;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_ingress_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.direction='inbound' THEN
  INSERT INTO survey_report_inbound_work(inbound_receipt_id,tenant_id,user_id,conversation_id,received_at,trust) VALUES(NEW.id,NEW.tenant_id,NEW.user_id,NEW.conversation_id,NEW.received_at,NEW.receipt_trust);

 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_input_bump(t uuid,u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO survey_report_input_generations(tenant_id,cycle_id,generation)
 SELECT tenant_id,cycle_scoring_policy_id,1 FROM survey_report_participants WHERE tenant_id=t AND user_id=u ORDER BY cycle_scoring_policy_id
 ON CONFLICT(tenant_id,cycle_id) DO UPDATE SET generation=survey_report_input_generations.generation+1,certified_generation=NULL;
 UPDATE survey_report_input_candidates c SET invalidated_at=clock_timestamp()
 WHERE c.tenant_id=t AND c.invalidated_at IS NULL AND EXISTS(SELECT 1 FROM survey_report_participants p WHERE p.tenant_id=t AND p.user_id=u AND p.cycle_scoring_policy_id=c.cycle_id);
END $$;
