CREATE TABLE IF NOT EXISTS "conversation_job_admissions" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"external_workspace_id" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"event_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"trace_id" uuid NOT NULL,
	"queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_job_admissions_workspace_nonempty" CHECK (btrim("conversation_job_admissions"."external_workspace_id") <> ''),
	CONSTRAINT "conversation_job_admissions_conversation_nonempty" CHECK (btrim("conversation_job_admissions"."external_conversation_id") <> '')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_job_admissions" ADD CONSTRAINT "conversation_job_admissions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_job_admissions" ADD CONSTRAINT "conversation_job_admissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_job_admissions" ADD CONSTRAINT "conversation_job_admissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_job_admissions" ADD CONSTRAINT "conversation_job_admissions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_job_admissions_pending_idx" ON "conversation_job_admissions" USING btree ("created_at") WHERE "conversation_job_admissions"."queued_at" is null;