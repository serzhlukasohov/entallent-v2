import { afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import {
  BuildPulseReportUseCase,
  FormPulseReportUseCase,
  PreparePulseReportInputsUseCase,
} from '@entalent/application';
import type { PulseNarrativeRequest } from '@entalent/contracts';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { claimOwnedRpt07Redis } from './rpt07-owned-redis.fixture';
import { addPulsePresentationTopics } from './pulse-report-presentation.fixture';
import { PulseReportDeliveryService } from '../../../../apps/worker/src/survey/pulse-report-delivery.service';
import { PulseReportLifecycleProcessor } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.processor';
import { PulseReportLifecycleScheduler } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.scheduler';
import { PulseReportSnapshotRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-snapshot.repository';
import { PulseReportRecipientRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-recipient.repository';
import { PulseReportDeliveryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-delivery.repository';
import { PulseReportHistoryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportLifecycleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository';
import { readReportCycleExact, readReportFinalTiming } from '../pulse-report-configuration';
import { lockPulseReportCycleExact } from '../pulse-report-state';
import type { PulseReportFinalTiming } from '@entalent/contracts';
describe.runIf(Boolean(process.env.DATABASE_URL && process.env.REDIS_URL))(
  'RPT07 explicit local automatic wiring',
  () => {
    const s = rpt05FixtureSuite();
    afterAll(s.cleanup);
    it('source wakeup discovers due native scopes, starts one actual cutoff, forms real snapshots/completions and completes ordered fake-Slack delivery through actual Redis jobs', async () => {
      const f = await s.fixture(5);
      for (const u of f.users) {
        await addPulsePresentationTopics(s, f, u);
        for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
      }
      for (const person of [f.manager, f.lead])
        await s.raw`insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id) values(${f.tenantId},${person},'slack',${'T' + f.tenantId},${'U' + person})`;
      await s.raw`insert into workspace_connections(tenant_id,channel_type,external_workspace_id,encrypted_credentials) values(${f.tenantId},'slack',${'T' + f.tenantId},'synthetic')`;
      const [wake] =
        await s.raw`select generation from survey_report_observations where tenant_id=${f.tenantId}`;
      expect(Number(wake.generation)).toBeGreaterThan(0);
      const schedule = new PulseReportFinalScheduleRepository(s.database);
      schedule.refresh = (tenantId, cycleId) => schedule.read(tenantId, cycleId);
      schedule.refreshInTransaction = async (tx, tenantId, cycleId) => {
        const cycle = await readReportCycleExact(tx, tenantId, cycleId);
        if (!cycle) return null;
        await lockPulseReportCycleExact(tx, cycle);
        return (await readReportFinalTiming(
          tx,
          tenantId,
          cycleId,
        )) as unknown as PulseReportFinalTiming;
      };
      // RPT05's persisted synthetic within-cycle due plan, actual inherited RPT04 begin/cutoff.
      const presentation = new PulseReportPresentationRepository(s.database),
        inputs = new PreparePulseReportInputsUseCase(
          new PulseReportInputRepository(s.database),
          new PulseReportHistoryRepository(s.database),
        ),
        repository = new PulseReportLifecycleRepository(s.database, inputs, presentation, schedule);
      let posts = 0;
      const transport = {
        prove: async (c: { workspaceId: string; slackUserId: string }) => ({
          workspaceId: c.workspaceId,
          slackUserId: c.slackUserId,
          channelId: 'D' + c.slackUserId,
          botUserId: 'Bfixture',
          privateDm: true as const,
        }),
        post: async (_token: string, channel: string) => ({
          status: 'accepted' as const,
          channel,
          timestamp: '1793200000.' + String(++posts).padStart(6, '0'),
        }),
      };
      const recipient = new PulseReportRecipientRepository(s.database, () => 'synthetic'),
        snapshots = new PulseReportSnapshotRepository(
          s.database,
          presentation,
          recipient,
          transport,
        ),
        delivery = new PulseReportDeliveryRepository(
          s.database,
          presentation,
          recipient,
          transport,
        );
      const narrative = {
        draft: async (input: PulseNarrativeRequest) => ({
          explanation: [
            {
              text: 'Employees describe sufficient choice over work methods.',
              references: [input.evidence[0]!.handle],
            },
          ],
          focus: { kind: 'none_supported' },
          actions: [],
        }),
        review: async () => ({ verdict: 'pass', violations: [] }),
        localize: async () => null,
        reviewLabels: async () => null,
      };
      const builder = new BuildPulseReportUseCase(presentation, inputs, narrative, repository),
        processor = new PulseReportLifecycleProcessor(
          s.database,
          new FormPulseReportUseCase(repository, builder, snapshots),
          new PulseReportDeliveryService(delivery),
          true,
        );
      const owned = await claimOwnedRpt07Redis();
      try {
        const queueName = owned.queue('rpt07-connected-' + randomUUID()),
          connection = owned.connection,
          queue = new Queue(queueName, { connection });
        const activated = {
          discover: async () =>
            (await repository.discover(100)).filter((r) => r.tenantId === f.tenantId),
          observe: (...args: Parameters<typeof repository.observe>) => repository.observe(...args),
          repair: async () =>
            (await repository.repair(100)).filter((r) => r.tenant_id === f.tenantId),
        };
        const scheduler = new PulseReportLifecycleScheduler(activated as never, queue, true);
        const worker = new Worker(queueName, (job) => processor.process(job.data), {
          connection,
          autorun: false,
        });
        let completed = 0;
        worker.on('completed', () => completed++);
        const running = worker.run();
        try {
          for (let pass = 0; pass < 6; pass++) {
            const before = completed,
              result = await scheduler.runOnce(100);
            const until = Date.now() + 10000;
            while (completed < before + result.queued && Date.now() < until)
              await new Promise((resolve) => setTimeout(resolve, 10));
            expect(completed).toBe(before + result.queued);
            const [state] =
              await s.raw`select count(*)::int n from survey_report_obligations where tenant_id=${f.tenantId} and status='delivered'`;
            if (state.n === 2) break;
          }
          const [state] =
            await s.raw`select (select count(*)::int from survey_report_obligations where tenant_id=${f.tenantId} and status='delivered') delivered,(select count(*)::int from survey_report_native_snapshots where tenant_id=${f.tenantId}) snapshots,(select count(*)::int from survey_report_final_completions c join survey_report_input_candidates i on i.id=c.candidate_id where i.tenant_id=${f.tenantId}) completions,(select count(*)::int from survey_report_receipts where tenant_id=${f.tenantId}) receipts`;
          expect(state.delivered).toBe(2);
          expect(state.snapshots).toBe(2);
          expect(state.completions).toBeGreaterThan(0);
          expect(state.receipts).toBe(posts);
          expect(posts).toBeGreaterThan(1);
          const [timing] =
            await s.raw`select status,formation_started_at=report_data_cutoff same_cutoff,formation_started_at>final_due_at late from survey_report_final_timings where tenant_id=${f.tenantId}`;
          expect(timing).toMatchObject({ status: 'started', same_cutoff: true, late: true });
        } finally {
          await worker.close();
          await running;
          await queue.close();
        }
      } finally {
        await owned.release();
      }
    }, 30000);
  },
);
