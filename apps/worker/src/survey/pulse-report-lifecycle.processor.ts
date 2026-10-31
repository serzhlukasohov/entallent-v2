import { PulseLifecycleJobSchema, type PulseLifecycleJob } from '@entalent/contracts';
import type { FormPulseReportUseCase } from '@entalent/application';
import { PulseReportDeliveryService } from './pulse-report-delivery.service';
import { DatabaseService } from '../database/database.service';
import { pulseInputRows } from '@entalent/database';
import { sql } from 'drizzle-orm';
/** Callable processor only. No automatic BullMQ registration until separately approved activation. */
export class PulseReportLifecycleProcessor {
  constructor(
    private readonly db: DatabaseService,
    private readonly form: FormPulseReportUseCase,
    private readonly delivery: PulseReportDeliveryService,
    private readonly enabled = false,
  ) {}
  async process(input: PulseLifecycleJob) {
    if (!this.enabled) return { status: 'disabled' };
    const result = PulseLifecycleJobSchema.safeParse(input);
    if (!result.success) return { status: 'invalid_job' };
    const job = result.data;
    if (job.action === 'form') return this.form.execute(job.tenantId, job.obligationId);
    const [row] = await pulseInputRows(
      this.db.client,
      sql`select id from survey_report_native_snapshots where tenant_id=${job.tenantId}::uuid and obligation_id=${job.obligationId}::uuid`,
    );
    return row
      ? this.delivery.deliverNext(job.tenantId, String(row.id))
      : { status: 'missing_snapshot' };
  }
}
