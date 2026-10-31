import { afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { claimOwnedRpt07Redis } from './rpt07-owned-redis.fixture';
import { PreparePulseReportInputsUseCase } from '@entalent/application';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportLifecycleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository';
import { PulseReportLifecycleScheduler } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.scheduler';
describe.runIf(Boolean(process.env.DATABASE_URL && process.env.REDIS_URL))(
  'RPT07 named PostgreSQL/Redis repair',
  () => {
    const s = rpt05FixtureSuite();
    afterAll(s.cleanup);
    it('lost and exhausted native queue hints are repaired from the same durable obligation without provider work', async () => {
      const owned = await claimOwnedRpt07Redis();
      try {
        const connection = owned.connection;
        const queueName = owned.queue('rpt07-' + randomUUID()),
          queue = new Queue(queueName, { connection });
        const f = await s.fixture(),
          repository = new PulseReportLifecycleRepository(
            s.database,
            new PreparePulseReportInputsUseCase(new PulseReportInputRepository(s.database)),
            new PulseReportPresentationRepository(s.database),
            new PulseReportFinalScheduleRepository(s.database),
          );
        await s.start(f);
        const observation = await repository.observe({
          tenantId: f.tenantId,
          cycleId: f.cycleId,
          overallScopeId: f.overallId,
          audience: 'manager',
          purpose: 'final',
        });
        expect(observation.obligationId).toBeTruthy();
        const onlyFixture = {
          discover: async () => [],
          repair: async () =>
            (await repository.repair(100)).filter((r) => r.tenant_id === f.tenantId),
        };
        const scheduler = new PulseReportLifecycleScheduler(onlyFixture as never, queue, true),
          jobId = 'pulse-form-' + observation.obligationId;
        let worker: Worker<unknown, unknown> | undefined;
        try {
          expect((await scheduler.runOnce(100)).queued).toBe(1);
          const first = await queue.getJob(jobId);
          expect(first).toBeDefined();
          await first!.remove();
          expect(await queue.getJob(jobId)).toBeUndefined();
          expect((await scheduler.runOnce(100)).queued).toBe(1);
          const active = new Worker<unknown, unknown>(
            queueName,
            async () => {
              throw Error('synthetic exhausted job; no provider');
            },
            { connection, autorun: false },
          );
          worker = active;
          const failed = new Promise<void>((resolve, reject) => {
            worker!.once('failed', () => resolve());
            worker!.once('error', reject);
          });
          const running = active.run();
          await failed;
          await active.close();
          await running;
          worker = undefined;
          expect(await queue.getJob(jobId)).toBeUndefined();
          expect((await scheduler.runOnce(100)).queued).toBe(1);
          expect(await queue.getJob(jobId)).toBeDefined();
          await (await queue.getJob(jobId))!.remove();
          const [state] =
            await s.raw`select status from survey_report_obligations where id=${observation.obligationId!}`;
          expect(state.status).toBe('observing');
        } finally {
          if (worker) await worker.close();
          await queue.close();
        }
      } finally {
        await owned.release();
      }
    }, 30000);
  },
);
