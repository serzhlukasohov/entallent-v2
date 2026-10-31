CREATE TABLE IF NOT EXISTS "pulse_analytical_renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"analytical_id" uuid NOT NULL,
	"source_hash" text NOT NULL,
	"locale" text NOT NULL,
	"text" text NOT NULL,
	"support" text NOT NULL,
	"policy_version" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pulse_language_resources" (
	"locale" text NOT NULL,
	"kind" text NOT NULL,
	"version" text NOT NULL,
	"source_hash" text NOT NULL,
	"text_hash" text NOT NULL,
	"texts" jsonb NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pulse_language_resources_locale_kind_version_source_hash_pk" PRIMARY KEY("locale","kind","version","source_hash")
);
--> statement-breakpoint
ALTER TABLE "survey_question_insights" ADD COLUMN "prose_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "survey_question_working_insights" ADD COLUMN "language_capture" jsonb;--> statement-breakpoint
ALTER TABLE "survey_question_working_insights" ADD COLUMN "score_cache" jsonb;--> statement-breakpoint
ALTER TABLE "survey_question_working_insights" ADD COLUMN "score_cache_revision" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_analytical_renditions" ADD CONSTRAINT "pulse_analytical_renditions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_analytical_renditions" ADD CONSTRAINT "pulse_analytical_renditions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_analytical_renditions" ADD CONSTRAINT "pulse_analytical_renditions_analytical_id_survey_question_insights_id_fk" FOREIGN KEY ("analytical_id") REFERENCES "public"."survey_question_insights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_analytical_renditions" ADD CONSTRAINT "pulse_analytical_renditions_user_id_tenant_id_users_id_tenant_id_fk" FOREIGN KEY ("user_id","tenant_id") REFERENCES "public"."users"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pulse_analytical_renditions_identity" ON "pulse_analytical_renditions" USING btree ("tenant_id","analytical_id","source_hash","locale","policy_version");--> statement-breakpoint
CREATE FUNCTION pulse_language_permitted_source(t uuid,i uuid) RETURNS TABLE("tenantId" uuid,"userId" uuid,"analyticalId" uuid,"sourceHash" text,summary text,support text,"sourceLocale" text,"expiresAt" timestamptz) LANGUAGE sql STABLE AS $$
 SELECT q.tenant_id,q.user_id,q.id,encode(sha256(convert_to(q.deidentified_summary||q.summary_support||coalesce(q.prose_provenance::text,'legacy_unverified'),'UTF8')),'hex'),q.deidentified_summary,q.summary_support,q.prose_provenance->>'locale',
 least(q.processed_at+engagement_retention_days(tn.retention_policy)*interval '1 day',coalesce(w.expires_at,'infinity'::timestamptz))
 FROM survey_question_insights q JOIN tenants tn ON tn.id=q.tenant_id JOIN users u ON u.id=q.user_id AND u.tenant_id=q.tenant_id
 LEFT JOIN survey_report_insight_revisions r ON r.insight_id=q.id AND r.tenant_id=q.tenant_id
 LEFT JOIN survey_report_topic_watermarks w ON w.insight_id=q.id
 WHERE q.tenant_id=t AND q.id=i AND q.withdrawn_at IS NULL AND u.deleted_at IS NULL AND u.status<>'deleted'
 AND q.processed_at+engagement_retention_days(tn.retention_policy)*interval '1 day'>now() AND coalesce(w.expires_at,'infinity'::timestamptz)>now()
 AND NOT EXISTS(SELECT 1 FROM survey_reporting_permissions p WHERE p.tenant_id=t AND p.user_id=q.user_id AND p.full_reporting_denied)
 AND NOT EXISTS(SELECT 1 FROM survey_reporting_lineage_exclusions e WHERE e.tenant_id=t AND e.user_id=q.user_id AND e.lineage_id=r.lineage_id)
$$;
--> statement-breakpoint
CREATE FUNCTION pulse_language_resource_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'language_resource_immutable'; END $$;
CREATE TRIGGER pulse_language_resource_immutable BEFORE UPDATE OR DELETE ON pulse_language_resources FOR EACH ROW EXECUTE FUNCTION pulse_language_resource_immutable();
--> statement-breakpoint
CREATE FUNCTION pulse_language_rendition_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE s record; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||NEW.tenant_id::text||':'||NEW.user_id::text,0));
 SELECT * INTO s FROM pulse_language_permitted_source(NEW.tenant_id,NEW.analytical_id);
 IF s IS NULL OR s."userId"<>NEW.user_id OR s."sourceHash"<>NEW.source_hash OR s.support<>NEW.support OR NEW.expires_at>s."expiresAt" OR NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'language_rendition_source_invalid'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_rendition_guard BEFORE INSERT OR UPDATE ON pulse_analytical_renditions FOR EACH ROW EXECUTE FUNCTION pulse_language_rendition_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_language_source_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM pulse_analytical_renditions WHERE analytical_id=OLD.id;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER pulse_language_source_invalidation BEFORE DELETE OR UPDATE OF withdrawn_at,deidentified_summary,summary_support,prose_provenance ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_language_source_invalidation();
