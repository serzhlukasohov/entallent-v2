-- Custom SQL migration file, put you code below! --
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
       OR (OLD.last_queued_at IS NOT NULL AND NEW.last_queued_at < OLD.last_queued_at)
       OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
       OR (NEW.completed_at IS NOT NULL AND NEW.completed_at < NEW.last_queued_at) THEN
      RAISE EXCEPTION 'conversation_dispatch_intent_immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO turn_effect FROM conversation_turn_effects
    WHERE inbound_message_id = NEW.inbound_message_id;
  IF NOT FOUND OR NEW.last_queued_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
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
  ELSIF NEW.target_id <> NEW.inbound_message_id THEN
    RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
