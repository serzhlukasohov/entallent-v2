-- A later provider-state clear/re-set cannot restamp the first positive acknowledgement receipt.
CREATE OR REPLACE FUNCTION engagement_message_clock_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.persisted_at:=clock_timestamp();
    NEW.delivery_recorded_at:=CASE WHEN NEW.sent_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
  ELSE
    NEW.persisted_at:=OLD.persisted_at;
    IF OLD.delivery_recorded_at IS NULL AND NEW.sent_at IS NOT NULL THEN NEW.delivery_recorded_at:=clock_timestamp();
    ELSE NEW.delivery_recorded_at:=OLD.delivery_recorded_at; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
