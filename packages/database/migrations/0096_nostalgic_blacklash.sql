CREATE TABLE IF NOT EXISTS "pulse_tenant_definition_resources" (
	"tenant_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"version" text NOT NULL,
	"source_hash" text NOT NULL,
	"text_hash" text NOT NULL,
	"texts" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pulse_tenant_definition_resources_tenant_id_locale_version_source_hash_pk" PRIMARY KEY("tenant_id","locale","version","source_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_tenant_definition_resources" ADD CONSTRAINT "pulse_tenant_definition_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TRIGGER pulse_tenant_definition_resource_immutable BEFORE UPDATE ON pulse_tenant_definition_resources FOR EACH ROW EXECUTE FUNCTION pulse_language_resource_immutable();
