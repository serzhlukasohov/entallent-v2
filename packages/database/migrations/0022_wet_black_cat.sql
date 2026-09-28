CREATE TABLE IF NOT EXISTS "org_company_admin_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "org_oidc_login_attempts" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"encrypted_nonce" text NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_company_admin_sessions" ADD CONSTRAINT "org_company_admin_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_company_admin_sessions" ADD CONSTRAINT "org_company_admin_sessions_person_id_tenant_id_people_id_tenant_id_fk" FOREIGN KEY ("person_id","tenant_id") REFERENCES "public"."people"("id","tenant_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "org_oidc_login_attempts" ADD CONSTRAINT "org_oidc_login_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_company_admin_sessions_expiry_idx" ON "org_company_admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_oidc_login_attempts_expiry_idx" ON "org_oidc_login_attempts" USING btree ("expires_at");