--> statement-breakpoint
CREATE FUNCTION pulse_language_subject_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM pulse_analytical_renditions WHERE tenant_id=OLD.tenant_id AND user_id=OLD.id;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER pulse_language_subject_invalidation BEFORE DELETE OR UPDATE OF deleted_at,status ON users FOR EACH ROW EXECUTE FUNCTION pulse_language_subject_invalidation();
--> statement-breakpoint
CREATE FUNCTION pulse_language_permission_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='survey_reporting_permissions' THEN
  IF NEW.full_reporting_denied THEN DELETE FROM pulse_analytical_renditions WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id; END IF;
 ELSE
  DELETE FROM pulse_analytical_renditions d USING survey_report_insight_revisions r WHERE d.analytical_id=r.insight_id AND r.tenant_id=NEW.tenant_id AND r.user_id=NEW.user_id AND r.lineage_id=NEW.lineage_id;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER pulse_language_permission_invalidation AFTER INSERT OR UPDATE ON survey_reporting_permissions FOR EACH ROW EXECUTE FUNCTION pulse_language_permission_invalidation();
CREATE TRIGGER pulse_language_lineage_invalidation AFTER INSERT ON survey_reporting_lineage_exclusions FOR EACH ROW EXECUTE FUNCTION pulse_language_permission_invalidation();
--> statement-breakpoint
CREATE FUNCTION pulse_language_working_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.purged_at IS NOT NULL OR NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
  NEW.score_cache:=NULL; NEW.score_cache_revision:=NULL; NEW.language_capture:=NULL;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER pulse_language_working_lifetime BEFORE UPDATE ON survey_question_working_insights FOR EACH ROW EXECUTE FUNCTION pulse_language_working_lifetime();
--> statement-breakpoint
CREATE FUNCTION pulse_language_retention_invalidation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM pulse_analytical_renditions WHERE tenant_id=NEW.id AND NOT EXISTS(SELECT 1 FROM pulse_language_permitted_source(NEW.id,analytical_id));
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_retention_invalidation AFTER UPDATE OF retention_policy ON tenants FOR EACH ROW EXECUTE FUNCTION pulse_language_retention_invalidation();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION engagement_message_clock_guard() RETURNS trigger AS $$
DECLARE first_ack boolean; erasure boolean;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.persisted_at:=clock_timestamp();
    NEW.delivery_attempted_at:=CASE WHEN NEW.delivery_attempted_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
    NEW.delivery_recorded_at:=CASE WHEN NEW.sent_at IS NOT NULL THEN clock_timestamp() ELSE NULL END;
    NEW.engagement_delivery_proof:=NULL;
    first_ack:=NEW.sent_at IS NOT NULL;
  ELSE
    NEW.persisted_at:=OLD.persisted_at;
    NEW.delivery_attempted_at:=CASE WHEN OLD.delivery_attempted_at IS NULL AND NEW.delivery_attempted_at IS NOT NULL THEN clock_timestamp() ELSE OLD.delivery_attempted_at END;
    first_ack:=OLD.delivery_recorded_at IS NULL AND NEW.sent_at IS NOT NULL;
    NEW.delivery_recorded_at:=CASE WHEN first_ack THEN clock_timestamp() ELSE OLD.delivery_recorded_at END;
    NEW.engagement_delivery_proof:=OLD.engagement_delivery_proof;
    IF OLD.engagement_delivery_proof IS NOT NULL THEN
      erasure:=NEW.deleted_at IS NOT NULL AND NEW.text='[deleted]' AND NEW.normalized_text IS NULL AND NEW.metadata='{}'::jsonb;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.direction IS DISTINCT FROM OLD.direction
        OR NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.external_message_id IS DISTINCT FROM OLD.external_message_id
        OR NEW.external_thread_id IS DISTINCT FROM OLD.external_thread_id
        OR (NOT erasure AND (NEW.text IS DISTINCT FROM OLD.text OR NEW.metadata->'engagementProbe' IS DISTINCT FROM OLD.metadata->'engagementProbe'
          OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL))) THEN
        RAISE EXCEPTION 'engagement_delivered_form_immutable';
      END IF;
    END IF;
  END IF;
  IF first_ack AND NEW.direction='outbound' AND NEW.metadata ? 'engagementProbe' THEN
    -- Whitelist identifiers and hashes; never copy arbitrary metadata or private text.
    NEW.engagement_delivery_proof:=jsonb_build_object(
      'contractVersion',NEW.metadata->'engagementProbe'->>'contractVersion',
      'surveyDefinitionId',NEW.metadata->'engagementProbe'->>'surveyDefinitionId',
      'surveyWindowId',NEW.metadata->'engagementProbe'->>'surveyWindowId',
      'questionId',NEW.metadata->'engagementProbe'->>'questionId',
      'questionVersion',NEW.metadata->'engagementProbe'->>'questionVersion',
      'stableKey',NEW.metadata->'engagementProbe'->>'stableKey',
      'displayedFormHash',NEW.metadata->'engagementProbe'->>'displayedFormHash',
      'actualFormHash',encode(sha256(convert_to(NEW.text,'UTF8')),'hex')) || CASE WHEN NEW.metadata->'engagementProbe' ? 'locale' THEN (NEW.metadata->'engagementProbe') - ARRAY['contractVersion','surveyDefinitionId','surveyWindowId','questionId','questionVersion','stableKey','displayedFormHash'] ELSE '{}'::jsonb END;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;


