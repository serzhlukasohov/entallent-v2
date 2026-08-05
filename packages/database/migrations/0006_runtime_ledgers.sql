CREATE TABLE IF NOT EXISTS "runtime_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"event_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"runtime_attempt" integer NOT NULL,
	"trace_id" text NOT NULL,
	"runtime_mode" text NOT NULL,
	"phase" text DEFAULT 'started' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_attempts_durable_attempt_unique" UNIQUE("tenant_id","request_id","event_id","message_id","runtime_attempt")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runtime_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"runtime_attempt_id" uuid NOT NULL,
	"action_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"action_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"validation_result" jsonb NOT NULL,
	"execution_status" text NOT NULL,
	"commit_marker" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_actions_attempt_action_id_unique" UNIQUE("runtime_attempt_id","action_id"),
	CONSTRAINT "runtime_actions_attempt_idempotency_unique" UNIQUE("runtime_attempt_id","idempotency_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_attempts" ADD CONSTRAINT "runtime_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_attempts" ADD CONSTRAINT "runtime_attempts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_actions" ADD CONSTRAINT "runtime_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_actions" ADD CONSTRAINT "runtime_actions_runtime_attempt_id_runtime_attempts_id_fk" FOREIGN KEY ("runtime_attempt_id") REFERENCES "public"."runtime_attempts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_attempts_trace_id_idx" ON "runtime_attempts" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_attempts_message_id_idx" ON "runtime_attempts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_attempts_request_event_idx" ON "runtime_attempts" USING btree ("request_id","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_attempts_phase_idx" ON "runtime_attempts" USING btree ("phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_actions_tenant_action_idx" ON "runtime_actions" USING btree ("tenant_id","action_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_actions_attempt_id_idx" ON "runtime_actions" USING btree ("runtime_attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_actions_idempotency_key_idx" ON "runtime_actions" USING btree ("idempotency_key");