ALTER TABLE "risk_signals" ADD COLUMN "source_message_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_tenant_source_unique" UNIQUE("tenant_id","source_message_id");
--> statement-breakpoint
CREATE FUNCTION risk_signal_source_scope_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.source_message_id IS DISTINCT FROM OLD.source_message_id THEN
    RAISE EXCEPTION 'risk_signal_source_immutable';
  END IF;
  IF NEW.source_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM messages source
    WHERE source.id = NEW.source_message_id
      AND source.tenant_id = NEW.tenant_id
      AND source.user_id = NEW.user_id
      AND source.direction = 'inbound'
      AND source.deleted_at IS NULL
  ) OR NOT NEW.source_message_id = ANY(NEW.evidence_message_ids) THEN
    RAISE EXCEPTION 'risk_signal_source_scope_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.evidence_message_ids) evidence_id
    WHERE NOT EXISTS (
      SELECT 1 FROM messages evidence
      WHERE evidence.id = evidence_id
        AND evidence.tenant_id = NEW.tenant_id
        AND evidence.user_id = NEW.user_id
        AND evidence.deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'risk_signal_source_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER risk_signal_source_scope_guard_trigger
  BEFORE INSERT OR UPDATE OF source_message_id, tenant_id, user_id, evidence_message_ids
  ON risk_signals FOR EACH ROW EXECUTE FUNCTION risk_signal_source_scope_guard();
