-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

--> statement-breakpoint

-- Tenants
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "retention_policy" jsonb DEFAULT '{}' NOT NULL,
  "safety_policy" jsonb DEFAULT '{}' NOT NULL,
  "proactive_messaging_policy" jsonb DEFAULT '{}' NOT NULL,
  "survey_configuration" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Workspace connections
CREATE TABLE IF NOT EXISTS "workspace_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "channel_type" text NOT NULL,
  "external_workspace_id" text NOT NULL,
  "encrypted_credentials" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "scopes" jsonb DEFAULT '[]' NOT NULL,
  "installed_at" timestamptz DEFAULT now() NOT NULL,
  "last_validated_at" timestamptz,
  CONSTRAINT "workspace_connections_channel_type_external_workspace_id_unique" UNIQUE("channel_type","external_workspace_id")
);
--> statement-breakpoint

-- Users
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'active' NOT NULL,
  "preferred_name" text,
  "timezone" text,
  "locale" text DEFAULT 'en' NOT NULL,
  "communication_preferences" jsonb DEFAULT '{}' NOT NULL,
  "proactive_messaging_enabled" boolean DEFAULT true NOT NULL,
  "quiet_hours" jsonb DEFAULT '{"enabled":false}' NOT NULL,
  "onboarding_status" text DEFAULT 'pending' NOT NULL,
  "consent_state" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "users"("tenant_id");
--> statement-breakpoint

-- Channel accounts
CREATE TABLE IF NOT EXISTS "channel_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "channel_type" text NOT NULL,
  "external_workspace_id" text NOT NULL,
  "external_user_id" text NOT NULL,
  "display_name" text,
  "profile_metadata" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "channel_accounts_channel_type_external_workspace_id_external_user_id_unique" UNIQUE("channel_type","external_workspace_id","external_user_id")
);
--> statement-breakpoint

-- Conversations
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel_type" text NOT NULL,
  "external_conversation_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_message_at" timestamptz,
  "active_topic" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "conversations_tenant_id_channel_type_external_conversation_id_unique" UNIQUE("tenant_id","channel_type","external_conversation_id")
);
--> statement-breakpoint

-- Messages
CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "sender_type" text NOT NULL,
  "external_message_id" text,
  "external_thread_id" text,
  "text" text NOT NULL,
  "normalized_text" text,
  "message_type" text DEFAULT 'text' NOT NULL,
  "metadata" jsonb DEFAULT '{}' NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz,
  "sent_at" timestamptz,
  "trace_id" text,
  "prompt_version" text,
  "model" text,
  "deleted_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX IF NOT EXISTS "messages_user_id_idx" ON "messages"("user_id");
CREATE INDEX IF NOT EXISTS "messages_occurred_at_idx" ON "messages"("occurred_at");
CREATE INDEX IF NOT EXISTS "messages_external_message_id_idx" ON "messages"("external_message_id");
--> statement-breakpoint

-- Memory items
CREATE TABLE IF NOT EXISTS "memory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "canonical_key" text,
  "content" text NOT NULL,
  "structured_value" jsonb,
  "confidence" numeric(3,2) DEFAULT '0.80' NOT NULL,
  "importance" numeric(3,2) DEFAULT '0.50' NOT NULL,
  "sensitivity" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
  "source_type" text DEFAULT 'extraction' NOT NULL,
  "valid_from" timestamptz DEFAULT now() NOT NULL,
  "valid_until" timestamptz,
  "expires_at" timestamptz,
  "last_confirmed_at" timestamptz,
  "superseded_by_id" uuid REFERENCES "memory_items"("id"),
  "extractor_version" text,
  "prompt_version" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "memory_items_user_category_idx" ON "memory_items"("user_id","category");
CREATE INDEX IF NOT EXISTS "memory_items_status_idx" ON "memory_items"("status");
CREATE INDEX IF NOT EXISTS "memory_items_canonical_key_idx" ON "memory_items"("user_id","canonical_key");
--> statement-breakpoint

-- User goals
CREATE TABLE IF NOT EXISTS "user_goals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'general' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "target_date" timestamptz,
  "source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
  "confidence" numeric(3,2) DEFAULT '0.80' NOT NULL,
  "next_check_in_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_goals_user_status_idx" ON "user_goals"("user_id","status");
--> statement-breakpoint

-- Risk signals
CREATE TABLE IF NOT EXISTS "risk_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "severity" text NOT NULL,
  "confidence" numeric(3,2) NOT NULL,
  "evidence_message_ids" uuid[] DEFAULT '{}' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "recommended_action" text,
  "policy_version" text,
  "detected_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_at" timestamptz,
  "resolved_at" timestamptz,
  "expires_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "risk_signals_user_status_idx" ON "risk_signals"("user_id","status");
CREATE INDEX IF NOT EXISTS "risk_signals_severity_idx" ON "risk_signals"("severity","status");
--> statement-breakpoint

-- Scheduled actions
CREATE TABLE IF NOT EXISTS "scheduled_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
  "type" text NOT NULL,
  "intent" text NOT NULL,
  "context" jsonb DEFAULT '{}' NOT NULL,
  "reason" text,
  "due_at" timestamptz NOT NULL,
  "allowed_window_start" timestamptz,
  "allowed_window_end" timestamptz,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "relevance_policy" jsonb DEFAULT '{}' NOT NULL,
  "cancellation_conditions" jsonb DEFAULT '[]' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "last_attempt_at" timestamptz,
  "deduplication_key" text,
  "source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "scheduled_actions_dedup_key_unique" UNIQUE("deduplication_key")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "scheduled_actions_user_status_idx" ON "scheduled_actions"("user_id","status");
