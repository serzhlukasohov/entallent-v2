CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "rollout_percentage" integer NOT NULL DEFAULT 100,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_tenant_idx" ON "feature_flags"("key", COALESCE("tenant_id"::text, ''));
