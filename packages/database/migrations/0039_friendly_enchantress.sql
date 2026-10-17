CREATE TABLE IF NOT EXISTS "conversation_dispatch_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_dispatch_intents_target_unique" UNIQUE("inbound_message_id","kind","target_id"),
	CONSTRAINT "conversation_dispatch_intents_kind_check" CHECK ("conversation_dispatch_intents"."kind" in (
    'message_send', 'memory_extraction', 'style_analysis', 'survey_evidence',
    'profile_hydration', 'follow_up_execution'
  ))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_turn_effects" (
	"inbound_message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turn_effects_outbound_unique" UNIQUE("outbound_message_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_dispatch_intents" ADD CONSTRAINT "conversation_dispatch_intents_inbound_message_id_conversation_turn_effects_inbound_message_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."conversation_turn_effects"("inbound_message_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_effects" ADD CONSTRAINT "conversation_turn_effects_inbound_message_id_conversation_job_admissions_message_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."conversation_job_admissions"("message_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_effects" ADD CONSTRAINT "conversation_turn_effects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_effects" ADD CONSTRAINT "conversation_turn_effects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_effects" ADD CONSTRAINT "conversation_turn_effects_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_effects" ADD CONSTRAINT "conversation_turn_effects_outbound_message_id_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_dispatch_intents_due_idx" ON "conversation_dispatch_intents" USING btree ("available_at");
--> statement-breakpoint
CREATE FUNCTION conversation_turn_effect_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'conversation_turn_effect_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS DISTINCT FROM NEW THEN
      RAISE EXCEPTION 'conversation_turn_effect_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM conversation_job_admissions admission
    JOIN messages inbound ON inbound.id = admission.message_id
    JOIN conversations owner ON owner.id = admission.conversation_id
    JOIN messages outbound ON outbound.id = NEW.outbound_message_id
    WHERE admission.message_id = NEW.inbound_message_id
      AND admission.tenant_id = NEW.tenant_id
      AND admission.user_id = NEW.user_id
      AND admission.conversation_id = NEW.conversation_id
      AND inbound.tenant_id = NEW.tenant_id
      AND inbound.user_id = NEW.user_id
      AND inbound.conversation_id = NEW.conversation_id
      AND inbound.direction = 'inbound' AND inbound.deleted_at IS NULL
      AND owner.tenant_id = NEW.tenant_id AND owner.user_id = NEW.user_id
      AND outbound.tenant_id = NEW.tenant_id
      AND outbound.user_id = NEW.user_id
      AND outbound.conversation_id = NEW.conversation_id
      AND outbound.direction = 'outbound' AND outbound.deleted_at IS NULL
      AND outbound.metadata->>'sourceInboundMessageId' = NEW.inbound_message_id::text
  ) THEN
    RAISE EXCEPTION 'conversation_turn_effect_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_turn_effect_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON conversation_turn_effects
  FOR EACH ROW EXECUTE FUNCTION conversation_turn_effect_guard();
--> statement-breakpoint
CREATE FUNCTION conversation_dispatch_intent_guard() RETURNS trigger AS $$
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
  ELSIF NEW.target_id <> NEW.inbound_message_id THEN
    RAISE EXCEPTION 'conversation_dispatch_intent_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER conversation_dispatch_intent_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON conversation_dispatch_intents
  FOR EACH ROW EXECUTE FUNCTION conversation_dispatch_intent_guard();
