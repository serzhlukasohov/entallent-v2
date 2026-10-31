CREATE TABLE IF NOT EXISTS "pulse_report_activation_controls" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"revision" integer NOT NULL,
	"approval_reference" text NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "pulse_activation_mode" CHECK ("pulse_report_activation_controls"."mode" IN ('off', 'observe', 'deliver')),
	CONSTRAINT "pulse_activation_deliver_expiry" CHECK ("pulse_report_activation_controls"."mode" <> 'deliver' OR "pulse_report_activation_controls"."expires_at" IS NOT NULL),
	CONSTRAINT "pulse_activation_revision" CHECK ("pulse_report_activation_controls"."revision" > 0),
	CONSTRAINT "pulse_activation_approval" CHECK (length(btrim("pulse_report_activation_controls"."approval_reference")) > 0 AND length(btrim("pulse_report_activation_controls"."updated_by")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pulse_report_activation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"operator" text NOT NULL,
	"approval_reference" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "pulse_activation_event_revision" UNIQUE("tenant_id","revision"),
	CONSTRAINT "pulse_activation_event_revision_positive" CHECK ("pulse_report_activation_events"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pulse_report_activation_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"org_team_id" uuid,
	"approved_recipient_person_id" uuid,
	CONSTRAINT "pulse_activation_scope_kind" CHECK (("pulse_report_activation_scopes"."kind" = 'team' AND "pulse_report_activation_scopes"."org_team_id" IS NOT NULL) OR ("pulse_report_activation_scopes"."kind" = 'manager_overall' AND "pulse_report_activation_scopes"."org_team_id" IS NULL))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_report_activation_controls" ADD CONSTRAINT "pulse_report_activation_controls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_report_activation_scopes" ADD CONSTRAINT "pulse_activation_scope_control_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."pulse_report_activation_controls"("tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_report_activation_scopes" ADD CONSTRAINT "pulse_activation_scope_recipient_fk" FOREIGN KEY ("approved_recipient_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pulse_activation_scope_identity" ON "pulse_report_activation_scopes" USING btree ("tenant_id","org_unit_id","kind",coalesce("org_team_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_activation_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'pulse_report_activation_events_append_only' USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pulse_report_activation_events_append_only ON pulse_report_activation_events;
--> statement-breakpoint
CREATE TRIGGER pulse_report_activation_events_append_only BEFORE UPDATE OR DELETE ON pulse_report_activation_events FOR EACH ROW EXECUTE FUNCTION pulse_report_activation_events_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS pulse_report_activation_events_no_truncate ON pulse_report_activation_events;
--> statement-breakpoint
CREATE TRIGGER pulse_report_activation_events_no_truncate BEFORE TRUNCATE ON pulse_report_activation_events FOR EACH STATEMENT EXECUTE FUNCTION pulse_report_activation_events_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_report_activation_scope_recipient_tenant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.approved_recipient_person_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.approved_recipient_person_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'pulse_activation_scope_recipient_tenant' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pulse_report_activation_scope_recipient_tenant ON pulse_report_activation_scopes;
--> statement-breakpoint
CREATE TRIGGER pulse_report_activation_scope_recipient_tenant BEFORE INSERT OR UPDATE OF approved_recipient_person_id, tenant_id ON pulse_report_activation_scopes FOR EACH ROW EXECUTE FUNCTION pulse_report_activation_scope_recipient_tenant();
--> statement-breakpoint
-- The operator script replaces scope rows (delete/insert) and never updates them, so a recipient nulled by
-- UPDATE is the people FK SET NULL action: audit it as a system change and bump the control revision.
CREATE OR REPLACE FUNCTION pulse_report_activation_recipient_erased() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c pulse_report_activation_controls%ROWTYPE; scopes_after jsonb; scopes_before jsonb;
BEGIN
  UPDATE pulse_report_activation_controls SET revision = revision + 1, updated_by = 'system:recipient_erased', updated_at = clock_timestamp()
    WHERE tenant_id = NEW.tenant_id RETURNING * INTO c;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'orgUnitId', org_unit_id, 'orgTeamId', org_team_id, 'approvedRecipientPersonId', approved_recipient_person_id) ORDER BY kind, org_unit_id, org_team_id NULLS FIRST), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'orgUnitId', org_unit_id, 'orgTeamId', org_team_id, 'approvedRecipientPersonId', CASE WHEN id = NEW.id THEN OLD.approved_recipient_person_id ELSE approved_recipient_person_id END) ORDER BY kind, org_unit_id, org_team_id NULLS FIRST), '[]'::jsonb)
    INTO scopes_after, scopes_before FROM pulse_report_activation_scopes WHERE tenant_id = NEW.tenant_id;
  INSERT INTO pulse_report_activation_events(tenant_id, revision, operator, approval_reference, before, after) VALUES (
    NEW.tenant_id, c.revision, 'system:recipient_erased', 'system:people_fk_set_null',
    jsonb_build_object('mode', c.mode, 'revision', c.revision - 1, 'approvalReference', c.approval_reference, 'expiresAt', c.expires_at, 'scopes', scopes_before),
    jsonb_build_object('mode', c.mode, 'revision', c.revision, 'approvalReference', c.approval_reference, 'expiresAt', c.expires_at, 'scopes', scopes_after));
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS pulse_report_activation_recipient_erased ON pulse_report_activation_scopes;
--> statement-breakpoint
CREATE TRIGGER pulse_report_activation_recipient_erased AFTER UPDATE OF approved_recipient_person_id ON pulse_report_activation_scopes FOR EACH ROW WHEN (OLD.approved_recipient_person_id IS NOT NULL AND NEW.approved_recipient_person_id IS NULL) EXECUTE FUNCTION pulse_report_activation_recipient_erased();
