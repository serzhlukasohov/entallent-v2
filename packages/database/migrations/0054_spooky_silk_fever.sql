CREATE TABLE IF NOT EXISTS "conversation_turn_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"inbound_message_id" uuid NOT NULL,
	"outbound_message_id" uuid,
	"trace_id" text,
	"status" text NOT NULL,
	"schema_version" integer NOT NULL,
	"payload_encrypted" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turn_traces_status_check" CHECK ("conversation_turn_traces"."status" in ('completed', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_traces" ADD CONSTRAINT "conversation_turn_traces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_traces" ADD CONSTRAINT "conversation_turn_traces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_traces" ADD CONSTRAINT "conversation_turn_traces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_turn_traces" ADD CONSTRAINT "conversation_turn_traces_inbound_message_id_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_traces_tenant_conversation_idx" ON "conversation_turn_traces" USING btree ("tenant_id","conversation_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_traces_tenant_inbound_idx" ON "conversation_turn_traces" USING btree ("tenant_id","inbound_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_traces_tenant_outbound_idx" ON "conversation_turn_traces" USING btree ("tenant_id","outbound_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_turn_traces_created_at_idx" ON "conversation_turn_traces" USING btree ("created_at");