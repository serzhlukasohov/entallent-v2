CREATE OR REPLACE FUNCTION enforce_message_conversation_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = NEW.conversation_id
      AND c.tenant_id = NEW.tenant_id
      AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'message_conversation_owner_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_conversation_owner_guard
BEFORE INSERT OR UPDATE OF conversation_id, tenant_id, user_id
ON messages FOR EACH ROW EXECUTE FUNCTION enforce_message_conversation_owner();
