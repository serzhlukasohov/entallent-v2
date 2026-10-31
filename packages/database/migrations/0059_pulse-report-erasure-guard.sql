-- Custom SQL migration file, put you code below! --
CREATE OR REPLACE FUNCTION pulse_report_frozen_guard() RETURNS trigger AS $$
DECLARE opening_xid text;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN RETURN OLD; END IF;
   IF TG_TABLE_NAME = 'survey_report_participants' THEN
     IF NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id AND tenant_id = OLD.tenant_id) THEN RETURN OLD; END IF;
   END IF;
   IF TG_TABLE_NAME = 'survey_report_scope_memberships' THEN
     IF NOT EXISTS (SELECT 1 FROM survey_report_participants WHERE id = OLD.participant_id) THEN RETURN OLD; END IF;
   END IF;
   RAISE EXCEPTION 'pulse_report_frozen_delete';
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF TG_TABLE_NAME = 'survey_report_participants' THEN
     IF (to_jsonb(NEW) - ARRAY['collection_stopped_at','collection_stop_cause','collection_stop_mutation_id']) = (to_jsonb(OLD) - ARRAY['collection_stopped_at','collection_stop_cause','collection_stop_mutation_id'])
       AND (OLD.collection_stopped_at IS NULL OR (NEW.collection_stopped_at IS NOT NULL AND (NEW.collection_stopped_at < OLD.collection_stopped_at OR (NEW.collection_stopped_at = OLD.collection_stopped_at AND NEW.collection_stop_cause = OLD.collection_stop_cause AND NEW.collection_stop_mutation_id = OLD.collection_stop_mutation_id)))) THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'pulse_report_frozen_update';
 END IF;
 SELECT xmin::text INTO opening_xid FROM survey_report_cycle_openings WHERE tenant_id = NEW.tenant_id AND cycle_scoring_policy_id = NEW.cycle_scoring_policy_id;
 IF opening_xid IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'pulse_report_snapshot_sealed'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
