CREATE TABLE IF NOT EXISTS "conversation_message_send_attempts" (
	"outbound_message_id" uuid PRIMARY KEY NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_message_send_attempts_inbound_message_id_unique" UNIQUE("inbound_message_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_message_send_attempts" ADD CONSTRAINT "conversation_message_send_attempts_outbound_message_id_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE FUNCTION conversation_message_send_attempt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'conversation_message_send_attempt_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS DISTINCT FROM NEW THEN
      RAISE EXCEPTION 'conversation_message_send_attempt_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversation_turn_effects effect
    JOIN conversation_dispatch_intents intent
      ON intent.inbound_message_id = effect.inbound_message_id
      AND intent.kind = 'message_send'
      AND intent.target_id = effect.outbound_message_id
    JOIN messages outbound ON outbound.id = effect.outbound_message_id
    WHERE effect.inbound_message_id = NEW.inbound_message_id
      AND effect.outbound_message_id = NEW.outbound_message_id
      AND outbound.tenant_id = effect.tenant_id
      AND outbound.user_id = effect.user_id
      AND outbound.conversation_id = effect.conversation_id
      AND outbound.direction = 'outbound'
      AND outbound.deleted_at IS NULL
      AND outbound.sent_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation_message_send_attempt_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_message_send_attempt_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON conversation_message_send_attempts
  FOR EACH ROW EXECUTE FUNCTION conversation_message_send_attempt_guard();
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_message_send_attempts" ADD CONSTRAINT "conversation_message_send_attempts_inbound_message_id_conversation_turn_effects_inbound_message_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."conversation_turn_effects"("inbound_message_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
