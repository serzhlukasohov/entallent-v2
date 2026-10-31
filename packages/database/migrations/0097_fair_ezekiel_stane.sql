CREATE TABLE IF NOT EXISTS "pulse_analytical_source_authorities" (
	"analytical_id" uuid PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"native_expires_at" timestamp with time zone,
	"dependency_lost_at" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pulse_analytical_source_authority_kind" CHECK ("pulse_analytical_source_authorities"."source_kind" in ('native','approved_legacy','unknown'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_analytical_source_authorities" ADD CONSTRAINT "pulse_analytical_source_authorities_analytical_id_survey_question_insights_id_fk" FOREIGN KEY ("analytical_id") REFERENCES "public"."survey_question_insights"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

--> statement-breakpoint
CREATE FUNCTION pulse_language_source_kind(i uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE
 WHEN d.version='v2-report-engagement-1.0.0'
   OR EXISTS(SELECT 1 FROM survey_engagement_collection_contracts c WHERE c.tenant_id=q.tenant_id AND c.survey_definition_id=q.survey_definition_id)
   OR EXISTS(SELECT 1 FROM survey_report_window_bindings b WHERE b.tenant_id=q.tenant_id AND b.survey_window_id=q.survey_window_id)
   OR EXISTS(SELECT 1 FROM survey_report_insight_revisions r WHERE r.tenant_id=q.tenant_id AND r.insight_id=q.id)
   OR EXISTS(SELECT 1 FROM survey_report_topic_watermarks w WHERE w.tenant_id=q.tenant_id AND w.insight_id=q.id)
 THEN 'native'
 WHEN d.version='v2-policy-1.0.0' AND EXISTS(
   SELECT 1 FROM survey_windows sw JOIN survey_window_scoring_policies b ON b.survey_window_id=sw.id AND b.tenant_id=sw.tenant_id
   JOIN survey_scoring_policies p ON p.id=b.scoring_policy_id AND p.tenant_id=sw.tenant_id
   WHERE sw.id=q.survey_window_id AND sw.tenant_id=q.tenant_id AND sw.user_id=q.user_id AND sw.survey_definition_id=q.survey_definition_id AND p.version='1.0.0')
 THEN 'approved_legacy' ELSE 'unknown' END
 FROM survey_question_insights q JOIN survey_definitions d ON d.id=q.survey_definition_id WHERE q.id=i
$$;
--> statement-breakpoint
INSERT INTO pulse_analytical_source_authorities(analytical_id,source_kind,native_expires_at,dependency_lost_at)
 SELECT q.id,k.kind,CASE WHEN k.kind='native' THEN w.expires_at ELSE NULL END,
 CASE WHEN k.kind='native' AND (w.insight_id IS NULL OR r.insight_id IS NULL) THEN clock_timestamp() ELSE NULL END
 FROM survey_question_insights q CROSS JOIN LATERAL (SELECT pulse_language_source_kind(q.id) kind) k
 LEFT JOIN survey_report_topic_watermarks w ON w.insight_id=q.id AND w.tenant_id=q.tenant_id
 LEFT JOIN survey_report_insight_revisions r ON r.insight_id=q.id AND r.tenant_id=q.tenant_id;
--> statement-breakpoint
CREATE FUNCTION pulse_language_source_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.analytical_id IS DISTINCT FROM OLD.analytical_id OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
 OR (OLD.source_kind='native' AND NEW.source_kind<>'native')
 OR (OLD.dependency_lost_at IS NOT NULL AND NEW.dependency_lost_at IS DISTINCT FROM OLD.dependency_lost_at)
 OR (OLD.native_expires_at IS NOT NULL AND (NEW.native_expires_at IS NULL OR NEW.native_expires_at>OLD.native_expires_at))
 THEN RAISE EXCEPTION 'language_source_authority_immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_source_authority_guard BEFORE UPDATE ON pulse_analytical_source_authorities FOR EACH ROW EXECUTE FUNCTION pulse_language_source_authority_guard();
--> statement-breakpoint
CREATE FUNCTION pulse_language_source_authority_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='survey_question_insights' THEN
  INSERT INTO pulse_analytical_source_authorities(analytical_id,source_kind) VALUES(NEW.id,coalesce(pulse_language_source_kind(NEW.id),'unknown'));
 ELSE
  UPDATE pulse_analytical_source_authorities SET source_kind='native',native_expires_at=CASE WHEN native_expires_at IS NULL THEN NEW.expires_at ELSE least(native_expires_at,NEW.expires_at) END WHERE analytical_id=NEW.insight_id;
 END IF;
 RETURN NEW; END $$;
CREATE TRIGGER pulse_language_source_authority_capture AFTER INSERT ON survey_question_insights FOR EACH ROW EXECUTE FUNCTION pulse_language_source_authority_capture();
CREATE TRIGGER pulse_language_watermark_authority_capture AFTER INSERT ON survey_report_topic_watermarks FOR EACH ROW EXECUTE FUNCTION pulse_language_source_authority_capture();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_language_dependency_erasure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 -- Update only: parent source/subject cascades may have already removed the authority row.
 UPDATE pulse_analytical_source_authorities SET dependency_lost_at=coalesce(dependency_lost_at,clock_timestamp()) WHERE analytical_id=OLD.insight_id;
 DELETE FROM pulse_analytical_renditions WHERE analytical_id=OLD.insight_id;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pulse_language_permitted_source(t uuid,i uuid) RETURNS TABLE("tenantId" uuid,"userId" uuid,"analyticalId" uuid,"sourceHash" text,summary text,support text,"sourceLocale" text,"expiresAt" timestamptz) LANGUAGE sql STABLE AS $$
 SELECT q.tenant_id,q.user_id,q.id,encode(sha256(convert_to(q.deidentified_summary||q.summary_support||coalesce(q.prose_provenance::text,'legacy_unverified'),'UTF8')),'hex'),q.deidentified_summary,q.summary_support,q.prose_provenance->>'locale',
 CASE WHEN authority.source_kind='native' THEN least(q.processed_at+engagement_retention_days(tn.retention_policy)*interval '1 day',authority.native_expires_at,w.expires_at)
 ELSE q.processed_at+engagement_retention_days(tn.retention_policy)*interval '1 day' END
 FROM survey_question_insights q JOIN tenants tn ON tn.id=q.tenant_id JOIN users u ON u.id=q.user_id AND u.tenant_id=q.tenant_id
 JOIN pulse_analytical_source_authorities authority ON authority.analytical_id=q.id
 LEFT JOIN survey_report_insight_revisions r ON r.insight_id=q.id AND r.tenant_id=q.tenant_id
 LEFT JOIN survey_report_topic_watermarks w ON w.insight_id=q.id AND w.tenant_id=q.tenant_id
 WHERE q.tenant_id=t AND q.id=i AND q.withdrawn_at IS NULL AND u.deleted_at IS NULL AND u.status<>'deleted'
 AND authority.dependency_lost_at IS NULL
 AND (authority.source_kind='approved_legacy' OR (authority.source_kind='native' AND authority.native_expires_at>now()
   AND w.insight_id IS NOT NULL AND w.state='retained' AND w.expires_at>now() AND r.insight_id IS NOT NULL AND r.proof_status='receipt_backed' AND r.lineage_id=w.lineage_id))
 AND q.processed_at+engagement_retention_days(tn.retention_policy)*interval '1 day'>now()
 AND NOT EXISTS(SELECT 1 FROM survey_reporting_permissions p WHERE p.tenant_id=t AND p.user_id=q.user_id AND p.full_reporting_denied)
 AND NOT EXISTS(SELECT 1 FROM survey_reporting_lineage_exclusions e WHERE e.tenant_id=t AND e.user_id=q.user_id AND e.lineage_id=r.lineage_id)
$$;
--> statement-breakpoint
DELETE FROM pulse_analytical_renditions d WHERE NOT EXISTS(SELECT 1 FROM pulse_language_permitted_source(d.tenant_id,d.analytical_id));