CREATE INDEX IF NOT EXISTS "scheduled_actions_due_at_idx" ON "scheduled_actions"("due_at","status");
--> statement-breakpoint

-- Survey definitions
CREATE TABLE IF NOT EXISTS "survey_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "version" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "configuration" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Survey questions
CREATE TABLE IF NOT EXISTS "survey_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_definition_id" uuid NOT NULL REFERENCES "survey_definitions"("id") ON DELETE CASCADE,
  "stable_key" text NOT NULL,
  "title" text NOT NULL,
  "canonical_meaning" text NOT NULL,
  "dimension" text NOT NULL,
  "evidence_requirements" jsonb DEFAULT '{}' NOT NULL,
  "positive_indicators" jsonb DEFAULT '[]' NOT NULL,
  "negative_indicators" jsonb DEFAULT '[]' NOT NULL,
  "probe_strategies" jsonb DEFAULT '[]' NOT NULL,
  "contraindications" jsonb DEFAULT '[]' NOT NULL,
  "confidence_threshold" numeric(3,2) DEFAULT '0.75' NOT NULL,
  "completeness_threshold" numeric(3,2) DEFAULT '0.70' NOT NULL,
  "minimum_evidence_count" integer DEFAULT 2 NOT NULL,
  "cooldown_days" integer DEFAULT 7 NOT NULL,
  "max_follow_up_probes" integer DEFAULT 3 NOT NULL,
  "scoring_configuration" jsonb DEFAULT '{}' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "version" text DEFAULT '1' NOT NULL,
  CONSTRAINT "survey_questions_survey_definition_id_stable_key_unique" UNIQUE("survey_definition_id","stable_key")
);
--> statement-breakpoint

-- Survey windows
CREATE TABLE IF NOT EXISTS "survey_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "survey_definition_id" uuid NOT NULL REFERENCES "survey_definitions"("id") ON DELETE CASCADE,
  "period_type" text DEFAULT 'quarter' NOT NULL,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "coverage" jsonb DEFAULT '{}' NOT NULL,
  "completed_at" timestamptz
);
--> statement-breakpoint

-- Survey evidence
CREATE TABLE IF NOT EXISTS "survey_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_window_id" uuid NOT NULL REFERENCES "survey_windows"("id") ON DELETE CASCADE,
  "survey_question_id" uuid NOT NULL REFERENCES "survey_questions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_message_ids" uuid[] DEFAULT '{}' NOT NULL,
  "evidence_summary" text NOT NULL,
  "polarity" text NOT NULL,
  "strength" numeric(3,2) NOT NULL,
  "completeness" numeric(3,2) NOT NULL,
  "confidence" numeric(3,2) NOT NULL,
  "evaluator_version" text NOT NULL,
  "prompt_version" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "superseded_at" timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "survey_evidence_window_question_idx" ON "survey_evidence"("survey_window_id","survey_question_id");
--> statement-breakpoint

-- Survey assessments
CREATE TABLE IF NOT EXISTS "survey_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "survey_window_id" uuid NOT NULL REFERENCES "survey_windows"("id") ON DELETE CASCADE,
  "survey_question_id" uuid NOT NULL REFERENCES "survey_questions"("id") ON DELETE CASCADE,
  "score" numeric(4,2),
  "confidence" numeric(3,2) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'unknown' NOT NULL,
  "reasoning_summary" text,
  "evidence_ids" uuid[] DEFAULT '{}' NOT NULL,
  "evaluator_version" text NOT NULL,
  "calculated_at" timestamptz DEFAULT now() NOT NULL,
  "reviewed_at" timestamptz
);
--> statement-breakpoint

-- Prompt versions
CREATE TABLE IF NOT EXISTS "prompt_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "version" text NOT NULL,
  "content_hash" text NOT NULL,
  "schema_version" text NOT NULL,
  "model_configuration" jsonb DEFAULT '{}' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "prompt_versions_key_version_unique" UNIQUE("key","version")
);
--> statement-breakpoint

-- LLM runs
CREATE TABLE IF NOT EXISTS "llm_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "task_type" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text,
  "input_token_count" integer,
  "output_token_count" integer,
  "latency_ms" integer,
  "estimated_cost" numeric(10,6),
  "status" text DEFAULT 'success' NOT NULL,
  "trace_id" text,
  "error_code" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "llm_runs_tenant_task_type_idx" ON "llm_runs"("tenant_id","task_type");
CREATE INDEX IF NOT EXISTS "llm_runs_trace_id_idx" ON "llm_runs"("trace_id");
CREATE INDEX IF NOT EXISTS "llm_runs_created_at_idx" ON "llm_runs"("created_at");
--> statement-breakpoint

-- Audit logs (append-only — no FK to allow survival of deleted entities)
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "reason" text,
  "metadata" jsonb DEFAULT '{}' NOT NULL,
  "trace_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_idx" ON "audit_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs"("actor_type","actor_id");
CREATE INDEX IF NOT EXISTS "audit_logs_resource_idx" ON "audit_logs"("resource_type","resource_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
