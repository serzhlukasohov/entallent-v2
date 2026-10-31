-- Intentional private-proof erasure is terminal; an accepted scalar already owns its proof snapshot.
CREATE FUNCTION engagement_private_proof_erasure() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id AND tenant_id=OLD.tenant_id)
    OR NOT EXISTS(SELECT 1 FROM survey_windows w JOIN survey_report_window_bindings b ON b.survey_window_id=w.id
      JOIN survey_engagement_collection_contracts c ON c.survey_definition_id=w.survey_definition_id
      WHERE w.tenant_id=OLD.tenant_id AND w.user_id=OLD.user_id) THEN RETURN OLD; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:' || OLD.tenant_id::text || ':' || OLD.user_id::text,0));
  IF OLD.direction='inbound' AND OLD.received_at IS NOT NULL THEN
    INSERT INTO survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at)
      VALUES(OLD.id,OLD.tenant_id,OLD.user_id,'source_deleted',OLD.received_at) ON CONFLICT DO NOTHING;
  ELSIF OLD.direction='outbound' AND OLD.sent_at IS NOT NULL THEN
    INSERT INTO survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at)
      SELECT source.id,source.tenant_id,source.user_id,'ineligible',source.received_at FROM messages source
      WHERE source.tenant_id=OLD.tenant_id AND source.user_id=OLD.user_id AND source.conversation_id=OLD.conversation_id
        AND source.direction='inbound' AND source.received_at>OLD.sent_at
        AND NOT EXISTS(SELECT 1 FROM messages later WHERE later.tenant_id=OLD.tenant_id AND later.user_id=OLD.user_id
          AND later.conversation_id=OLD.conversation_id AND later.direction='outbound' AND later.sent_at<source.received_at
          AND (later.sent_at,later.id)>(OLD.sent_at,OLD.id)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER engagement_private_proof_erasure BEFORE DELETE ON messages FOR EACH ROW EXECUTE FUNCTION engagement_private_proof_erasure();
