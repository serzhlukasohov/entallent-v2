import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import {
  BuildPulseReportUseCase,
  FormPulseReportUseCase,
  PreparePulseReportInputsUseCase,
  type PulseReportActivationChange,
} from '@entalent/application';
import type { PulseNarrativeRequest, PulseReportFinalTiming } from '@entalent/contracts';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import { addPulsePresentationTopics } from './pulse-report-presentation.fixture';
import { readReportCycleExact, readReportFinalTiming } from '../pulse-report-configuration';
import { lockPulseReportCycleExact } from '../pulse-report-state';
import { PulseReportDeliveryService } from '../../../../apps/worker/src/survey/pulse-report-delivery.service';
import { PulseReportLifecycleProductionDriver, PulseReportLifecycleWorker } from '../../../../apps/worker/src/survey/pulse-report-lifecycle.worker';
import { PulseReportActivationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-activation.repository';
import { PulseReportSnapshotRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-snapshot.repository';
import { PulseReportRecipientRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-recipient.repository';
import { PULSE_FENCE_ABANDONED_ATTEMPT_MS, PulseReportDeliveryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-delivery.repository';
import { PulseReportHistoryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportLifecycleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository';

/** RPT-10: default-off registration, audited activation controls, holds and the registered processor. Synthetic only. */
type Suite = ReturnType<typeof rpt05FixtureSuite>;
type Fixture = Awaited<ReturnType<Suite['fixture']>>;
const hour = () => new Date(Date.now() + 3_600_000);
function lifecycleFor(s: Suite) {
  const schedule = new PulseReportFinalScheduleRepository(s.database);
  // Same synthetic within-cycle due plan as the RPT-07 connected lane.
  schedule.refresh = (tenantId, cycleId) => schedule.read(tenantId, cycleId);
  schedule.refreshInTransaction = async (tx, tenantId, cycleId) => {
    const cycle = await readReportCycleExact(tx, tenantId, cycleId);
    if (!cycle) return null;
    await lockPulseReportCycleExact(tx, cycle);
    return (await readReportFinalTiming(tx, tenantId, cycleId)) as unknown as PulseReportFinalTiming;
  };
  const presentation = new PulseReportPresentationRepository(s.database),
    inputs = new PreparePulseReportInputsUseCase(new PulseReportInputRepository(s.database), new PulseReportHistoryRepository(s.database));
  return { presentation, inputs, repository: new PulseReportLifecycleRepository(s.database, inputs, presentation, schedule) };
}
const change = (f: Fixture, over: Partial<PulseReportActivationChange>): PulseReportActivationChange => ({
  tenantId: f.tenantId, expectedRevision: 0, mode: 'observe', expiresAt: null, approvalReference: 'RPT10-TEST', operator: 'rpt10-test',
  scopes: [{ kind: 'manager_overall', orgUnitId: f.unit.id, orgTeamId: null, approvedRecipientPersonId: null }], ...over,
});

describe.runIf(Boolean(process.env.DATABASE_URL))('RPT-10 activation controls (PostgreSQL)', () => {
  const s = rpt05FixtureSuite();
  const activation = new PulseReportActivationRepository(s.database);
  afterAll(s.cleanup);

  it('concurrent edits with the same revision: one commits, the other conflicts, one audit event', async () => {
    const f = await s.fixture(1);
    const first = await Promise.all([activation.change(change(f, {})), activation.change(change(f, { mode: 'off', scopes: [] }))]);
    expect(first.map((r) => r.status).sort()).toEqual(['applied', 'revision_conflict']);
    const second = await Promise.all([1, 2].map(() => activation.change(change(f, { expectedRevision: 1, mode: 'off' }))));
    expect(second.map((r) => r.status).sort()).toEqual(['applied', 'revision_conflict']);
    expect(second.find((r) => r.status === 'revision_conflict')).toMatchObject({ currentRevision: 2 });
    const events = await activation.events(f.tenantId);
    expect(events.map((e) => [e.revision, e.operator, e.approval_reference])).toEqual([[1, 'rpt10-test', 'RPT10-TEST'], [2, 'rpt10-test', 'RPT10-TEST']]);
    expect((events[1]!.before as { revision: number }).revision).toBe(1);
    expect((await activation.read(f.tenantId)).control).toMatchObject({ mode: 'off', revision: 2 });
  });

  it('audit events are append-only and deliver without expiry is rejected by the database too', async () => {
    const f = await s.fixture(1);
    await activation.change(change(f, {}));
    await expect(s.raw`update pulse_report_activation_events set operator='x' where tenant_id=${f.tenantId}`).rejects.toThrow(/append_only/);
    await expect(s.raw`delete from pulse_report_activation_events where tenant_id=${f.tenantId}`).rejects.toThrow(/append_only/);
    await expect(s.raw`update pulse_report_activation_controls set mode='deliver',expires_at=null where tenant_id=${f.tenantId}`).rejects.toThrow(/pulse_activation_deliver_expiry/);
    expect(await activation.change(change(f, { expectedRevision: 1, mode: 'deliver', expiresAt: hour() }))).toEqual({ status: 'invalid', errors: ['deliver_requires_approved_recipient'] });
    expect((await activation.events(f.tenantId)).length).toBe(1);
  });

  it('unlisted tenant/scope: production discovery and repair pages exclude it; expired control holds by DB clock', async () => {
    const f = await s.fixture(1), { repository } = lifecycleFor(s);
    await s.start(f);
    const queue = { add: async () => undefined };
    const driver = new PulseReportLifecycleProductionDriver(repository, activation, { execute: async () => { throw Error('no formation'); } }, { deliverNext: async () => { throw Error('no delivery'); }, fence: async () => { throw Error('no fence'); } }, queue, 100);
    for (let i = 0; i < 2; i++) await driver.scan();
    const [none] = await s.raw`select (select count(*)::int from survey_report_scope_observations where tenant_id=${f.tenantId}) seen,(select count(*)::int from survey_report_obligations where tenant_id=${f.tenantId}) obligations`;
    expect(none).toEqual({ seen: 0, obligations: 0 });
    // An obligation formed through the legacy explicit seam stays out of production repair pages.
    const observed = await repository.observe({ tenantId: f.tenantId, cycleId: f.cycleId, overallScopeId: f.overallId, audience: 'manager', purpose: 'final' });
    expect(observed.obligationId).toBeTruthy();
    expect((await repository.repair(100, activation.scopeFilter)).some((r) => r.tenant_id === f.tenantId)).toBe(false);
    expect((await activation.decide(f.tenantId, observed.obligationId!)).decision).toEqual({ observe: false, deliver: false, holdReason: 'no_control' });
    await activation.change(change(f, {}));
    expect((await repository.repair(100, activation.scopeFilter)).some((r) => r.tenant_id === f.tenantId)).toBe(true);
    expect((await activation.decide(f.tenantId, observed.obligationId!)).decision).toEqual({ observe: true, deliver: false, holdReason: 'observe_only' });
    await s.raw`update pulse_report_activation_controls set expires_at=clock_timestamp()-interval '1 second' where tenant_id=${f.tenantId}`;
    expect((await activation.decide(f.tenantId, observed.obligationId!)).decision).toEqual({ observe: false, deliver: false, holdReason: 'control_expired' });
    expect((await repository.repair(100, activation.scopeFilter)).some((r) => r.tenant_id === f.tenantId)).toBe(false);
  });
  it('Q8: erasing the approved person keeps the scope row with a null recipient, audits a system event, bumps revision and holds delivery', async () => {
    const f = await s.fixture(1), { repository } = lifecycleFor(s);
    await s.start(f);
    const personId = randomUUID();
    await s.raw`insert into users(id,tenant_id) values(${personId},${f.tenantId})`;
    await s.raw`insert into people(id,tenant_id,customer_employee_id,work_email,display_name,primary_role,pulse_participant,lifecycle_status) values(${personId},${f.tenantId},${'rpt10-' + personId},${'rpt10-' + personId + '@example.test'},'RPT10 approver','manager',false,'active')`;
    const applied = await activation.change(change(f, { mode: 'deliver', expiresAt: hour(), scopes: [{ kind: 'manager_overall', orgUnitId: f.unit.id, orgTeamId: null, approvedRecipientPersonId: personId }] }));
    expect(applied).toEqual({ status: 'applied', revision: 1, warnings: [expect.stringMatching(/^recipient_not_current_scope_owner:/)] });
    const observed = await repository.observe({ tenantId: f.tenantId, cycleId: f.cycleId, overallScopeId: f.overallId, audience: 'manager', purpose: 'final' });
    await s.raw`delete from people where id=${personId}`;
    const state = await activation.read(f.tenantId);
    expect(state.control).toMatchObject({ mode: 'deliver', revision: 2, updatedBy: 'system:recipient_erased' });
    expect(state.scopes).toEqual([{ kind: 'manager_overall', orgUnitId: f.unit.id, orgTeamId: null, approvedRecipientPersonId: null }]);
    const events = await activation.events(f.tenantId);
    expect(events.map((e) => [e.revision, e.operator])).toEqual([[1, 'rpt10-test'], [2, 'system:recipient_erased']]);
    expect(((events[1]!.before as { scopes: { approvedRecipientPersonId: string }[] }).scopes[0]!).approvedRecipientPersonId).toBe(personId);
    expect((events[1]!.after as { revision: number }).revision).toBe(2);
    expect((await activation.decide(f.tenantId, observed.obligationId!)).decision).toEqual({ observe: true, deliver: false, holdReason: 'recipient_not_approved' });
    // A cross-tenant recipient is rejected by the database even outside the script.
    await expect(s.raw`update pulse_report_activation_scopes set approved_recipient_person_id=${f.lead} where tenant_id=${f.tenantId}`).resolves.toBeDefined();
    const other = await s.fixture(1);
    await expect(s.raw`update pulse_report_activation_scopes set approved_recipient_person_id=${other.lead} where tenant_id=${f.tenantId}`).rejects.toThrow(/pulse_activation_scope_recipient_tenant/);
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL && process.env.REDIS_URL))('RPT-10 registered lifecycle processor (PostgreSQL + Redis)', () => {
  const s = rpt05FixtureSuite();
  const activation = new PulseReportActivationRepository(s.database);
  const posts: { channel: string }[] = [];
  let queue: Queue, connection: { host: string; port: number; db: number; password?: string };
  let f: Fixture, g: Fixture, registered: PulseReportLifecycleWorker, drivers: PulseReportLifecycleProductionDriver;
  let deliveryRepo: PulseReportDeliveryRepository;
  let modelCalls = 0;
  const env = { PULSE_REPORTS_ENABLED: false, PULSE_REPORT_SCAN_INTERVAL_SEC: 60 };
  const config = { get: (key: keyof typeof env) => env[key] };
  async function prepare(x: Fixture) {
    for (const u of x.users) {
      await addPulsePresentationTopics(s, x, u);
      for (let i = 0; i < 3; i++) await s.numeric(x, u, i);
    }
    for (const person of [x.manager, x.lead])
      await s.raw`insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id) values(${x.tenantId},${person},'slack',${'T' + x.tenantId},${'U' + person})`;
    await s.raw`insert into workspace_connections(tenant_id,channel_type,external_workspace_id,encrypted_credentials) values(${x.tenantId},'slack',${'T' + x.tenantId},'synthetic')`;
  }
  beforeAll(async () => {
    // Redis resources are created here so a skipped collection never opens a connection.
    const url = new URL(process.env.REDIS_URL!);
    connection = { host: url.hostname, port: Number(url.port) || 6379, db: Number(url.pathname.slice(1) || 0), ...(url.password ? { password: decodeURIComponent(url.password) } : {}) };
    queue = new Queue('rpt10-lifecycle-' + randomUUID(), { connection });
    f = await s.fixture(5);
    await prepare(f);
    const { presentation, inputs, repository } = lifecycleFor(s);
    const transport = {
      prove: async (c: { workspaceId: string; slackUserId: string }) => ({ workspaceId: c.workspaceId, slackUserId: c.slackUserId, channelId: 'D' + c.slackUserId, botUserId: 'Bfixture', privateDm: true as const }),
      post: async (_token: string, channel: string) => {
        posts.push({ channel });
        return { status: 'accepted' as const, channel, timestamp: '1793300000.' + String(posts.length).padStart(6, '0') };
      },
    };
    const recipient = new PulseReportRecipientRepository(s.database, () => 'synthetic');
    const narrative = {
      draft: async (input: PulseNarrativeRequest) => {
        modelCalls++;
        return { explanation: [{ text: 'Employees describe sufficient choice over work methods.', references: [input.evidence[0]!.handle] }], focus: { kind: 'none_supported' }, actions: [] };
      },
      review: async () => ({ verdict: 'pass', violations: [] }),
      localize: async () => null,
      reviewLabels: async () => null,
    };
    const builder = new BuildPulseReportUseCase(presentation, inputs, narrative, repository);
    deliveryRepo = new PulseReportDeliveryRepository(s.database, presentation, recipient, transport);
    drivers = new PulseReportLifecycleProductionDriver(
      repository, activation,
      new FormPulseReportUseCase(repository, builder, new PulseReportSnapshotRepository(s.database, presentation, recipient, transport)),
      new PulseReportDeliveryService(deliveryRepo),
      queue, 100,
    );
    registered = new PulseReportLifecycleWorker(queue, config as never, drivers);
  }, 180_000);
  afterAll(async () => {
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await s.cleanup();
  });

  /** Runs scan jobs through Redis and the registered processor until no new jobs are produced. */
  async function drain(passes = 8) {
    const results: { name: string; data: unknown; result: unknown }[] = [];
    const worker = new Worker(queue.name, async (job: Job) => {
      const result = await registered.process(job);
      results.push({ name: job.name, data: job.data, result });
      return result;
    }, { connection, autorun: false });
    const running = worker.run();
    try {
      for (let pass = 0; pass < passes; pass++) {
        await queue.add('scan', {}, { jobId: 'scan-' + randomUUID(), removeOnComplete: true, removeOnFail: true });
        const until = Date.now() + 30_000;
        while (Date.now() < until) {
          const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
          if (Object.values(counts).every((n) => n === 0)) break;
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    } finally {
      await worker.close();
      await running;
    }
    return results;
  }
  type Row = { id: string; status: string; disposition: string | null; kind: string; snapshot_id: string | null; artifact_hash: string | null; attempts: number; receipts: number; part_count: number };
  const state = async (x: Fixture = f) => (await s.raw`select o.id,o.status,o.disposition,s.kind,sn.id snapshot_id,sn.artifact_hash,(select count(*)::int from survey_report_attempts a where a.snapshot_id=sn.id) attempts,(select count(*)::int from survey_report_receipts r where r.snapshot_id=sn.id) receipts,sn.part_count from survey_report_obligations o join survey_report_scopes s on s.id=o.scope_id left join survey_report_native_snapshots sn on sn.obligation_id=o.id where o.tenant_id=${x.tenantId} and o.purpose='final' order by s.kind`) as unknown as Row[];
  const counts = async () => (await s.raw`select (select count(*)::int from survey_report_obligations where tenant_id=${f.tenantId}) obligations,(select count(*)::int from survey_report_native_snapshots where tenant_id=${f.tenantId}) snapshots,(select count(*)::int from survey_report_attempts where tenant_id=${f.tenantId}) attempts`)[0];
  const scopes = (x: Fixture, manager: string | null, lead: string | null = x.lead) => [
    { kind: 'team' as const, orgUnitId: x.unit.id, orgTeamId: x.team.id, approvedRecipientPersonId: lead },
    { kind: 'manager_overall' as const, orgUnitId: x.unit.id, orgTeamId: null, approvedRecipientPersonId: manager },
  ];
  let revision = 0;
  const set = async (x: Fixture, over: Partial<PulseReportActivationChange>) => {
    const result = await activation.change(change(x, { expectedRevision: revision, ...over }));
    expect(result).toMatchObject({ status: 'applied', revision: revision + 1 });
    revision++;
  };

  it('inert default: disabled boot removes the scan; enabled without controls forms and sends nothing', async () => {
    await queue.upsertJobScheduler('pulse-report-lifecycle-scan', { every: 60_000 }, { name: 'scan', data: {} });
    await registered.onModuleInit();
    expect(await queue.getJobScheduler('pulse-report-lifecycle-scan')).toBeUndefined();
    expect((await drain(1)).every((r) => (r.result as { status: string }).status === 'disabled')).toBe(true);
    env.PULSE_REPORTS_ENABLED = true;
    await drain(2);
    expect(await counts()).toEqual({ obligations: 0, snapshots: 0, attempts: 0 });
    expect([modelCalls, posts.length]).toEqual([0, 0]);
  }, 120_000);

  it('deliver for the team scope and observe for its parent: only the approved team lead receives; the parent snapshot is held', async () => {
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, null) });
    for (let i = 0; i < 4 && (await state()).find((r) => r.kind === 'team')?.status !== 'delivered'; i++) await drain(3);
    const [manager, team] = await state();
    expect(team).toMatchObject({ kind: 'team', status: 'delivered' });
    expect(team!.receipts).toBe(team!.part_count);
    expect(manager).toMatchObject({ kind: 'manager_overall', status: 'snapshot_ready', attempts: 0, receipts: 0 });
    expect(manager!.snapshot_id).toBeTruthy();
    expect(new Set(posts.map((p) => p.channel))).toEqual(new Set(['DU' + f.lead]));
    expect(modelCalls).toBeGreaterThan(0);
    expect(await activation.held(f.tenantId)).toEqual([expect.objectContaining({ snapshotId: manager!.snapshot_id, status: 'snapshot_ready', holdReason: 'recipient_not_approved' })]);
    // Q7: the held parent is fenced by the scan but never enqueued as a job.
    const results = await drain(2);
    expect(results.filter((r) => r.name === 'deliver')).toEqual([]);
    expect(results.some((r) => r.name === 'scan' && (r.result as { held: number }).held >= 1)).toBe(true);
  }, 300_000);

  it('recipient mismatch and switch-off mid-queue hold without attempts; Q3 guard compares the dispatched route', async () => {
    const [before] = await state();
    const sentBefore = posts.length;
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, f.lead) });
    await drain(2);
    expect(await activation.held(f.tenantId)).toEqual([expect.objectContaining({ snapshotId: before!.snapshot_id, holdReason: 'recipient_mismatch' })]);
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, f.manager) });
    // Q3: same stored decision, but the guard follows the route actually being dispatched.
    const guard = activation.deliveryGuard(f.tenantId, before!.id);
    const route = { tenantId: f.tenantId, scopeId: f.overallId } as never;
    expect(await s.db.transaction((tx) => guard(tx as never, { obligationId: before!.id, route: { ...(route as object), personId: f.manager } as never }))).toBe(true);
    expect(await s.db.transaction((tx) => guard(tx as never, { obligationId: before!.id, route: { ...(route as object), personId: f.lead } as never }))).toBe(false);
    // Enqueued under an approved deliver control, switched off before execution.
    await queue.add('deliver', { tenantId: f.tenantId, obligationId: before!.id, action: 'deliver' }, { jobId: 'pulse-deliver-' + before!.id, removeOnComplete: true, removeOnFail: true, attempts: 1 });
    await set(f, { mode: 'off', scopes: scopes(f, f.manager) });
    const offResults = await drain(1);
    expect(offResults).toContainEqual(expect.objectContaining({ name: 'deliver', result: { status: 'held', holdReason: 'control_off', fence: 'held' } }));
    const [stillHeld] = await state();
    expect(stillHeld).toMatchObject({ status: 'snapshot_ready', attempts: 0, artifact_hash: before!.artifact_hash });
    expect(posts.length).toBe(sentBefore);
  }, 300_000);

  it('Q6/Q1: off between claim and dispatch never calls the provider; a part-delivered report holds as partial and resumes exactly once', async () => {
    const [before] = await state();
    expect(before!.part_count).toBeGreaterThanOrEqual(2);
    const sentBefore = posts.length;
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, f.manager) });
    const grant = await deliveryRepo.claim(f.tenantId, before!.snapshot_id!);
    expect(grant).toBeTruthy();
    await set(f, { mode: 'off', scopes: scopes(f, f.manager) });
    expect(await deliveryRepo.dispatch(grant!, activation.deliveryGuard(f.tenantId, before!.id))).toEqual({ status: 'held' });
    expect(posts.length).toBe(sentBefore);
    const [attempt] = await s.raw`select state,reason,retryable from survey_report_attempts where snapshot_id=${before!.snapshot_id}`;
    expect(attempt).toMatchObject({ state: 'definitely_not_sent', reason: 'activation_held', retryable: 1 });
    expect((await state())[0]!.status).not.toBe('reconciliation_required');
    // Re-enabled: exactly one part is sent per deliver execution.
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, f.manager) });
    expect(await drivers.process({ tenantId: f.tenantId, obligationId: before!.id, action: 'deliver' })).toEqual({ status: 'part_delivered' });
    expect(posts.slice(sentBefore).map((p) => p.channel)).toEqual(['DU' + f.manager]);
    // Q1: off after part 1 surfaces partial_delivery_held, distinct from an ordinary hold.
    await set(f, { mode: 'off', scopes: scopes(f, f.manager) });
    expect(await activation.held(f.tenantId)).toEqual([expect.objectContaining({ snapshotId: before!.snapshot_id, holdReason: 'partial_delivery_held' })]);
    expect(await drivers.process({ tenantId: f.tenantId, obligationId: before!.id, action: 'deliver' })).toMatchObject({ status: 'held', holdReason: 'partial_delivery_held' });
    // Q5: with the tenant off, the delivery-phase row still pages (fenced and counted as held), never enqueued.
    const offScans = await drain(2);
    expect(offScans.some((r) => r.name === 'scan' && (r.result as { held: number }).held >= 1)).toBe(true);
    expect(offScans.filter((r) => r.name === 'deliver')).toEqual([]);
    expect(posts.length).toBe(sentBefore + 1);
    await set(f, { mode: 'deliver', expiresAt: hour(), scopes: scopes(f, f.manager) });
    for (let i = 0; i < 4 && (await state())[0]!.status !== 'delivered'; i++) await drain(3);
    await drain(2);
    const [after] = await state();
    expect(after).toMatchObject({ status: 'delivered', snapshot_id: before!.snapshot_id, artifact_hash: before!.artifact_hash });
    expect(after!.receipts).toBe(after!.part_count);
    expect(after!.attempts).toBe(after!.part_count + 1);
    expect(posts.slice(sentBefore).map((p) => p.channel)).toEqual(Array(after!.part_count).fill('DU' + f.manager));
    expect((await activation.events(f.tenantId)).map((e) => e.revision)).toEqual(Array.from({ length: revision }, (_, i) => i + 1));
  }, 300_000);

  it('Q2/Q4: held snapshots are still cancelled by the RPT-07 recipient fence; expired snapshots leave held/decide', async () => {
    env.PULSE_REPORTS_ENABLED = true;
    g = await s.fixture(5);
    await prepare(g);
    expect(await activation.change(change(g, { mode: 'observe', scopes: scopes(g, null, null) }))).toMatchObject({ status: 'applied' });
    for (let i = 0; i < 4 && (await state(g)).filter((r) => r.snapshot_id).length < 2; i++) await drain(3);
    const [manager, team] = await state(g);
    expect([manager!.status, team!.status]).toEqual(['snapshot_ready', 'snapshot_ready']);
    // Q4: an expired snapshot is treated as missing.
    // Synthetic time travel only: bypass the immutability trigger the way the RPT05 fixture adjusts schedules.
    await s.raw.begin(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update survey_report_native_snapshots set expires_at=clock_timestamp()-interval '1 second' where id=${team!.snapshot_id}`;
    });
    expect(await activation.decide(g.tenantId, team!.id)).toMatchObject({ snapshotId: null, decision: { holdReason: 'observe_only' } });
    expect((await activation.held(g.tenantId)).map((h) => h.snapshotId)).toEqual([manager!.snapshot_id]);
    // Q2: the manager's recipient binding changes while held; the scan's fence pass cancels it, no attempt.
    const sent = posts.length;
    await s.raw`update channel_accounts set external_user_id=${'Urevoked' + g.manager} where tenant_id=${g.tenantId} and user_id=${g.manager}`;
    await drain(2);
    const [cancelled] = await state(g);
    expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ status: 'canceled', disposition: 'authorization_invalid', attempts: 0 });
    expect(posts.length).toBe(sent);
    expect(await activation.held(g.tenantId)).toEqual([]);
  }, 300_000);
  it('R1: a fence pass never escalates a fresh in-flight attempt of another process; a stale one keeps the existing escalation', async () => {
    env.PULSE_REPORTS_ENABLED = true;
    const h = await s.fixture(5);
    await prepare(h);
    let rev = 0;
    const setH = async (over: Partial<PulseReportActivationChange>) => {
      expect(await activation.change(change(h, { expectedRevision: rev, ...over }))).toMatchObject({ status: 'applied' });
      rev++;
    };
    await setH({ mode: 'observe', scopes: scopes(h, null, null) });
    for (let i = 0; i < 4 && (await state(h)).filter((r) => r.snapshot_id).length < 2; i++) await drain(3);
    const [manager] = await state(h);
    expect(manager).toMatchObject({ status: 'snapshot_ready', attempts: 0 });
    expect(manager!.part_count).toBeGreaterThanOrEqual(2);
    // Replica A claims (attempt_started committed); replica B's scan sees a held decision and fences.
    await setH({ mode: 'deliver', expiresAt: hour(), scopes: scopes(h, h.manager, null) });
    const grant = await deliveryRepo.claim(h.tenantId, manager!.snapshot_id!);
    expect(grant).toBeTruthy();
    await setH({ mode: 'off', scopes: scopes(h, h.manager, null) });
    expect(await deliveryRepo.fence(h.tenantId, manager!.snapshot_id!)).toEqual({ status: 'held' });
    const [fresh] = await s.raw`select a.state,a.reason,o.status from survey_report_attempts a join survey_report_native_snapshots sn on sn.id=a.snapshot_id join survey_report_obligations o on o.id=sn.obligation_id where a.id=${grant!.attemptId}`;
    expect(fresh).toMatchObject({ state: 'attempt_started', reason: null, status: 'delivering' });
    // A's dispatch proceeds normally once the control is re-enabled.
    const sent = posts.length;
    await setH({ mode: 'deliver', expiresAt: hour(), scopes: scopes(h, h.manager, null) });
    expect(await deliveryRepo.dispatch(grant!, activation.deliveryGuard(h.tenantId, manager!.id))).toEqual({ status: 'part_delivered' });
    expect(posts.slice(sent).map((p) => p.channel)).toEqual(['DU' + h.manager]);
    // A stale attempt older than the bound is still escalated by the existing abandoned-attempt fence.
    const second = await deliveryRepo.claim(h.tenantId, manager!.snapshot_id!);
    expect(second).toBeTruthy();
    await setH({ mode: 'off', scopes: scopes(h, h.manager, null) });
    await s.raw.begin(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update survey_report_attempts set started_at=clock_timestamp()-${PULSE_FENCE_ABANDONED_ATTEMPT_MS + 60_000}*interval '1 millisecond' where id=${second!.attemptId}`;
    });
    expect(await deliveryRepo.fence(h.tenantId, manager!.snapshot_id!)).toEqual({ status: 'not_claimable' });
    const [stale] = await s.raw`select a.state,a.reason,o.status from survey_report_attempts a join survey_report_native_snapshots sn on sn.id=a.snapshot_id join survey_report_obligations o on o.id=sn.obligation_id where a.id=${second!.attemptId}`;
    expect(stale).toMatchObject({ state: 'unknown', reason: 'abandoned_attempt', status: 'reconciliation_required' });
    expect(posts.length).toBe(sent + 1);
  }, 300_000);
});
