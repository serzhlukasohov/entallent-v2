import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { REPORTING_RIGHTS_JOB_RETENTION, ReportingRightsJobSchema, reportingRightsApplyJobId, type ReportingRightsJob } from '@entalent/contracts';
import { ApplyReportingRightsAdmissionUseCase } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { MessageSendJob } from '../message-send/message-send.processor';
import { ReportingRightsRepository } from './repositories/reporting-rights.repository';

export const REPORTING_RIGHTS_SWEEP_JOB_ID = 'reporting-rights-sweep';
const SWEEP_INTERVAL_MS = 60_000;

/**
 * RPT-09 employee rights jobs: apply a durable admission through the existing withdrawal command, render
 * menu steps, and repair from PostgreSQL. Logs carry IDs and statuses only.
 */
@Processor(QUEUE_NAMES.REPORTING_RIGHTS)
export class ReportingRightsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ReportingRightsProcessor.name);

  constructor(
    private readonly repository: ReportingRightsRepository,
    private readonly apply: ApplyReportingRightsAdmissionUseCase,
    @InjectQueue(QUEUE_NAMES.REPORTING_RIGHTS) private readonly queue: Queue<ReportingRightsJob>,
    @InjectQueue(QUEUE_NAMES.MESSAGE_SEND) private readonly messageSendQueue: Queue<MessageSendJob>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', { kind: 'sweep' }, {
      repeat: { every: SWEEP_INTERVAL_MS }, jobId: REPORTING_RIGHTS_SWEEP_JOB_ID, removeOnComplete: true, removeOnFail: true,
    });
  }

  async process(job: Job<ReportingRightsJob>): Promise<unknown> {
    const parsed = ReportingRightsJobSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('reporting_rights_job_invalid');
    const data = parsed.data;
    if (data.kind === 'apply') {
      const result = await this.apply.execute(data);
      if (result.outcome === 'settled' && result.confirmationMessageId) await this.send(data.tenantId, result.confirmationMessageId);
      this.logger.log(`Reporting-rights admission=${data.admissionId} outcome=${result.outcome}${result.outcome === 'settled' ? ` status=${result.status}` : ''}`);
      return result;
    }
    if (data.kind === 'render') {
      const send = await this.repository.render(data);
      if (send) await this.messageSendQueue.add('send', send, { jobId: `message-send-${send.messageId}`, ...REPORTING_RIGHTS_JOB_RETENTION });
      return { rendered: Boolean(send) };
    }
    return this.sweep();
  }

  /** Re-enqueues admitted-but-unapplied admissions and unsent confirmations; ids make repeats collapse. */
  async sweep(): Promise<{ admissions: number; confirmations: number }> {
    const bucket = Math.floor(Date.now() / SWEEP_INTERVAL_MS);
    const pending = await this.repository.findUnapplied();
    for (const row of pending) {
      await this.queue.add('apply', { kind: 'apply', ...row }, { jobId: `${reportingRightsApplyJobId(row.admissionId)}-repair-${bucket}`, ...REPORTING_RIGHTS_JOB_RETENTION });
    }
    const unsent = await this.repository.findUnsentConfirmations();
    for (const row of unsent) await this.send(row.tenantId, row.messageId, `-repair-${bucket}`);
    if (pending.length || unsent.length) this.logger.log(`Reporting-rights sweep admissions=${pending.length} confirmations=${unsent.length}`);
    return { admissions: pending.length, confirmations: unsent.length };
  }

  private async send(tenantId: string, messageId: string, suffix = ''): Promise<void> {
    const job = await this.repository.messageSendJob(tenantId, messageId);
    if (job) await this.messageSendQueue.add('send', job, { jobId: `message-send-${messageId}${suffix}`, ...REPORTING_RIGHTS_JOB_RETENTION });
  }
}