--> statement-breakpoint
CREATE FUNCTION pulse_language_exact_form_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p jsonb; form text; BEGIN
 p:=NEW.metadata->'engagementProbe';
 IF p IS NULL OR NOT(p ? 'locale') THEN RETURN NEW; END IF;
 SELECT texts->>(p->>'stableKey') INTO form FROM pulse_language_resources WHERE locale=p->>'locale' AND kind='engagement' AND version=p->>'resourceVersion' AND source_hash=p->>'resourceSourceHash';
 IF form IS NULL OR p->>'formTextHash'<>encode(sha256(convert_to(form,'UTF8')),'hex') OR right(NEW.text,length(form))<>form THEN RAISE EXCEPTION 'engagement_form_resource_unavailable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_exact_form_guard BEFORE INSERT OR UPDATE OF text,metadata ON messages FOR EACH ROW EXECUTE FUNCTION pulse_language_exact_form_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_language_dependency_erasure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM pulse_analytical_renditions WHERE analytical_id=OLD.insight_id;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER pulse_language_watermark_erasure BEFORE DELETE OR UPDATE OF expires_at ON survey_report_topic_watermarks FOR EACH ROW EXECUTE FUNCTION pulse_language_dependency_erasure();
CREATE TRIGGER pulse_language_revision_erasure BEFORE DELETE ON survey_report_insight_revisions FOR EACH ROW EXECUTE FUNCTION pulse_language_dependency_erasure();
--> statement-breakpoint
ALTER FUNCTION pulse_publication_payload_purge(uuid,timestamptz) RENAME TO pulse_publication_payload_purge_before_language;
CREATE FUNCTION pulse_publication_payload_purge(t uuid,cutoff timestamptz) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pulse_publication_payload_purge_before_language(t,cutoff);
 DELETE FROM pulse_analytical_renditions d WHERE d.tenant_id=t AND (d.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM pulse_language_permitted_source(t,d.analytical_id)));
 END $$;

--> statement-breakpoint
CREATE FUNCTION pulse_language_disclosure_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE f jsonb; form text; erased boolean; BEGIN
 IF TG_OP='UPDATE' AND OLD.sent_at IS NOT NULL AND OLD.metadata ? 'reportingDisclosureForm' THEN
  erased:=NEW.deleted_at IS NOT NULL AND NEW.text='[deleted]' AND NEW.metadata='{}'::jsonb;
  IF NOT erased AND (NEW.text IS DISTINCT FROM OLD.text OR NEW.metadata->'reportingDisclosureForm' IS DISTINCT FROM OLD.metadata->'reportingDisclosureForm' OR NEW.sent_at IS DISTINCT FROM OLD.sent_at) THEN RAISE EXCEPTION 'disclosure_delivered_form_immutable'; END IF;
 END IF;
 f:=NEW.metadata->'reportingDisclosureForm';
 IF f IS NULL THEN RETURN NEW; END IF;
 IF f->>'locale'='en' THEN form:='If you confirm a de-identified pulse summary, it may contribute only to aggregated team-level recommendations. You can correct it or ask me to exclude it from reporting.';
 ELSE SELECT texts->>'rights' INTO form FROM pulse_language_resources WHERE locale=f->>'locale' AND kind='disclosure' AND version=f->>'version' AND source_hash=f->>'sourceHash'; END IF;
 IF form IS NULL OR f->>'textHash'<>encode(sha256(convert_to(form,'UTF8')),'hex') OR f->>'fullBodyHash'<>encode(sha256(convert_to(NEW.text,'UTF8')),'hex') OR position(form in NEW.text)=0 THEN RAISE EXCEPTION 'disclosure_form_resource_unavailable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_disclosure_guard BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION pulse_language_disclosure_guard();
