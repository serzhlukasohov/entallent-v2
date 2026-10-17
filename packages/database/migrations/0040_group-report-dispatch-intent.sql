ALTER TABLE conversation_dispatch_intents
  DROP CONSTRAINT conversation_dispatch_intents_kind_check;
--> statement-breakpoint
ALTER TABLE conversation_dispatch_intents
  ADD CONSTRAINT conversation_dispatch_intents_kind_check CHECK (kind IN (
    'message_send', 'memory_extraction', 'style_analysis', 'survey_evidence',
    'profile_hydration', 'follow_up_execution', 'group_report'
  ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_dispatch_intent_guard() RETURNS trigger AS $$
DECLARE
  turn_effect conversation_turn_effects%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.id, OLD.inbound_message_id, OLD.kind, OLD.target_id,
        OLD.available_at, OLD.created_at) IS DISTINCT FROM
       (NEW.id, NEW.inbound_message_id, NEW.kind, NEW.target_id,
        NEW.available_at, NEW.created_at)
       OR NEW.last_queued_at IS NULL
       OR (OLD.last_queued_at IS NOT NULL AND NEW.last_queued_at < OLD.last_queued_at) THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO turn_effect FROM conversation_turn_effects
    WHERE inbound_message_id = NEW.inbound_message_id;
  IF NOT FOUND OR NEW.last_queued_at IS NOT NULL THEN
    RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
  END IF;
  IF NEW.kind = 'message_send' THEN
    IF NEW.target_id <> turn_effect.outbound_message_id THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
    END IF;
  ELSIF NEW.kind = 'follow_up_execution' THEN
    IF NOT EXISTS (
      SELECT 1 FROM scheduled_actions action
      WHERE action.id = NEW.target_id
        AND action.tenant_id = turn_effect.tenant_id
        AND action.user_id = turn_effect.user_id
        AND action.conversation_id = turn_effect.conversation_id
        AND turn_effect.inbound_message_id = ANY(action.source_message_ids)
    ) THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
    END IF;
  ELSIF NEW.kind = 'group_report' THEN
    IF NOT EXISTS (
      SELECT 1 FROM survey_group_states state
      JOIN survey_windows cycle_window ON cycle_window.id = state.survey_window_id
      JOIN survey_reporting_cohorts cohort ON cohort.id = cycle_window.reporting_cohort_id
      WHERE state.id = NEW.target_id
        AND state.tenant_id = turn_effect.tenant_id
        AND state.user_id = turn_effect.user_id
        AND state.confirmation_message_id = turn_effect.inbound_message_id
        AND state.status = 'confirmed'
        AND cycle_window.tenant_id = turn_effect.tenant_id
        AND cycle_window.user_id = turn_effect.user_id
        AND cycle_window.reporting_team_id = cohort.team_id
        AND cohort.tenant_id = turn_effect.tenant_id
        AND turn_effect.user_id = ANY(cohort.roster_user_ids)
    ) THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
    END IF;
  ELSIF NEW.target_id <> NEW.inbound_message_id THEN
    RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
