CREATE TABLE IF NOT EXISTS "runtime_shadow_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"runtime_attempt_id" uuid NOT NULL,
	"runtime_mode" text NOT NULL,
	"trace_id" text NOT NULL,
	"runtime_version" text NOT NULL,
	"validation_status" text NOT NULL,
	"redaction_status" text NOT NULL,
	"current_result" jsonb NOT NULL,
	"candidate_result" jsonb NOT NULL,
	"risk_comparison" jsonb NOT NULL,
	"memory_comparison" jsonb NOT NULL,
	"action_comparison" jsonb NOT NULL,
	"validation_details" jsonb NOT NULL,
	"redaction_details" jsonb NOT NULL,
	"latency_ms" integer NOT NULL,
	"model_call_count" integer NOT NULL,
	"tool_call_count" integer NOT NULL,
	"retry_count" integer NOT NULL,
	"estimated_cost" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_shadow_diagnostics_attempt_version_unique" UNIQUE("runtime_attempt_id","runtime_version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_runtime_attempt_id_runtime_attempts_id_fk" FOREIGN KEY ("runtime_attempt_id") REFERENCES "public"."runtime_attempts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_tenant_created_idx" ON "runtime_shadow_diagnostics" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_trace_id_idx" ON "runtime_shadow_diagnostics" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_message_id_idx" ON "runtime_shadow_diagnostics" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_attempt_id_idx" ON "runtime_shadow_diagnostics" USING btree ("runtime_attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_validation_status_idx" ON "runtime_shadow_diagnostics" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runtime_shadow_diagnostics_redaction_status_idx" ON "runtime_shadow_diagnostics" USING btree ("redaction_status");--> statement-breakpoint
ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_runtime_mode_check" CHECK ("runtime_shadow_diagnostics"."runtime_mode" in ('typescript', 'maf_shadow', 'maf_canary', 'maf_disabled'));--> statement-breakpoint
ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_validation_status_check" CHECK ("runtime_shadow_diagnostics"."validation_status" in ('valid', 'invalid', 'comparison_failed'));--> statement-breakpoint
ALTER TABLE "runtime_shadow_diagnostics" ADD CONSTRAINT "runtime_shadow_diagnostics_redaction_status_check" CHECK ("runtime_shadow_diagnostics"."redaction_status" in ('redacted', 'not_required', 'rejected'));
