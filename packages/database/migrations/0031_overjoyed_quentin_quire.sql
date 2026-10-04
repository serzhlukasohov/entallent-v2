CREATE TABLE IF NOT EXISTS "conversation_activity_daily" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"inbound_count" integer DEFAULT 0 NOT NULL,
	"outbound_count" integer DEFAULT 0 NOT NULL,
	"inbound_non_init_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_activity_daily_tenant_id_user_id_day_pk" PRIMARY KEY("tenant_id","user_id","day"),
	CONSTRAINT "conversation_activity_daily_counts_nonnegative" CHECK (
      "conversation_activity_daily"."inbound_count" >= 0 AND "conversation_activity_daily"."outbound_count" >= 0 AND "conversation_activity_daily"."inbound_non_init_count" >= 0
      AND "conversation_activity_daily"."inbound_non_init_count" <= "conversation_activity_daily"."inbound_count")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_activity_daily" ADD CONSTRAINT "conversation_activity_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_activity_daily" ADD CONSTRAINT "conversation_activity_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_activity_daily_tenant_day_idx" ON "conversation_activity_daily" USING btree ("tenant_id","day");
--> statement-breakpoint
INSERT INTO conversation_activity_daily (
  tenant_id, user_id, day, inbound_count, outbound_count, inbound_non_init_count
)
SELECT tenant_id, user_id, (occurred_at AT TIME ZONE 'UTC')::date,
  count(*) FILTER (WHERE direction = 'inbound')::integer,
  count(*) FILTER (WHERE direction = 'outbound')::integer,
  count(*) FILTER (WHERE direction = 'inbound' AND text <> '__init__')::integer
FROM messages
WHERE deleted_at IS NULL AND direction IN ('inbound', 'outbound')
GROUP BY tenant_id, user_id, (occurred_at AT TIME ZONE 'UTC')::date;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_conversation_activity_daily() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  activity_day date;
  inbound_delta integer;
  outbound_delta integer;
  non_init_delta integer;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.deleted_at IS NULL
    AND OLD.direction IN ('inbound', 'outbound') THEN
    activity_day := (OLD.occurred_at AT TIME ZONE 'UTC')::date;
    inbound_delta := CASE WHEN OLD.direction = 'inbound' THEN 1 ELSE 0 END;
    outbound_delta := CASE WHEN OLD.direction = 'outbound' THEN 1 ELSE 0 END;
    non_init_delta := CASE WHEN OLD.direction = 'inbound' AND OLD.text <> '__init__' THEN 1 ELSE 0 END;
    UPDATE conversation_activity_daily
    SET inbound_count = inbound_count - inbound_delta,
        outbound_count = outbound_count - outbound_delta,
        inbound_non_init_count = inbound_non_init_count - non_init_delta
    WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id AND day = activity_day;
    IF NOT FOUND AND TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'conversation_activity_projection_missing';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL
    AND NEW.direction IN ('inbound', 'outbound') THEN
    activity_day := (NEW.occurred_at AT TIME ZONE 'UTC')::date;
    inbound_delta := CASE WHEN NEW.direction = 'inbound' THEN 1 ELSE 0 END;
    outbound_delta := CASE WHEN NEW.direction = 'outbound' THEN 1 ELSE 0 END;
    non_init_delta := CASE WHEN NEW.direction = 'inbound' AND NEW.text <> '__init__' THEN 1 ELSE 0 END;
    INSERT INTO conversation_activity_daily (
      tenant_id, user_id, day, inbound_count, outbound_count, inbound_non_init_count
    ) VALUES (NEW.tenant_id, NEW.user_id, activity_day,
      inbound_delta, outbound_delta, non_init_delta)
    ON CONFLICT (tenant_id, user_id, day) DO UPDATE
    SET inbound_count = conversation_activity_daily.inbound_count + EXCLUDED.inbound_count,
        outbound_count = conversation_activity_daily.outbound_count + EXCLUDED.outbound_count,
        inbound_non_init_count = conversation_activity_daily.inbound_non_init_count
          + EXCLUDED.inbound_non_init_count;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER messages_activity_daily_sync
AFTER INSERT OR UPDATE OF tenant_id, user_id, occurred_at, direction, text, deleted_at OR DELETE
ON messages FOR EACH ROW EXECUTE FUNCTION sync_conversation_activity_daily();
