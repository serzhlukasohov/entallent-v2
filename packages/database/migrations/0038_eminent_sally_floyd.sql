CREATE TABLE IF NOT EXISTS "survey_question_verdict_receipts" (
	"inbound_message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"question_group" text NOT NULL,
	"verdict_kind" text NOT NULL,
	"bundle_id" uuid,
	"working_insight_id" uuid,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_question_verdict_receipts_target_kind_check" CHECK ((
      "survey_question_verdict_receipts"."verdict_kind" IN ('agree', 'partial', 'reject') AND "survey_question_verdict_receipts"."bundle_id" IS NOT NULL AND "survey_question_verdict_receipts"."working_insight_id" IS NULL
    ) OR (
      "survey_question_verdict_receipts"."verdict_kind" IN ('clarified', 'declined') AND "survey_question_verdict_receipts"."bundle_id" IS NULL AND "survey_question_verdict_receipts"."working_insight_id" IS NOT NULL
    ))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_inbound_message_id_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_bundle_id_survey_question_confirmation_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."survey_question_confirmation_bundles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_question_verdict_receipts" ADD CONSTRAINT "survey_question_verdict_receipts_working_insight_id_survey_question_working_insights_id_fk" FOREIGN KEY ("working_insight_id") REFERENCES "public"."survey_question_working_insights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE FUNCTION survey_question_verdict_receipt_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'survey_question_verdict_receipt_immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD IS DISTINCT FROM NEW THEN
      RAISE EXCEPTION 'survey_question_verdict_receipt_immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM messages inbound
    JOIN conversations owner ON owner.id = inbound.conversation_id
    WHERE inbound.id = NEW.inbound_message_id
      AND inbound.tenant_id = NEW.tenant_id
      AND inbound.user_id = NEW.user_id
      AND inbound.conversation_id = NEW.conversation_id
      AND inbound.direction = 'inbound'
      AND inbound.deleted_at IS NULL
      AND owner.tenant_id = NEW.tenant_id
      AND owner.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'survey_question_verdict_receipt_scope_mismatch';
  END IF;

  IF NEW.bundle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM survey_question_confirmation_bundles bundle
      JOIN messages prompt ON prompt.id = bundle.prompt_message_id
      WHERE bundle.id = NEW.bundle_id
        AND bundle.tenant_id = NEW.tenant_id
        AND bundle.user_id = NEW.user_id
        AND bundle.question_group = NEW.question_group
        AND prompt.tenant_id = NEW.tenant_id
        AND prompt.user_id = NEW.user_id
        AND prompt.conversation_id = NEW.conversation_id
        AND prompt.direction = 'outbound'
    ) THEN
      RAISE EXCEPTION 'survey_question_verdict_receipt_scope_mismatch';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM survey_question_working_insights working
      JOIN survey_question_confirmation_bundles bundle ON bundle.id = working.confirmation_bundle_id
      JOIN messages prompt ON prompt.id = bundle.prompt_message_id
      WHERE working.id = NEW.working_insight_id
        AND working.tenant_id = NEW.tenant_id
        AND working.user_id = NEW.user_id
        AND bundle.tenant_id = NEW.tenant_id
        AND bundle.user_id = NEW.user_id
        AND bundle.question_group = NEW.question_group
        AND prompt.tenant_id = NEW.tenant_id
        AND prompt.user_id = NEW.user_id
        AND prompt.conversation_id = NEW.conversation_id
        AND prompt.direction = 'outbound'
    ) THEN
      RAISE EXCEPTION 'survey_question_verdict_receipt_scope_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER survey_question_verdict_receipt_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON survey_question_verdict_receipts
  FOR EACH ROW EXECUTE FUNCTION survey_question_verdict_receipt_guard();
