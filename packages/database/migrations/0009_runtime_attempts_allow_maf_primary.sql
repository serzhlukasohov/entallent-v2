ALTER TABLE "runtime_attempts" DROP CONSTRAINT "runtime_attempts_runtime_mode_check";--> statement-breakpoint
ALTER TABLE "runtime_attempts" ADD CONSTRAINT "runtime_attempts_runtime_mode_check" CHECK ("runtime_attempts"."runtime_mode" in ('typescript', 'maf_shadow', 'maf_canary', 'maf_primary', 'maf_disabled'));--> statement-breakpoint
