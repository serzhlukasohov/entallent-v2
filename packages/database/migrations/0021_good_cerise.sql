CREATE TABLE IF NOT EXISTS "org_oidc_providers" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"issuer_url" text NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_oidc_providers_issuer_https" CHECK ("org_oidc_providers"."issuer_url" LIKE 'https://%'),
	CONSTRAINT "org_oidc_providers_redirect_https" CHECK ("org_oidc_providers"."redirect_uri" LIKE 'https://%'),
	CONSTRAINT "org_oidc_providers_client_id_not_blank" CHECK (length(btrim("org_oidc_providers"."client_id")) > 0),
	CONSTRAINT "org_oidc_providers_status_valid" CHECK ("org_oidc_providers"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_oidc_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"issuer_url" text NOT NULL,
	"subject" text NOT NULL,
	"email_at_link" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "org_oidc_subjects_issuer_https" CHECK ("org_oidc_subjects"."issuer_url" LIKE 'https://%'),
	CONSTRAINT "org_oidc_subjects_subject_not_blank" CHECK (length(btrim("org_oidc_subjects"."subject")) > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_oidc_providers" ADD CONSTRAINT "org_oidc_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_oidc_subjects" ADD CONSTRAINT "org_oidc_subjects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_oidc_subjects" ADD CONSTRAINT "org_oidc_subjects_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_oidc_subjects_tenant_person_idx" ON "org_oidc_subjects" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_oidc_subjects_tenant_issuer_subject_idx" ON "org_oidc_subjects" USING btree ("tenant_id","issuer_url","subject");