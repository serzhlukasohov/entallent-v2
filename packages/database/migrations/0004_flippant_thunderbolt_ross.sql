CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"retention_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"safety_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proactive_messaging_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"survey_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone,
	CONSTRAINT "workspace_connections_channel_type_external_workspace_id_unique" UNIQUE("channel_type","external_workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"preferred_name" text,
	"timezone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"communication_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proactive_messaging_enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours" jsonb DEFAULT '{"enabled":false}'::jsonb NOT NULL,
	"onboarding_status" text DEFAULT 'pending' NOT NULL,
	"consent_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"external_workspace_id" text NOT NULL,
	"external_user_id" text NOT NULL,
	"display_name" text,
	"profile_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_channel_type_external_workspace_id_external_user_id_unique" UNIQUE("channel_type","external_workspace_id","external_user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" text NOT NULL,
	"external_conversation_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone,
	"active_topic" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_tenant_id_channel_type_external_conversation_id_unique" UNIQUE("tenant_id","channel_type","external_conversation_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"sender_type" text NOT NULL,
	"external_message_id" text,
	"external_thread_id" text,
	"text" text NOT NULL,
	"normalized_text" text,
	"message_type" text DEFAULT 'text' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"trace_id" text,
	"prompt_version" text,
	"model" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"canonical_key" text,
	"content" text NOT NULL,
	"structured_value" jsonb,
	"confidence" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"importance" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"source_type" text DEFAULT 'extraction' NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_confirmed_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"extractor_version" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"target_date" timestamp with time zone,
	"source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"next_check_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"evidence_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recommended_action" text,
	"policy_version" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"type" text NOT NULL,
	"intent" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"allowed_window_start" timestamp with time zone,
	"allowed_window_end" timestamp with time zone,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"relevance_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cancellation_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"deduplication_key" text,
	"source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_actions_dedup_key_unique" UNIQUE("deduplication_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"score" numeric(4, 2),
	"confidence" numeric(3, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"reasoning_summary" text,
	"evidence_ids" uuid[] DEFAULT '{}' NOT NULL,
	"evaluator_version" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
	"evidence_summary" text NOT NULL,
	"polarity" text NOT NULL,
	"strength" numeric(3, 2) NOT NULL,
	"completeness" numeric(3, 2) NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"evaluator_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"title" text NOT NULL,
	"canonical_meaning" text NOT NULL,
	"dimension" text NOT NULL,
	"evidence_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"positive_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"probe_strategies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contraindications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_threshold" numeric(3, 2) DEFAULT '0.75' NOT NULL,
	"completeness_threshold" numeric(3, 2) DEFAULT '0.70' NOT NULL,
	"minimum_evidence_count" integer DEFAULT 2 NOT NULL,
	"cooldown_days" integer DEFAULT 7 NOT NULL,
	"max_follow_up_probes" integer DEFAULT 3 NOT NULL,
	"scoring_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"question_group" text DEFAULT 'autonomy' NOT NULL,
	"response_type" text DEFAULT 'open_ended' NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	CONSTRAINT "survey_questions_survey_definition_id_stable_key_unique" UNIQUE("survey_definition_id","stable_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"survey_definition_id" uuid NOT NULL,
	"period_type" text DEFAULT 'quarter' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"task_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_token_count" integer,
	"output_token_count" integer,
	"latency_ms" integer,
	"estimated_cost" numeric(10, 6),
	"status" text DEFAULT 'success' NOT NULL,
	"trace_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"content_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"model_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_key_version_unique" UNIQUE("key","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"tenant_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percentage" integer DEFAULT 100 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"manager_slack_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survey_group_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question_group" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"ai_summary" text,
	"employee_score" numeric(5, 2),
	"personal_recs" jsonb,
	"confirmed_at" timestamp with time zone,
	"report_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_group_states_window_user_group_key" UNIQUE("survey_window_id","user_id","question_group")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pulse_backlog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"survey_window_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ignore_count" integer DEFAULT 0 NOT NULL,
	"proactive_sent_at" timestamp with time zone,
	"evidence_captured_count" integer DEFAULT 0 NOT NULL,
	"resulted_in_coverage" boolean,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pulse_backlog_window_user_question_key" UNIQUE("survey_window_id","user_id","survey_question_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_style_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dimensions" jsonb DEFAULT '{"register":0.5,"humor":0.3,"verbosity":0.5,"emoji":0.2}'::jsonb NOT NULL,
	"phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"adaptation_weight" numeric(4, 3) DEFAULT '0' NOT NULL,
	"conversations_analyzed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_style_profiles_user_tenant_key" UNIQUE("user_id","tenant_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_connections" ADD CONSTRAINT "workspace_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_superseded_by_id_memory_items_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."memory_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_goals" ADD CONSTRAINT "user_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_assessments" ADD CONSTRAINT "survey_assessments_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_assessments" ADD CONSTRAINT "survey_assessments_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_definitions" ADD CONSTRAINT "survey_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_evidence" ADD CONSTRAINT "survey_evidence_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_evidence" ADD CONSTRAINT "survey_evidence_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_evidence" ADD CONSTRAINT "survey_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_windows" ADD CONSTRAINT "survey_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_windows" ADD CONSTRAINT "survey_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_windows" ADD CONSTRAINT "survey_windows_survey_definition_id_survey_definitions_id_fk" FOREIGN KEY ("survey_definition_id") REFERENCES "public"."survey_definitions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_group_states" ADD CONSTRAINT "survey_group_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_backlog" ADD CONSTRAINT "pulse_backlog_survey_window_id_survey_windows_id_fk" FOREIGN KEY ("survey_window_id") REFERENCES "public"."survey_windows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_backlog" ADD CONSTRAINT "pulse_backlog_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_backlog" ADD CONSTRAINT "pulse_backlog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_backlog" ADD CONSTRAINT "pulse_backlog_survey_question_id_survey_questions_id_fk" FOREIGN KEY ("survey_question_id") REFERENCES "public"."survey_questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_style_profiles" ADD CONSTRAINT "user_style_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_style_profiles" ADD CONSTRAINT "user_style_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_occurred_at_idx" ON "messages" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_external_message_id_idx" ON "messages" USING btree ("external_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_items_user_category_idx" ON "memory_items" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_items_status_idx" ON "memory_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_items_canonical_key_idx" ON "memory_items" USING btree ("user_id","canonical_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_goals_user_status_idx" ON "user_goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_signals_user_status_idx" ON "risk_signals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_signals_severity_idx" ON "risk_signals" USING btree ("severity","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_actions_user_status_idx" ON "scheduled_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_actions_due_at_idx" ON "scheduled_actions" USING btree ("due_at","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_evidence_window_question_idx" ON "survey_evidence" USING btree ("survey_window_id","survey_question_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_runs_tenant_task_type_idx" ON "llm_runs" USING btree ("tenant_id","task_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_runs_trace_id_idx" ON "llm_runs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_runs_created_at_idx" ON "llm_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "survey_group_states_user_idx" ON "survey_group_states" USING btree ("user_id","question_group");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pulse_backlog_user_window_idx" ON "pulse_backlog" USING btree ("user_id","survey_window_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pulse_backlog_status_idx" ON "pulse_backlog" USING btree ("survey_window_id","user_id","status","position");