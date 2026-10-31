DO $$ BEGIN
 ALTER TABLE "survey_report_assembly_inputs" ADD CONSTRAINT "survey_report_assembly_inputs_tenant_id_obligation_id_survey_report_obligations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","obligation_id") REFERENCES "public"."survey_report_obligations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_completion_supports" ADD CONSTRAINT "survey_report_completion_supports_tenant_id_snapshot_id_survey_report_native_snapshots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "survey_report_snapshot_payloads" ADD CONSTRAINT "survey_report_snapshot_payloads_tenant_id_snapshot_id_survey_report_native_snapshots_tenant_id_id_fk" FOREIGN KEY ("tenant_id","snapshot_id") REFERENCES "public"."survey_report_native_snapshots"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
