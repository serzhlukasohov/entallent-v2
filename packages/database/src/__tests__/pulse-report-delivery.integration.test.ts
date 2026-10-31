import { pulsePublicationHash } from '@entalent/database';
import { renderPulseReportForSlack } from '@entalent/channel-slack';
import { afterAll, describe, it, expect, vi } from 'vitest';
import { RetentionRepository } from '../../../../apps/worker/src/retention/retention.repository';
import { PgDialect } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { rpt05FixtureSuite, SHORT_WINDOW_DAYS } from './pulse-report-inputs.fixture';
import { addPulsePresentationTopics } from './pulse-report-presentation.fixture';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportHistoryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { PulseReportFinalScheduleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-final-schedule.repository';
import { PulseReportLifecycleRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository';
import { PulseReportRecipientRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-recipient.repository';
import { PulseReportSnapshotRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-snapshot.repository';
import { PulseReportDeliveryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-delivery.repository';
import {
  BuildPulseReportUseCase,
  FormPulseReportUseCase,
  PreparePulseReportInputsUseCase,
  selectPulseReportBaseline,
} from '@entalent/application';
import {
  PULSE_INPUT_CONTRACT,
  PULSE_REPORT_CALCULATION_CONTRACT,
  PULSE_REPORT_PRIVACY_POLICY_VERSION,
  ENGAGEMENT_ANSWER_CONTRACT,
  PULSE_PRESENTATION_CONTRACT,
  PULSE_LABEL_VERSION,
  PULSE_DELIVERY_CONTRACT,
  type PulseNarrativeRequest,
  type PulseTransportOutcome,
} from '@entalent/contracts';

describe.runIf(Boolean(process.env.DATABASE_URL))(
  'RPT07 migrated native lifecycle and publication',
  () => {
    const s = rpt05FixtureSuite();
    afterAll(s.cleanup, 120_000); // cascade cleanup of every fixture tenant under host load
    const presentation = new PulseReportPresentationRepository(s.database),
      inputs = new PreparePulseReportInputsUseCase(
        new PulseReportInputRepository(s.database),
        new PulseReportHistoryRepository(s.database),
      );
    const schedule = new PulseReportFinalScheduleRepository(s.database),
      lifecycle = new PulseReportLifecycleRepository(s.database, inputs, presentation, schedule);
    const narrative = {
      draft: vi.fn(async (input: PulseNarrativeRequest) => ({
        explanation: [
          {
            text: 'Employees describe sufficient choice over work methods.',
            references: [input.evidence[0]!.handle],
          },
        ],
        focus: { kind: 'none_supported' },
        actions: [],
      })),
      review: vi.fn(async () => ({ verdict: 'pass', violations: [] })),
      localize: vi.fn(),
      reviewLabels: vi.fn(),
    };
    const build = new BuildPulseReportUseCase(presentation, inputs, narrative, lifecycle);
    type F = Awaited<ReturnType<typeof s.fixture>>;
    const request = (
      f: F,
      purpose: 'final' | 'intermediate' = 'final',
      audience: 'manager' | 'team_lead' = 'manager',
    ) => ({
      tenantId: f.tenantId,
      cycleId: f.cycleId,
      overallScopeId: audience === 'manager' ? f.overallId : f.teamScopeId,
      audience,
      purpose,
      ...(purpose === 'intermediate' ? { indexKey: 'autonomy' as const } : {}),
    });
    async function setup(
      count = 6,
      teams = 1,
      eligible = false,
      durationDays = 1,
      numericOnly = false,
      successorDays: number[] = [],
    ) {
      const f = await s.fixture(count, durationDays, teams, true, successorDays);
      for (const id of [f.manager, ...f.leadList])
        await s.raw`insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id) values(${f.tenantId},${id},'slack',${'T' + f.tenantId},${'U' + id})`;
      await s.raw`insert into workspace_connections(tenant_id,channel_type,external_workspace_id,encrypted_credentials) values(${f.tenantId},'slack',${'T' + f.tenantId},'synthetic-credential')`;
      if (eligible)
        for (const u of f.users) {
          if (!numericOnly || u !== f.users[0]) await addPulsePresentationTopics(s, f, u);
          for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
        }
      const recipients = new PulseReportRecipientRepository(s.database, () => 'synthetic-token');
      let outcome: PulseTransportOutcome | null = null;
      const transport = {
        prove: vi.fn(async (c: { workspaceId: string; slackUserId: string }) => ({
          workspaceId: c.workspaceId,
          botUserId: 'Bfixture',
          channelId: 'D' + c.slackUserId,
          slackUserId: c.slackUserId,
          privateDm: true as const,
        })),
        post: vi.fn(
          async (_token: string, channel: string, _body: unknown): Promise<PulseTransportOutcome> =>
            outcome ?? { status: 'accepted', channel, timestamp: '1793200000.123456' },
        ),
      };
      const snapshots = new PulseReportSnapshotRepository(
          s.database,
          presentation,
          recipients,
          transport,
        ),
        delivery = new PulseReportDeliveryRepository(
          s.database,
          presentation,
          recipients,
          transport,
          true,
        );
      return {
        f,
        recipients,
        transport,
        snapshots,
        delivery,
        setOutcome: (o: PulseTransportOutcome) => {
          outcome = o;
        },
      };
    }
    async function freeze(
      h: Awaited<ReturnType<typeof setup>>,
      purpose: 'final' | 'intermediate' = 'final',
      audience: 'manager' | 'team_lead' = 'manager',
    ) {
      if (purpose === 'final') expect((await s.start(h.f)).status).toBe('started');
      const observed = await lifecycle.observe(request(h.f, purpose, audience));
      expect(observed.obligationId).toBeTruthy();
      const lease = await lifecycle.claim(h.f.tenantId, observed.obligationId!);
      expect(lease).not.toBeNull();
      if (!lease) throw Error('lease');
      const built = await build.executeInitiated(h.f.tenantId, lease.obligationId, lease.token);
      expect(built.status).toBe('built');
      if (built.status !== 'built') throw Error('build ' + built.status);
      const result = await h.snapshots.freeze(lease, built);
      expect(result.status).toBe('snapshot_ready');
      if (!result.snapshotId) throw Error('snapshot');
      return { snapshotId: result.snapshotId, lease, built };
    }
    async function next(previous: F, days: number) {
      const row = await s.successor(previous.cycleId, days);
      await s.waitForDbTime(row.periodStart);
      await new PulseReportScopeRepository(s.database).openOrgNativeCycle({
        tenantId: previous.tenantId,
        surveyDefinitionId: previous.definitionId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      });
      const scopes =
        await s.raw`select id,kind from survey_report_scopes where cycle_scoring_policy_id=${row.id}`;
      const f = {
        ...previous,
        cycleId: String(row.id),
        cycle: {
          ...previous.cycle,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
        },
        overallId: String(scopes.find((r) => r.kind === 'manager_overall')!.id),
        teamScopeId: String(scopes.find((r) => r.kind === 'team')!.id),
        windows: new Map(previous.windows),
      };
      for (const user of f.users) {
        const window = await s.survey.findOrCreateActiveWindow(user, f.tenantId);
        if (!window || 'kind' in window) throw Error('next window');
        f.windows.set(user, window.id);
        await addPulsePresentationTopics(s, f, user);
      }
      return f;
    }
    it('forms one native notice, stores immutable full package, creates no metric completion and accepts receipt independently', async () => {
      const h = await setup(),
        f = h.f;
      for (const user of f.users.slice(0, 4))
        for (let question = 0; question < 3; question++) await s.numeric(f, user, question);
      const r = await freeze(h);
      expect(r.built.presentation.sections).toEqual([
        {
          sectionKey: expect.any(String),
          label: expect.any(String),
          status: 'insufficient_data',
        },
      ]);
      const again = await lifecycle.observe(request(f));
      expect(again.obligationId).toBe(r.lease.obligationId);
      const [count] =
        await s.raw`select count(*)::int n from survey_report_final_completions c join survey_report_input_candidates i on i.id=c.candidate_id where i.tenant_id=${f.tenantId}`;
      expect(count.n).toBe(0);
      await expect(
        s.raw`update survey_report_snapshot_payloads set presentation='{}'::jsonb where snapshot_id=${r.snapshotId}`,
      ).rejects.toThrow('immutable');
      await expect(
        s.raw`update survey_report_native_snapshots set artifact_hash=${'a'.repeat(64)} where id=${r.snapshotId}`,
      ).rejects.toThrow('immutable');
      await expect(
        s.raw`update survey_report_parts set body_hash=${'a'.repeat(64)} where snapshot_id=${r.snapshotId}`,
      ).rejects.toThrow('immutable');
      expect(await h.delivery.deliverNext(f.tenantId, r.snapshotId)).toEqual({
        status: 'delivered',
      });
      expect(h.transport.post).toHaveBeenCalledTimes(1);
      await h.delivery.deliverNext(f.tenantId, r.snapshotId);
      expect(h.transport.post).toHaveBeenCalledTimes(1);
    });
    it('eligible TL/Manager finals share canonical candidate support; own completion cannot invalidate first send', async () => {
      const h = await setup(5, 1, true),
        tl = await freeze(h, 'final', 'team_lead'),
        manager = await freeze(h);
      const [r] =
        await s.raw`select count(distinct c.candidate_id)::int n,count(distinct support.snapshot_id)::int snapshots from survey_report_final_completions c join survey_report_completion_supports support on support.candidate_id=c.candidate_id join survey_report_input_candidates i on i.id=c.candidate_id where i.scope_id=${h.f.teamScopeId}`;
      expect(r.n).toBe(1);
      expect(r.snapshots).toBe(2);
      const before =
        await s.raw`select * from survey_report_final_completions where canonical_snapshot_id=${tl.snapshotId}`;
      expect(before.length).toBe(1);
      expect((await h.delivery.deliverNext(h.f.tenantId, tl.snapshotId)).status).toBe('delivered');
      expect((await h.delivery.deliverNext(h.f.tenantId, manager.snapshotId)).status).toMatch(
        /delivered/,
      );
      expect(h.transport.post).toHaveBeenCalledTimes(2);
    }, 30000);
    it('write-ahead crash, duplicate grants, unknown report freeze and scoped positive reconciliation preserve next ordinal', async () => {
      const h = await setup(9, 3, true),
        r = await freeze(h),
        grant = await h.delivery.claim(h.f.tenantId, r.snapshotId);
      expect(grant).not.toBeNull();
      await h.delivery.deliverNext(h.f.tenantId, r.snapshotId); // Existing durable claim never mints another local grant.
      expect((await h.delivery.dispatch(grant!)).status).toBe('unknown');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      expect((await h.delivery.dispatch({ ...grant! })).status).toBe('no_fresh_dispatch_grant');
      const [a] =
        await s.raw`select * from survey_report_attempts where snapshot_id=${r.snapshotId}`;
      const cmd = {
        tenantId: h.f.tenantId,
        snapshotId: r.snapshotId,
        attemptId: String(a.id),
        token: Number(a.token),
        operator: {
          actorId: 'fixture-operator',
          tenantId: h.f.tenantId,
          snapshotId: r.snapshotId,
          authorizationRef: 'explicit-fixture-scope',
        },
        reason: 'offline accepted evidence',
        evidenceRef: 'fixture:receipt',
        decision: 'confirmed_delivered' as const,
        evidence: {
          kind: 'provider_receipt' as const,
          channel: 'DU' + h.f.manager,
          timestamp: '1793200000.111111',
          bodyHash: String(a.body_hash),
          ownerTerminated: true,
        },
      };
      expect(
        (
          await h.delivery.reconcile({
            ...cmd,
            operator: { ...cmd.operator, tenantId: randomUUID() },
          })
        ).status,
      ).toBe('disabled_or_invalid');
      expect((await h.delivery.reconcile(cmd)).status).toBe('confirmed_delivered');
      expect((await h.delivery.reconcile(cmd)).status).toBe('stale_or_mismatched_evidence');
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toMatch(
        /delivered/,
      );
      expect(h.transport.post).toHaveBeenCalledTimes(1);
    }, 30000);
    it('provider acceptance followed by receipt rollback consumes the local grant forever and freezes every later part', async () => {
      const h = await setup(),
        r = await freeze(h),
        grant = await h.delivery.claim(h.f.tenantId, r.snapshotId);
      const db = {
        client: {
          transaction: (callback: (tx: unknown) => Promise<unknown>) =>
            s.db.transaction((tx) => {
              const wrapped = new Proxy(tx, {
                get(target, key) {
                  if (key === 'execute')
                    return async (query: unknown) => {
                      const text = new PgDialect().sqlToQuery(query as never).sql;
                      if (text.includes('insert into survey_report_receipts'))
                        throw Error('synthetic receipt commit failure');
                      return target.execute(query as never);
                    };
                  const value = Reflect.get(target, key);
                  return typeof value === 'function' ? value.bind(target) : value;
                },
              });
              return callback(wrapped);
            }),
        },
      };
      const fault = new PulseReportDeliveryRepository(
        db as never,
        presentation,
        h.recipients,
        h.transport,
        true,
      );
      expect((await fault.dispatch(grant!)).status).toBe('unknown');
      expect(h.transport.post).toHaveBeenCalledTimes(1);
      expect((await fault.dispatch(grant!)).status).toBe('no_fresh_dispatch_grant');
      await expect(
        s.raw`delete from survey_report_attempts where id=${grant!.attemptId}`,
      ).rejects.toThrow('actual_tenant_erasure');
      await h.delivery.deliverNext(h.f.tenantId, r.snapshotId);
      expect(h.transport.post).toHaveBeenCalledTimes(1);
    });
    it('exact ownership/account credential revisions and tenant policy NOWAIT fences block before provider; profile hydration does not churn revisions', async () => {
      const h = await setup(),
        r = await freeze(h),
        f = h.f;
      const [a] =
        await s.raw`select * from channel_accounts where tenant_id=${f.tenantId} and user_id=${f.manager}`;
      await s.raw`update channel_accounts set display_name='hydrated',profile_metadata='{"name":"Hydrated"}'::jsonb,updated_at=clock_timestamp() where id=${a.id}`;
      const [same] = await s.raw`select binding_revision from channel_accounts where id=${a.id}`;
      expect(same.binding_revision).toBe(a.binding_revision);
      const grant = await h.delivery.claim(f.tenantId, r.snapshotId);
      let release!: () => void, ready!: () => void;
      const held = new Promise<void>((r) => {
          release = r;
        }),
        locked = new Promise<void>((r) => {
          ready = r;
        });
      const blocker = s.raw.begin(async (tx) => {
        await tx`update tenants set retention_policy=retention_policy where id=${f.tenantId}`;
        ready();
        await held;
      });
      await locked;
      expect((await h.delivery.dispatch(grant!)).status).toBe('blocked');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      release();
      await blocker;
      await s.raw`update channel_accounts set external_user_id=external_user_id||'changed' where id=${a.id}`;
      const [changed] = await s.raw`select binding_revision from channel_accounts where id=${a.id}`;
      expect(Number(changed.binding_revision)).toBe(Number(a.binding_revision) + 1);
      expect((await h.delivery.deliverNext(f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    });
    it('retention removes private payload, preserves logical identity/canonical latest and denies access/recreation', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h);
      await s.raw`select pulse_publication_payload_purge(${h.f.tenantId},clock_timestamp()+interval '1 day')`;
      const [counts] =
        await s.raw`select (select count(*)::int from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}) payloads,(select count(*)::int from survey_report_native_snapshots where id=${r.snapshotId}) identities,(select count(*)::int from survey_report_final_completions where canonical_snapshot_id=${r.snapshotId}) history`;
      expect(counts.payloads).toBe(0);
      expect(counts.identities).toBe(1);
      expect(counts.history).toBeGreaterThan(0);
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      const old = await new PulseReportHistoryRepository(s.database).completed(
        h.f.tenantId,
        r.lease.sections[0]!.context.historyKey,
      );
      expect(old[0]?.authorized).toBe(false);
    });
    it('native first eligible observations and fenced compute takeover keep one identity and exact initiated frontier after final start', async () => {
      const h = await setup(5, 1, true),
        f = h.f;
      const observations = await Promise.all([
        lifecycle.observe(request(f, 'intermediate')),
        lifecycle.observe(request(f, 'intermediate')),
      ]);
      expect(observations[0]!.obligationId).toBe(observations[1]!.obligationId);
      const owners = await Promise.all([
        lifecycle.claim(f.tenantId, observations[0]!.obligationId!),
        lifecycle.claim(f.tenantId, observations[0]!.obligationId!),
      ]);
      expect(owners.filter(Boolean)).toHaveLength(1);
      const lease = owners.find(Boolean)!;
      const built = await build.executeInitiated(f.tenantId, lease.obligationId, lease.token);
      expect(built.status).toBe('built');
      if (built.status !== 'built') throw Error('build');
      await s.raw`update survey_report_obligations set lease_until=clock_timestamp()-interval '1 second' where id=${lease.obligationId}`;
      const takeover = await lifecycle.claim(f.tenantId, lease.obligationId);
      expect(takeover!.token).toBeGreaterThan(lease.token);
      expect((await h.snapshots.freeze(lease, built)).status).toBe('stale_lease');
      // A positive new input after the accepted frontier may advance source generation, never the pinned report.
      await s.numeric(f, f.users[0]!, 0);
      await s.raw.begin(async (tx) => {
        await tx`set local session_replication_role=replica`;
        await tx`update survey_report_final_timings set final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=${f.cycleId}) where tenant_id=${f.tenantId}`;
        await tx`set local session_replication_role=origin`;
      });
      expect((await s.start(f)).status).toBe('started');
      const resumed = await build.executeInitiated(
        f.tenantId,
        takeover!.obligationId,
        takeover!.token,
      );
      expect(resumed.status).toBe('built');
      if (resumed.status !== 'built') throw Error('resume');
      expect(resumed.provenance.sections[0]!.context.frontier).toBe(
        lease.sections[0]!.context.frontier,
      );
      expect((await h.snapshots.freeze(takeover!, resumed)).status).toBe('snapshot_ready');
      const late = await lifecycle.observe({ ...request(f, 'intermediate'), indexKey: 'growth' });
      expect(late.obligationId).toBeUndefined();
    }, 30000);
    it('ineligible observation consumes no identity; exact N=5/6/10 readiness and partial/full denial preserve existing arithmetic', async () => {
      for (const [n, complete] of [
        [5, 5],
        [6, 5],
        [10, 8],
      ]) {
        const h = await setup(n - 1),
          f = h.f;
        expect((await lifecycle.observe(request(f, 'intermediate'))).status).toBe('not_ready');
        const [empty] =
          await s.raw`select count(*)::int n from survey_report_obligations where tenant_id=${f.tenantId}`;
        expect(empty.n).toBe(0);
        for (const user of [...f.users, f.lead].slice(0, complete))
          await addPulsePresentationTopics(s, f, user);
        const eligible = await lifecycle.observe(request(f, 'intermediate'));
        expect(eligible.obligationId).toBeTruthy();
      }
    }, 30000);
    it('source-only hard erasure invalidates real completed history; raw tenant cascade leaves no new publication state', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h),
        f = h.f;
      await s.raw`delete from survey_report_candidate_sources where tenant_id=${f.tenantId} and user_id=${f.users[0]}`;
      const old = await new PulseReportHistoryRepository(s.database).completed(
        f.tenantId,
        r.lease.sections[0]!.context.historyKey,
      );
      expect(old[0]?.authorized).toBe(false);
      expect((await h.delivery.deliverNext(f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      await expect(
        s.raw`delete from survey_report_native_snapshots where id=${r.snapshotId}`,
      ).rejects.toThrow('actual_tenant_erasure');
      await expect(
        s.raw`delete from survey_report_obligations where id=${r.lease.obligationId}`,
      ).rejects.toThrow('actual_tenant_erasure');
      await expect(
        s.raw`delete from survey_report_final_completions where canonical_snapshot_id=${r.snapshotId}`,
      ).rejects.toThrow('actual_tenant_erasure');
      await s.raw`delete from tenants where id=${f.tenantId}`;
      const [remaining] =
        await s.raw`select (select count(*)::int from survey_report_obligations where tenant_id=${f.tenantId}) obligations,(select count(*)::int from survey_report_native_snapshots where tenant_id=${f.tenantId}) snapshots,(select count(*)::int from survey_report_observations where tenant_id=${f.tenantId}) observations`;
      expect(remaining).toMatchObject({ obligations: 0, snapshots: 0, observations: 0 });
    }, 30000);

    it('timely pending work blocks final snapshot/notice until settlement, then five of one hundred is eligible with insufficient child and diagnostic support', async () => {
      const h = await setup(98, 2),
        f = h.f;
      for (const user of f.users.slice(0, 5)) await addPulsePresentationTopics(s, f, user);
      let pending: Awaited<ReturnType<typeof s.numeric>> | undefined;
      for (const [n, user] of [...f.users.slice(0, 3), ...f.users.slice(49, 51)].entries())
        for (let i = 0; i < 3; i++) {
          const work = await s.numeric(f, user, i, '7', !(n === 4 && i === 2));
          if (n === 4 && i === 2) pending = work;
        }
      expect((await s.start(f)).status).toBe('started');
      const blocked = await lifecycle.observe(request(f));
      expect(blocked.status).toBe('pending');
      expect(blocked.obligationId).toBeUndefined();
      await s.commit(pending!);
      const r = await freeze(h);
      expect(r.built.presentation.sections[0]!.status).toBe('eligible');
      expect(
        r.built.presentation.sections.slice(1).every((s) => s.status === 'insufficient_data'),
      ).toBe(true);
      const [supports] =
        await s.raw`select count(*)::int n from survey_report_completion_supports where snapshot_id=${r.snapshotId} and history_key like '%:team:%' and metric_key='autonomy'`;
      expect(supports.n).toBeGreaterThan(0);
      const [t] =
        await s.raw`select count(distinct report_data_cutoff)::int cutoffs,count(distinct formation_started_at)::int starts from survey_report_final_timings where tenant_id=${f.tenantId}`;
      expect(t.cutoffs).toBe(1);
      expect(t.starts).toBe(1);
    }, 30000);
    it('fair scope observation pages are bounded and advance beyond blocked/ineligible scopes with source wakeups in the same DB', async () => {
      const h = await setup(12, 4),
        expected = new Set([
          h.f.overallId,
          ...(await s.raw`select id from survey_report_scopes where tenant_id=${h.f.tenantId}`).map(
            (r) => String(r.id),
          ),
        ]);
      const seen = new Set<string>();
      for (let page = 0; page < 100 && seen.size < expected.size; page++) {
        const work = await lifecycle.discover(2);
        expect(work.length).toBeLessThanOrEqual(10);
        for (const r of work) if (r.tenantId === h.f.tenantId) seen.add(r.overallScopeId);
      }
      expect(seen).toEqual(expected);
      const [before] =
        await s.raw`select next_observation_at>clock_timestamp() future from survey_report_scope_observations where scope_id=${h.f.overallId}`;
      expect(before.future).toBe(true);
      await addPulsePresentationTopics(s, h.f, h.f.users[0]!);
      const [after] =
        await s.raw`select next_observation_at<=clock_timestamp() due from survey_report_scope_observations where scope_id=${h.f.overallId}`;
      expect(after.due).toBe(true);
    }, 30000);

    it('real prior-final completion forces full pre-snapshot historical rebuild at the SAME current frontier; later history change cancels frozen bytes', async () => {
      const a = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [SHORT_WINDOW_DAYS, 1]);
      await s.start(a.f);
      const ao = await lifecycle.observe(request(a.f)),
        al = await lifecycle.claim(a.f.tenantId, ao.obligationId!);
      const ab = await build.executeInitiated(a.f.tenantId, al!.obligationId, al!.token);
      if (ab.status !== 'built') throw Error('prior A');
      const bf = await next(a.f, SHORT_WINDOW_DAYS);
      for (const u of bf.users) for (let i = 0; i < 3; i++) await s.numeric(bf, u, i);
      await s.raw.begin(async (tx) => {
        await tx`set local session_replication_role=replica`;
        await tx`update survey_report_final_timings set status='scheduled',blocked_reason=null,timezone='UTC',local_date='2026-10-28',local_work_end='23:59',final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=${bf.cycleId}) where cycle_scoring_policy_id=${bf.cycleId}`;
        await tx`set local session_replication_role=origin`;
      });
      await s.start(bf);
      const bo = await lifecycle.observe(request(bf)),
        bl = await lifecycle.claim(bf.tenantId, bo.obligationId!);
      const cf = await next(bf, 1),
        co = await lifecycle.observe(request(cf, 'intermediate')),
        cl = await lifecycle.claim(cf.tenantId, co.obligationId!);
      const cb = await build.executeInitiated(cf.tenantId, cl!.obligationId, cl!.token);
      expect(cb.status).toBe('built');
      if (cb.status !== 'built') throw Error('current build');
      expect(cb.provenance.sections[0]!.baselineInventory).toHaveLength(0);
      const afrozen = await a.snapshots.freeze(al!, ab);
      expect(afrozen.status).toBe('snapshot_ready');
      expect((await a.snapshots.freeze(cl!, cb)).status).toBe('invalidated');
      const rebased = await lifecycle.rebaseHistory(cl!);
      expect(rebased).not.toBeNull();
      expect(rebased!.token).toBeGreaterThan(cl!.token);
      expect(
        rebased!.sections.map((s) => [s.candidateId, s.context.frontier, s.qualitative, s.metrics]),
      ).toEqual(
        cl!.sections.map((s) => [s.candidateId, s.context.frontier, s.qualitative, s.metrics]),
      );
      expect((await build.executeInitiated(cf.tenantId, cl!.obligationId, cl!.token)).status).toBe(
        'invalidated',
      );
      const rebuilt = await build.executeInitiated(
        cf.tenantId,
        rebased!.obligationId,
        rebased!.token,
      );
      if (rebuilt.status !== 'built') throw Error('rebuilt');
      expect(rebuilt.provenance.sections[0]!.baselineInventory?.[0]?.cycleId).toBe(a.f.cycleId);
      const current = await a.snapshots.freeze(rebased!, rebuilt);
      expect(current.status).toBe('snapshot_ready');
      const rebaseB = await lifecycle.rebaseHistory(bl!);
      if (!rebaseB) throw Error('rebase B');
      const rebuiltB = await build.executeInitiated(
        bf.tenantId,
        rebaseB.obligationId,
        rebaseB.token,
      );
      if (rebuiltB.status !== 'built') throw Error('rebuilt B');
      expect((await a.snapshots.freeze(rebaseB, rebuiltB)).status).toBe('snapshot_ready');
      expect((await a.delivery.deliverNext(cf.tenantId, current.snapshotId!)).status).toBe(
        'not_claimed',
      );
      expect(a.transport.post).toHaveBeenCalledTimes(0);
      const [immutable] =
        await s.raw`select artifact_hash from survey_report_native_snapshots where id=${current.snapshotId!}`;
      expect(immutable.artifact_hash).toBeTruthy();
      // Latest-invalid continuity must not fall back to older A or poison a new report's retention deadline.
      await s.raw`update survey_report_input_candidates set expires_at=clock_timestamp()-interval '1 second' where cycle_id=${bf.cycleId}`;
      const fresh = await freeze({ ...a, f: cf }, 'intermediate', 'team_lead');
      expect(fresh.built.provenance.sections[0]!.baselines?.autonomy?.status).toBe(
        'baseline_established',
      );
      expect((await a.delivery.deliverNext(cf.tenantId, fresh.snapshotId)).status).toBe(
        'delivered',
      );
      expect(a.transport.post).toHaveBeenCalledTimes(1);
    }, 120000);

    it('one-call rate limit retries the SAME next bytes, complete multipart delivery resumes strictly after receipts and never regenerates', async () => {
      const h = await setup(9, 3, true),
        r = await freeze(h);
      h.setOutcome({
        status: 'definitely_not_sent',
        reason: 'rate_limited',
        retryable: true,
        retryAfterSeconds: 1,
      });
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toBe(
        'definitely_not_sent',
      );
      const first = JSON.stringify(h.transport.post.mock.calls[0]![2]);
      await s.raw`update survey_report_attempts set next_attempt_at=clock_timestamp() where snapshot_id=${r.snapshotId}`;
      h.setOutcome({
        status: 'accepted',
        channel: 'DU' + h.f.manager,
        timestamp: '1793200000.123456',
      });
      let last = '';
      for (let i = 0; i < 20 && last !== 'delivered'; i++)
        last = (await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status;
      expect(last).toBe('delivered');
      expect(JSON.stringify(h.transport.post.mock.calls[1]![2])).toBe(first);
      const parts =
        await s.raw`select ordinal,status from survey_report_parts where snapshot_id=${r.snapshotId} order by ordinal`;
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.every((p) => p.status === 'delivered')).toBe(true);
      expect(h.transport.post).toHaveBeenCalledTimes(parts.length + 1);
      const before = h.transport.post.mock.calls.length;
      await h.delivery.deliverNext(h.f.tenantId, r.snapshotId);
      expect(h.transport.post).toHaveBeenCalledTimes(before);
    }, 30000);
    it('a source withdrawal waits for the single in-flight part, then cancels all unsent remainder without deadlock or another SDK call', async () => {
      const h = await setup(9, 3, true),
        r = await freeze(h);
      let entered!: () => void, release!: () => void;
      const inside = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        resume = new Promise<void>((resolve) => {
          release = resolve;
        });
      h.transport.post.mockImplementationOnce(async (_token, channel) => {
        entered();
        await resume;
        return { status: 'accepted', channel, timestamp: '1793200000.123456' };
      });
      const publication = h.delivery.deliverNext(h.f.tenantId, r.snapshotId);
      await inside;
      let attempted!: () => void,
        done = false;
      const attempt = new Promise<void>((resolve) => {
        attempted = resolve;
      });
      const database = {
        client: {
          transaction: (fn: (tx: unknown) => Promise<unknown>) =>
            s.db.transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(target, key) {
                    if (key === 'execute')
                      return (query: unknown) => {
                        if (
                          new PgDialect()
                            .sqlToQuery(query as never)
                            .sql.includes('pulse-report-subject:')
                        )
                          attempted();
                        return target.execute(query as never);
                      };
                    const value = Reflect.get(target, key);
                    return typeof value === 'function' ? value.bind(target) : value;
                  },
                }),
              ),
            ),
        },
      };
      const user = h.f.users[0]!;
      const mutation = new ReportingPermissionRepository(database as never)
        .withdraw({
          tenantId: h.f.tenantId,
          userId: user,
          personId: user,
          requestId: randomUUID(),
          target: { kind: 'full_reporting' },
          provenance: {
            kind: 'verified_subject',
            tenantId: h.f.tenantId,
            userId: user,
            personId: user,
            verificationId: randomUUID(),
            receivedAt: new Date(),
          },
        })
        .then(() => {
          done = true;
        });
      await attempt;
      expect(done).toBe(false);
      release();
      expect((await publication).status).toBe('part_delivered');
      await mutation;
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      expect(h.transport.post).toHaveBeenCalledTimes(1);
      const [status] =
        await s.raw`select o.status from survey_report_obligations o where o.id=${r.lease.obligationId}`;
      expect(status.status).toBe('canceled');
    }, 30000);

    it('current exact-scope manager replaces opening audit owner before freeze; later ownership change never retargets the snapshot', async () => {
      const h = await setup(),
        f = h.f;
      await s.start(f);
      const observed = await lifecycle.observe(request(f)),
        lease = await lifecycle.claim(f.tenantId, observed.obligationId!);
      const built = await build.executeInitiated(f.tenantId, lease!.obligationId, lease!.token);
      if (built.status !== 'built') throw Error('built');
      const [user] = await s.raw`insert into users(tenant_id) values(${f.tenantId}) returning id`;
      await s.raw`insert into people(id,tenant_id,customer_employee_id,work_email,display_name,primary_role,pulse_participant,lifecycle_status) values(${user.id},${f.tenantId},${user.id},${user.id + '@fixture.invalid'},'New exact owner','manager',false,'active')`;
      await s.raw`insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id) values(${f.tenantId},${user.id},'slack',${'T' + f.tenantId},${'U' + user.id})`;
      await s.raw`update org_units set manager_person_id=${user.id} where tenant_id=${f.tenantId}`;
      const frozen = await h.snapshots.freeze(lease!, built);
      expect(frozen.status).toBe('snapshot_ready');
      const [route] =
        await s.raw`select route from survey_report_snapshot_payloads where snapshot_id=${frozen.snapshotId!}`;
      expect(route.route.userId).toBe(user.id);
      await s.raw`update org_units set manager_person_id=${f.manager} where tenant_id=${f.tenantId}`;
      expect((await h.delivery.deliverNext(f.tenantId, frozen.snapshotId!)).status).toBe(
        'not_claimed',
      );
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    });
    it('hierarchy row-first versus sender subject-first aborts NOWAIT before SDK and releases the complete transaction without lock inversion', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h),
        grant = await h.delivery.claim(h.f.tenantId, r.snapshotId);
      let rowReady!: () => void,
        senderReady!: () => void,
        continueSender!: () => void,
        subjectStarted!: () => void;
      const rowHeld = new Promise<void>((resolve) => {
          rowReady = resolve;
        }),
        senderAtRoute = new Promise<void>((resolve) => {
          senderReady = resolve;
        }),
        go = new Promise<void>((resolve) => {
          continueSender = resolve;
        }),
        subjectAttempt = new Promise<void>((resolve) => {
          subjectStarted = resolve;
        });
      const hierarchy = s.raw.begin(async (tx) => {
        await tx`update org_units set name=name where tenant_id=${h.f.tenantId}`;
        rowReady();
        await senderAtRoute;
        subjectStarted();
        await tx`select pg_advisory_xact_lock(hashtextextended('pulse-report-subject:'||${h.f.tenantId}||':'||${h.f.users[0]},0))`;
      });
      await rowHeld;
      let gated = false;
      const instrumented = {
        validateInTransaction: async (
          ...args: Parameters<typeof presentation.validateInTransaction>
        ) => {
          const valid = await presentation.validateInTransaction(...args);
          if (!gated) {
            gated = true;
            senderReady();
            await go;
          }
          return valid;
        },
      };
      const sender = new PulseReportDeliveryRepository(
        s.database,
        instrumented as never,
        h.recipients,
        h.transport,
      );
      const dispatch = sender.dispatch(grant!);
      await subjectAttempt;
      continueSender();
      expect((await dispatch).status).toBe('blocked');
      await hierarchy;
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    }, 10000);
    it('explicit negative reconciliation requires terminated-owner proof and retries identical bytes under a new durable attempt', async () => {
      const h = await setup(),
        r = await freeze(h),
        g = await h.delivery.claim(h.f.tenantId, r.snapshotId);
      await h.delivery.deliverNext(h.f.tenantId, r.snapshotId);
      const [a] =
        await s.raw`select body_hash from survey_report_attempts where id=${g!.attemptId}`;
      const command = {
        tenantId: h.f.tenantId,
        snapshotId: r.snapshotId,
        attemptId: g!.attemptId,
        token: g!.token,
        operator: {
          actorId: 'scoped-operator',
          tenantId: h.f.tenantId,
          snapshotId: r.snapshotId,
          authorizationRef: 'fixture-explicit-scope',
        },
        reason: 'request demonstrably never dispatched',
        evidenceRef: 'fixture:definitive-offline-case',
        decision: 'confirmed_not_sent' as const,
        evidence: {
          kind: 'definitive_nonpublication' as const,
          bodyHash: String(a.body_hash),
          ownerTerminated: false,
        },
      };
      expect((await h.delivery.reconcile(command)).status).toBe('disabled_or_invalid');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      expect(
        (
          await h.delivery.reconcile({
            ...command,
            evidence: { ...command.evidence, ownerTerminated: true },
          })
        ).status,
      ).toBe('confirmed_not_sent');
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toBe('delivered');
      expect(h.transport.post).toHaveBeenCalledTimes(1);
      const attempts =
        await s.raw`select token,body_hash,state from survey_report_attempts where snapshot_id=${r.snapshotId} order by token`;
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.body_hash).toBe(attempts[1]!.body_hash);
    });

    it('lawful soft and hard subject erasure purge restricted native content without reopening published identity or latest history', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h),
        user = h.f.users[0]!;
      expect((await h.delivery.deliverNext(h.f.tenantId, r.snapshotId)).status).toBe(
        'part_delivered',
      );
      await s.raw`update users set status='deleted',deleted_at=clock_timestamp() where id=${user}`;
      const [after] =
        await s.raw`select (select count(*)::int from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}) payload,(select count(*)::int from survey_report_native_snapshots where id=${r.snapshotId}) identity,(select count(*)::int from survey_report_final_completions where canonical_snapshot_id=${r.snapshotId}) completions,(select count(*)::int from survey_report_receipts where snapshot_id=${r.snapshotId}) receipts`;
      expect(after).toMatchObject({ payload: 0, identity: 1, receipts: 1 });
      expect(after.completions).toBeGreaterThan(0);
      await s.raw`delete from org_employee_placements where employee_person_id=${user}`;
      await s.raw`delete from users where id=${user}`;
      const latest = await new PulseReportHistoryRepository(s.database).completed(
        h.f.tenantId,
        r.lease.sections[0]!.context.historyKey,
      );
      expect(latest[0]?.authorized).toBe(false);
      await h.delivery.deliverNext(h.f.tenantId, r.snapshotId);
      expect(h.transport.post).toHaveBeenCalledTimes(1);
    });

    it('DB-now due admission fence rejects intermediate initiation before scheduler first-start without consuming the Index identity', async () => {
      const h = await setup(5, 1, true),
        f = h.f;
      // Fixture has a real due row with a synthetic within-cycle microsecond due boundary.
      // Omit scheduler refresh to represent the persisted plan waiting through a scheduler outage.
      const lagged = Object.create(schedule) as PulseReportFinalScheduleRepository;
      lagged.refresh = (tenantId, cycleId) => schedule.read(tenantId, cycleId);
      lagged.refreshInTransaction = async (tx, tenantId, cycleId) => {
        const cycle = await import('../pulse-report-configuration').then((m) =>
          m.readReportCycleExact(tx, tenantId, cycleId),
        );
        if (!cycle) return null;
        await import('../pulse-report-state').then((m) => m.lockPulseReportCycleExact(tx, cycle));
        return (await import('../pulse-report-configuration').then((m) =>
          m.readReportFinalTiming(tx, tenantId, cycleId),
        )) as never;
      };
      const recovery = new PulseReportLifecycleRepository(s.database, inputs, presentation, lagged);
      const [before] =
        await s.raw`select status,formation_started_at,final_due_at<=clock_timestamp() due from survey_report_final_timings where cycle_scoring_policy_id=${f.cycleId}`;
      expect(before.status).toBe('scheduled');
      expect(before.formation_started_at).toBeNull();
      expect(before.due).toBe(true);
      expect((await recovery.observe(request(f, 'intermediate'))).status).toBe('final_due');
      const [identities] =
        await s.raw`select count(*)::int n from survey_report_obligations where tenant_id=${f.tenantId}`;
      expect(identities.n).toBe(0);
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    });
    it('recipient erasure purges a private binding even when the exact-scope owner was never a reporting participant', async () => {
      const h = await setup(),
        r = await freeze(h),
        f = h.f;
      const [member] =
        await s.raw`select count(*)::int n from survey_report_participants where tenant_id=${f.tenantId} and user_id=${f.manager}`;
      expect(member.n).toBe(0);
      await s.raw`update users set status='deleted',deleted_at=clock_timestamp() where id=${f.manager}`;
      const [cache] =
        await s.raw`select (select count(*)::int from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}) payload,(select count(*)::int from survey_report_recipient_proofs where tenant_id=${f.tenantId}) proofs`;
      expect(cache).toMatchObject({ payload: 0, proofs: 0 });
      await s.raw`update org_units set lifecycle_status='inactive',manager_person_id=null where tenant_id=${f.tenantId}`;
      await s.raw`delete from users where id=${f.manager}`;
      expect((await h.delivery.deliverNext(f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    });
    it('a shortening tenant retention-policy edit wins row-first contention, expires actual sources, purges cached content and never sends', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h),
        f = h.f;
      let release!: () => void, ready!: () => void;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        locked = new Promise<void>((resolve) => {
          ready = resolve;
        });
      const edit = s.raw.begin(async (tx) => {
        await tx`update tenants set retention_policy=retention_policy||'{"memoryRetentionDays":0.000000001}'::jsonb where id=${f.tenantId}`;
        ready();
        await held;
      });
      await locked;
      expect((await h.delivery.deliverNext(f.tenantId, r.snapshotId)).status).toBe('blocked');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      release();
      await edit;
      expect((await h.delivery.deliverNext(f.tenantId, r.snapshotId)).status).toBe('not_claimed');
      await s.raw`select pulse_publication_payload_purge(${f.tenantId},'-infinity'::timestamptz)`;
      const [cache] =
        await s.raw`select count(*)::int n from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}`;
      expect(cache.n).toBe(0);
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    });

    it('expiry of a genuinely used prior-only baseline cancels frozen delivery without changing current candidate generation or falling back older', async () => {
      const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]),
        old = h.f;
      const row = await s.successor(old.cycleId, 1);
      const prior = await freeze(h);
      await s.raw`update users set consent_state=jsonb_set(consent_state,'{surveyEnabled}','false'::jsonb) where id=${old.users[0]}`;
      await s.waitForDbTime(row.periodStart);
      await new PulseReportScopeRepository(s.database).openOrgNativeCycle({
        tenantId: old.tenantId,
        surveyDefinitionId: old.definitionId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
      });
      const scopes =
        await s.raw`select id,kind from survey_report_scopes where cycle_scoring_policy_id=${row.id}`;
      const f = {
        ...old,
        cycleId: String(row.id),
        cycle: {
          ...old.cycle,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
        },
        users: old.users.slice(1),
        overallId: String(scopes.find((r) => r.kind === 'manager_overall')!.id),
        teamScopeId: String(scopes.find((r) => r.kind === 'team')!.id),
        windows: new Map(old.windows),
      };
      for (const u of f.users) {
        const w = await s.survey.findOrCreateActiveWindow(u, f.tenantId);
        if (!w || 'kind' in w) throw Error('current window');
        f.windows.set(u, w.id);
        await addPulsePresentationTopics(s, f, u, 60);
      }
      const current = await freeze({ ...h, f }, 'intermediate');
      expect(current.built.provenance.sections[0]!.baselines?.autonomy?.status).toBe('comparable');
      const [membership] =
        await s.raw`select count(*)::int n from survey_report_participants where cycle_scoring_policy_id=${f.cycleId} and user_id=${old.users[0]}`;
      expect(membership.n).toBe(0);
      const before = current.lease.sections[0]!.context.generation;
      await s.raw`update survey_report_input_candidates set expires_at=clock_timestamp()-interval '1 second' where cycle_id=${old.cycleId}`;
      expect((await h.delivery.deliverNext(f.tenantId, current.snapshotId)).status).toBe(
        'not_claimed',
      );
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      const [generation] =
        await s.raw`select generation from survey_report_input_generations where cycle_id=${f.cycleId}`;
      expect(Number(generation.generation)).toBe(before);
      expect(prior.snapshotId).toBeTruthy();
    }, 90000);

    async function retain(tenantId: string) {
      const epoch = new Date('1970-01-01');
      await new RetentionRepository(s.database).applyRetention({
        tenantId,
        now: new Date(),
        messagesCutoff: epoch,
        memoryCutoff: epoch,
        riskSignalCutoff: epoch,
        auditLogCutoff: epoch,
      });
    }
    it('R1 numeric-only soft/hard subject erasure closes assembly and snapshot dependencies before cascades', async () => {
      for (const hard of [false, true])
        for (const persisted of [false, true]) {
          const h = await setup(6, 1, true, 1, true),
            user = h.f.users[0]!;
          await s.start(h.f);
          const observed = await lifecycle.observe(request(h.f)),
            lease = await lifecycle.claim(h.f.tenantId, observed.obligationId!);
          expect(lease).not.toBeNull();
          let snapshotId: string | undefined;
          if (persisted) {
            const built = await build.executeInitiated(
              h.f.tenantId,
              lease!.obligationId,
              lease!.token,
            );
            if (built.status !== 'built') throw Error('build');
            snapshotId = (await h.snapshots.freeze(lease!, built)).snapshotId;
            await h.delivery.claim(h.f.tenantId, snapshotId!);
          }
          if (hard) {
            await s.raw`delete from org_employee_placements where employee_person_id=${user}`;
            await s.raw`delete from users where id=${user}`;
          } else
            await s.raw`update users set deleted_at=clock_timestamp(),status='deleted' where id=${user}`;
          const [left] =
            await s.raw`select (select count(*)::int from survey_report_assembly_inputs where obligation_id=${lease!.obligationId}) assembly,(select count(*)::int from survey_report_snapshot_payloads where snapshot_id=${snapshotId ?? randomUUID()}) payload`;
          expect(left).toMatchObject({ assembly: 0, payload: 0 });
          if (snapshotId) {
            const [identity] =
              await s.raw`select o.status,s.purged_at,(select count(*)::int from survey_report_attempts where snapshot_id=s.id) attempts from survey_report_native_snapshots s join survey_report_obligations o on o.id=s.obligation_id where s.id=${snapshotId}`;
            expect(identity.purged_at).not.toBeNull();
            expect(identity.status).toBe('reconciliation_required');
            expect(identity.attempts).toBe(1);
          }
        }
    }, 45000);
    it('R1 prior-only soft/hard erasure purges frozen copies or rebases the same live current observation without stale scalars', async () => {
      for (const hard of [false, true])
        for (const persisted of [false, true]) {
          const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]),
            prior = await freeze(h),
            subject = h.f.users[0]!;
          await s.raw`update users set consent_state=jsonb_set(consent_state,'{surveyEnabled}','false'::jsonb) where id=${subject}`;
          const current = await next({ ...h.f, users: h.f.users.slice(1) }, 1),
            observed = await lifecycle.observe(request(current, 'intermediate')),
            lease = await lifecycle.claim(current.tenantId, observed.obligationId!);
          expect(lease!.sections[0]!.baselines?.autonomy?.status).toBe('comparable');
          let snapshotId: string | undefined;
          if (persisted) {
            const built = await build.executeInitiated(
              current.tenantId,
              lease!.obligationId,
              lease!.token,
            );
            if (built.status !== 'built') throw Error('current build');
            snapshotId = (await h.snapshots.freeze(lease!, built)).snapshotId;
            await h.delivery.claim(current.tenantId, snapshotId!);
          }
          if (hard) {
            await s.raw`delete from org_employee_placements where employee_person_id=${subject}`;
            await s.raw`delete from users where id=${subject}`;
          } else
            await s.raw`update users set deleted_at=clock_timestamp(),status='deleted' where id=${subject}`;
          if (snapshotId) {
            const [state] =
              await s.raw`select o.status,s.purged_at,(select count(*)::int from survey_report_snapshot_payloads where snapshot_id=s.id) payloads from survey_report_native_snapshots s join survey_report_obligations o on o.id=s.obligation_id where s.id=${snapshotId}`;
            expect(state).toMatchObject({ status: 'reconciliation_required', payloads: 0 });
            expect(state.purged_at).not.toBeNull();
          } else {
            const [cache] =
              await s.raw`select sections from survey_report_assembly_inputs where obligation_id=${lease!.obligationId}`;
            expect(cache).toBeTruthy();
            for (const section of cache.sections) {
              expect(section.baselines).toEqual({});
              expect(
                section.baselineInventory.every(
                  (x: { metrics: unknown[] }) => x.metrics.length === 0,
                ),
              ).toBe(true);
            }
            const recovered = await lifecycle.claim(current.tenantId, lease!.obligationId);
            expect(recovered).not.toBeNull();
            expect(recovered!.sections[0]!.context.frontier).toBe(
              lease!.sections[0]!.context.frontier,
            );
            expect(recovered!.sections[0]!.baselines?.autonomy?.status).toBe(
              'baseline_established',
            );
            const rebuilt = await build.executeInitiated(
              current.tenantId,
              recovered!.obligationId,
              recovered!.token,
            );
            if (rebuilt.status !== 'built') throw Error('rebase build');
            expect((await h.snapshots.freeze(recovered!, rebuilt)).status).toBe('snapshot_ready');
          }
          expect(prior.snapshotId).toBeTruthy();
        }
    }, 150000);
    it('R2 real many-section assembly renews the same owner and genuine takeover rejects old renew/commit/defer', async () => {
      const h = await setup(15, 3, true),
        local = new PulseReportLifecycleRepository(
          s.database,
          inputs,
          presentation,
          schedule,
          1200,
        ),
        localBuild = new BuildPulseReportUseCase(
          presentation,
          inputs,
          {
            ...narrative,
            draft: async (input: PulseNarrativeRequest) => {
              await new Promise((resolve) => setTimeout(resolve, 400));
              return narrative.draft(input);
            },
          },
          local,
        );
      await s.start(h.f);
      const observed = await local.observe(request(h.f));
      const result = await new FormPulseReportUseCase(local, localBuild, h.snapshots).execute(
        h.f.tenantId,
        observed.obligationId!,
      );
      expect(result.status).toBe('snapshot_ready');
      const another = await setup(6, 1, true),
        o = await local.observe(request(another.f, 'intermediate')),
        first = await local.claim(another.f.tenantId, o.obligationId!);
      expect(await local.renew(first!)).toBe(true);
      await s.raw`update survey_report_obligations set lease_until=clock_timestamp()-interval '1 second' where id=${first!.obligationId}`;
      const owner = await local.claim(another.f.tenantId, first!.obligationId);
      expect(owner!.token).toBeGreaterThan(first!.token);
      expect(await local.renew(first!)).toBe(false);
      await local.defer(first!, 'lease_lost');
      expect((await local.load(owner!.tenantId, owner!.obligationId, owner!.token))?.token).toBe(
        owner!.token,
      );
      const stale = await localBuild.executeInitiated(
        first!.tenantId,
        first!.obligationId,
        first!.token,
      );
      expect(stale.status).toBe('invalidated');
    }, 30000);
    it('R3 near-expiry sources bound unresolved-recipient assembly caches and normal retention removes every expired copy', async () => {
      const h = await setup(5, 1, true);
      await s.raw`update tenants set retention_policy=retention_policy||'{"memoryRetentionDays":0.0001}'::jsonb where id=${h.f.tenantId}`;
      await s.start(h.f);
      const observed = await lifecycle.observe(request(h.f));
      const [deadline] =
        await s.raw`select i.expires_at <= (select min(processed_at)+interval '8.64 seconds' from survey_question_insights where tenant_id=${h.f.tenantId}) bounded from survey_report_assembly_inputs i where obligation_id=${observed.obligationId!}`;
      expect(deadline.bounded).toBe(true);
      await s.raw`update tenants set retention_policy=retention_policy||'{"memoryRetentionDays":0.000000001}'::jsonb where id=${h.f.tenantId}`;
      await retain(h.f.tenantId);
      const [left] =
        await s.raw`select count(*)::int n from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
      expect(left.n).toBe(0);
    });
    it('R3 selected prior near-expiry bounds blocked assembly and strips expired history without losing live current inputs', async () => {
      const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]);
      await freeze(h);
      const current = await next(h.f, 1);
      // Near-expiry is anchored to the DB clock (15 s after this update), not a fixed 17.28 s from setup start.
      await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(extract(epoch from(clock_timestamp()-(select min(insight.processed_at) from survey_question_insights insight join survey_report_window_bindings binding on binding.survey_window_id=insight.survey_window_id where binding.cycle_scoring_policy_id=${h.f.cycleId})+interval '15 seconds'))/86400)) where id=${h.f.tenantId}`;
      const observed = await lifecycle.observe(request(current, 'intermediate')),
        lease = await lifecycle.claim(current.tenantId, observed.obligationId!);
      await s.raw`delete from channel_accounts where tenant_id=${h.f.tenantId} and user_id=${h.f.manager}`;
      const built = await build.executeInitiated(
        current.tenantId,
        lease!.obligationId,
        lease!.token,
      );
      if (built.status !== 'built') throw Error('build');
      expect((await h.snapshots.freeze(lease!, built)).status).toBe('blocked');
      const [deadline] =
        await s.raw`select i.expires_at<=(select min(insight.processed_at)+make_interval(secs=>(select (retention_policy->>'memoryRetentionDays')::float8*86400 from tenants where id=${h.f.tenantId})) from survey_report_candidate_sources source join survey_question_insights insight on insight.id=source.revision_id join survey_report_input_candidates c on c.id=source.candidate_id where c.cycle_id=${h.f.cycleId}) bounded from survey_report_assembly_inputs i where i.obligation_id=${lease!.obligationId}`;
      expect(deadline.bounded).toBe(true);
      await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb((extract(epoch from(clock_timestamp()-(select max(source_time)+interval '250 milliseconds' from (select insight.processed_at source_time from survey_question_insights insight join survey_report_window_bindings binding on binding.survey_window_id=insight.survey_window_id where binding.cycle_scoring_policy_id=${h.f.cycleId} union all select answer_received_at from survey_engagement_answer_revisions where cycle_scoring_policy_id=${h.f.cycleId}) old_sources))))/86400)) where id=${h.f.tenantId}`;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await retain(h.f.tenantId);
      const [cache] =
        await s.raw`select sections from survey_report_assembly_inputs where obligation_id=${lease!.obligationId}`;
      expect(cache).toBeTruthy();
      expect(
        cache.sections.every((section: { baselineInventory: { metrics: unknown[] }[] }) =>
          section.baselineInventory.every((h) => h.metrics.length === 0),
        ),
      ).toBe(true);
      const nextOwner = await lifecycle.claim(current.tenantId, lease!.obligationId);
      expect(nextOwner).not.toBeNull();
      expect(nextOwner!.sections[0]!.context.frontier).toBe(lease!.sections[0]!.context.frontier);
      expect(nextOwner!.sections[0]!.baselines?.autonomy?.status).toBe('baseline_established');
    }, 80000);
    it('R1 erasure of a recipient outside participation purges its unresolved assembly cache', async () => {
      const h = await setup(5, 1, true);
      await s.start(h.f);
      const observed = await lifecycle.observe(request(h.f));
      const [membership] =
        await s.raw`select count(*)::int n from survey_report_participants where cycle_scoring_policy_id=${h.f.cycleId} and user_id=${h.f.manager}`;
      expect(membership.n).toBe(0);
      await s.raw`update users set status='deleted',deleted_at=clock_timestamp() where id=${h.f.manager}`;
      const [left] =
        await s.raw`select count(*)::int n from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
      expect(left.n).toBe(0);
    });
    it('R3-ordering natural prior expiry repairs before retention at the same current frontier; expired current remains canceled', async () => {
      const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]);
      await freeze(h);
      const current = await next(h.f, 1);
      await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(extract(epoch from(clock_timestamp()-(select min(insight.processed_at) from survey_question_insights insight join survey_report_window_bindings binding on binding.survey_window_id=insight.survey_window_id where binding.cycle_scoring_policy_id=${h.f.cycleId})+interval '2 seconds'))/86400)) where id=${h.f.tenantId}`;
      const observed = await lifecycle.observe(request(current, 'intermediate')),
        lease = await lifecycle.claim(current.tenantId, observed.obligationId!);
      expect(lease!.sections[0]!.baselines?.autonomy?.status).toBe('comparable');
      await s.raw`delete from channel_accounts where tenant_id=${h.f.tenantId} and user_id=${h.f.manager}`;
      const built = await build.executeInitiated(
        current.tenantId,
        lease!.obligationId,
        lease!.token,
      );
      if (built.status !== 'built') throw Error('build');
      expect((await h.snapshots.freeze(lease!, built)).status).toBe('blocked');
      await lifecycle.defer(lease!, 'blocked');
      const [wait] =
        await s.raw`select greatest(0,extract(epoch from(expires_at-clock_timestamp()))*1000)::float8 ms from survey_report_assembly_inputs where obligation_id=${lease!.obligationId}`;
      await new Promise((resolve) => setTimeout(resolve, Number(wait.ms) + 75));
      const [deadlines] =
        await s.raw`select i.expires_at<=clock_timestamp() prior_expired,pulse_candidate_content_deadline(i.tenant_id,ARRAY(select (section->>'candidateId')::uuid from jsonb_array_elements(i.sections) section))>clock_timestamp() current_live from survey_report_assembly_inputs i where obligation_id=${lease!.obligationId}`;
      expect(deadlines).toMatchObject({ prior_expired: true, current_live: true });
      await s.raw`insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id) values(${h.f.tenantId},${h.f.manager},'slack',${'T' + h.f.tenantId},${'U' + h.f.manager})`;
      const result = await new FormPulseReportUseCase(lifecycle, build, h.snapshots).execute(
        current.tenantId,
        lease!.obligationId,
      );
      expect(result.status).toBe('snapshot_ready');
      const [frozen] =
        await s.raw`select p.provenance from survey_report_snapshot_payloads p join survey_report_native_snapshots snapshot on snapshot.id=p.snapshot_id where snapshot.obligation_id=${lease!.obligationId}`;
      expect(frozen.provenance.sections[0].context.frontier).toBe(
        lease!.sections[0]!.context.frontier,
      );
      expect(frozen.provenance.sections[0].baselines.autonomy.status).toBe('baseline_established');
      const expired = await setup(5, 1, true);
      // Near-expiry is anchored to the DB clock (2 s after this update), not a fixed 2.16 s from setup start.
      await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(extract(epoch from(clock_timestamp()-(select min(source_time) from (select processed_at source_time from survey_question_insights where tenant_id=${expired.f.tenantId} union all select answer_received_at from survey_engagement_answer_revisions where cycle_scoring_policy_id=${expired.f.cycleId}) sources)+interval '2 seconds'))/86400)) where id=${expired.f.tenantId}`;
      const o = await lifecycle.observe(request(expired.f, 'intermediate'));
      expect(o.obligationId).toBeTruthy();
      const [left] =
        await s.raw`select greatest(0,extract(epoch from(expires_at-clock_timestamp()))*1000)::float8 ms from survey_report_assembly_inputs where obligation_id=${o.obligationId!}`;
      await new Promise((resolve) => setTimeout(resolve, Number(left.ms) + 75));
      expect(await lifecycle.claim(expired.f.tenantId, o.obligationId!)).toBeNull();
      const [state] =
        await s.raw`select status from survey_report_obligations where id=${o.obligationId!}`;
      expect(state.status).toBe('canceled');
    }, 80000);
    it('R3-boundary prior expiry after precheck and before owner CAS or load never terminally cancels the live current observation', async () => {
      for (const phase of ['owner', 'load'] as const) {
        const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]);
        await freeze(h);
        const f = await next(h.f, 1);
        await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(extract(epoch from(clock_timestamp()-(select min(insight.processed_at) from survey_question_insights insight join survey_report_window_bindings binding on binding.survey_window_id=insight.survey_window_id where binding.cycle_scoring_policy_id=${h.f.cycleId})+interval '2 seconds'))/86400)) where id=${h.f.tenantId}`;
        const observed = await lifecycle.observe(request(f, 'intermediate'));
        const [before] =
          await s.raw`select sections,expires_at>clock_timestamp() live from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
        expect(before.live).toBe(true);
        let blocked = false;
        const client = new Proxy(s.db, {
          get(target, key) {
            if (key === 'execute')
              return async (query: unknown) => {
                const text = new PgDialect().sqlToQuery(query as never).sql;
                const boundary =
                  phase === 'owner'
                    ? text.includes('assembly_inputs_expired') ||
                      text.includes("set status='assembling',assembly_token=assembly_token+1")
                    : text.includes('select i.context,i.sections from survey_report_obligations');
                if (!blocked && boundary) {
                  blocked = true;
                  const [wait] =
                    await s.raw`select greatest(0,extract(epoch from(expires_at-clock_timestamp()))*1000)::float8 ms from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
                  await new Promise((resolve) => setTimeout(resolve, Number(wait.ms) + 75));
                }
                return target.execute(query as never);
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const repository = new PulseReportLifecycleRepository(
            { client } as never,
            inputs,
            presentation,
            schedule,
          ),
          builder = new BuildPulseReportUseCase(presentation, inputs, narrative, repository);
        const result = await new FormPulseReportUseCase(repository, builder, h.snapshots).execute(
          f.tenantId,
          observed.obligationId!,
        );
        expect(blocked).toBe(true);
        expect(result.status).toBe('snapshot_ready');
        const [after] =
          await s.raw`select o.status,p.provenance from survey_report_obligations o join survey_report_native_snapshots snapshot on snapshot.obligation_id=o.id join survey_report_snapshot_payloads p on p.snapshot_id=snapshot.id where o.id=${observed.obligationId!}`;
        expect(after.status).toBe('snapshot_ready');
        expect(after.provenance.sections[0].context.frontier).toBe(
          before.sections[0].context.frontier,
        );
        expect(after.provenance.sections[0].baselines.autonomy.status).toBe('baseline_established');
      }
    }, 100000);
    it('R3-compute expiry after narrative discards the old draft and scrubs prior copies before retry without canceling current inputs', async () => {
      const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]);
      await freeze(h);
      const f = await next(h.f, 1);
      await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(extract(epoch from(clock_timestamp()-(select min(insight.processed_at) from survey_question_insights insight join survey_report_window_bindings binding on binding.survey_window_id=insight.survey_window_id where binding.cycle_scoring_policy_id=${h.f.cycleId})+interval '2 seconds'))/86400)) where id=${h.f.tenantId}`;
      const observed = await lifecycle.observe(request(f, 'intermediate'));
      const [before] =
        await s.raw`select sections from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
      let worked = false,
        blocked = false;
      const client = new Proxy(s.db, {
        get(target, key) {
          if (key === 'execute')
            return async (query: unknown) => {
              const text = new PgDialect().sqlToQuery(query as never).sql;
              if (
                worked &&
                !blocked &&
                text.includes('select i.context,i.sections from survey_report_obligations')
              ) {
                blocked = true;
                const [wait] =
                  await s.raw`select greatest(0,extract(epoch from(expires_at-clock_timestamp()))*1000)::float8 ms from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
                await new Promise((resolve) => setTimeout(resolve, Number(wait.ms) + 75));
              }
              return target.execute(query as never);
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const repository = new PulseReportLifecycleRepository(
          { client } as never,
          inputs,
          presentation,
          schedule,
        ),
        builder = new BuildPulseReportUseCase(
          presentation,
          inputs,
          {
            ...narrative,
            draft: async (input: PulseNarrativeRequest) => {
              worked = true;
              return narrative.draft(input);
            },
          },
          repository,
        ),
        form = new FormPulseReportUseCase(repository, builder, h.snapshots);
      expect((await form.execute(f.tenantId, observed.obligationId!)).status).toBe('lease_lost');
      expect(blocked).toBe(true);
      const [after] =
        await s.raw`select o.status,o.assembly_token,i.sections,(select count(*)::int from survey_report_native_snapshots where obligation_id=o.id) snapshots from survey_report_obligations o join survey_report_assembly_inputs i on i.obligation_id=o.id where o.id=${observed.obligationId!}`;
      expect(after).toMatchObject({ status: 'pending', snapshots: 0 });
      expect(after.sections[0].context.frontier).toBe(before.sections[0].context.frontier);
      expect(
        after.sections.every((section: { baselineInventory: { metrics: unknown[] }[] }) =>
          section.baselineInventory.every((h) => h.metrics.length === 0),
        ),
      ).toBe(true);
      const oldLease = {
        tenantId: f.tenantId,
        obligationId: observed.obligationId!,
        token: Number(after.assembly_token) - 1,
      } as never;
      await repository.defer(oldLease, 'invalidated');
      const [state] =
        await s.raw`select status from survey_report_obligations where id=${observed.obligationId!}`;
      expect(state.status).toBe('pending');
      const calls = narrative.draft.mock.calls.length;
      expect((await form.execute(f.tenantId, observed.obligationId!)).status).toBe(
        'snapshot_ready',
      );
      expect(narrative.draft.mock.calls.length).toBeGreaterThan(calls);
    }, 75000);
    async function upgradeStoredHistory(tenantId: string) {
      const [fn] =
        await s.raw`select to_regprocedure('pulse_native_upgrade_history_inventory(uuid)') present`;
      if (fn.present) {
        await s.raw`select pulse_native_upgrade_history_inventory(${tenantId})`;
        return;
      }
      // RED compatibility: execute the applied0092 data-backfill behavior on this fixture's rows.
      await s.raw`update survey_report_assembly_inputs set sections=pulse_native_minimize_history(sections) where tenant_id=${tenantId}`;
      const stale =
        await s.raw`select distinct snapshot.id from survey_report_native_snapshots snapshot join survey_report_snapshot_payloads p on p.snapshot_id=snapshot.id cross join lateral jsonb_array_elements(p.provenance->'sections') section cross join lateral jsonb_array_elements(coalesce(section->'baselineInventory','[]')) h where snapshot.tenant_id=${tenantId} and h->'metrics'<>'[]'::jsonb and not(p.contracts->'sourceCandidateIds' ? (h->>'candidateId'))`;
      for (const item of stale)
        await s.raw`select pulse_native_purge_snapshot(${item.id},'historical_inventory_minimized')`;
    }
    async function legacyPackage(
      h: Awaited<ReturnType<typeof setup>>,
      purpose: 'final' | 'intermediate',
      selected = false,
      baselineChange?: { key: string; value?: unknown; remove?: boolean },
    ) {
      if (purpose === 'final') expect((await s.start(h.f)).status).toBe('started');
      const observed = await lifecycle.observe(request(h.f, purpose));
      if (!observed.obligationId)
        throw Error('legacy observe ' + JSON.stringify({ purpose, selected, observed }));
      const owner = await lifecycle.claim(h.f.tenantId, observed.obligationId!);
      if (!owner) throw Error('legacy owner');
      const built = await build.executeInitiated(h.f.tenantId, owner.obligationId, owner.token);
      if (built.status !== 'built') throw Error('legacy build');
      const sections = owner.sections.map((section) => ({
        ...section,
        baselines: {
          ...Object.fromEntries(
            section.metrics.map((metric, index) => [
              metric.metricKey,
              { status: selected && index % 2 ? 'no_previous_final' : 'baseline_established' },
            ]),
          ),
          ...section.baselines,
        },
      }));
      expect(Object.keys(sections[0]!.baselines).length).toBeGreaterThan(1);
      if (!selected)
        expect(sections.every((section) => section.baselineInventory?.length === 0)).toBe(true);
      else {
        const key = purpose === 'final' ? 'engagement' : 'autonomy';
        expect(sections[0]!.baselines[key]?.status).toBe('comparable');
        expect(
          sections.some((section) =>
            section.baselineInventory?.some((item) => item.metrics.length > 0),
          ),
        ).toBe(true);
        expect(
          sections.every((section) =>
            section.baselineInventory?.every((item) =>
              item.metrics.every((metric) => metric.metricKey === key),
            ),
          ),
        ).toBe(true);
      }
      if (baselineChange)
        for (const section of sections) {
          const baselines = section.baselines as Record<string, unknown>;
          if (baselineChange.remove) delete baselines[baselineChange.key];
          else baselines[baselineChange.key] = baselineChange.value;
        }
      const slack = renderPulseReportForSlack(built.presentation),
        candidate = await h.recipients.resolve(h.f.tenantId, h.f.overallId);
      if (!candidate) throw Error('legacy recipient');
      const route = await h.recipients.verify(candidate, (await h.transport.prove(candidate))!);
      if (!route) throw Error('legacy route');
      const [policy] =
        await s.raw`select c.scoring_policy_id,p.version from survey_cycle_scoring_policies c join survey_scoring_policies p on p.id=c.scoring_policy_id where c.id=${h.f.cycleId}`;
      const contracts = {
          input: PULSE_INPUT_CONTRACT,
          calculation: PULSE_REPORT_CALCULATION_CONTRACT,
          privacy: PULSE_REPORT_PRIVACY_POLICY_VERSION,
          answer: ENGAGEMENT_ANSWER_CONTRACT,
          presentation: PULSE_PRESENTATION_CONTRACT,
          labels: PULSE_LABEL_VERSION,
          channel: 'pulse-slack-v1',
          delivery: PULSE_DELIVERY_CONTRACT,
          scoringPolicyId: String(policy.scoring_policy_id),
          scoringVersion: String(policy.version),
          sourceCandidateIds: [
            ...new Set(
              sections.flatMap((section) => [
                section.candidateId,
                ...(section.baselineInventory ?? [])
                  .filter((item) => item.metrics.length > 0)
                  .map((item) => item.candidateId!),
              ]),
            ),
          ],
        },
        provenance = { ...built.provenance, sections },
        artifactHash = pulsePublicationHash({
          contracts,
          presentation: built.presentation,
          provenance,
          manifest: slack.manifest,
          parts: slack.parts,
          route,
        }),
        snapshotId = randomUUID();
      await s.raw`insert into survey_report_native_snapshots(id,tenant_id,obligation_id,cycle_id,scope_id,purpose,artifact_hash,part_count,expires_at) values(${snapshotId},${h.f.tenantId},${owner.obligationId},${h.f.cycleId},${h.f.overallId},${purpose},${artifactHash},${slack.parts.length},clock_timestamp()+interval '1 day')`;
      await s.raw`insert into survey_report_snapshot_payloads(snapshot_id,tenant_id,contracts,presentation,provenance,manifest,route) values(${snapshotId},${h.f.tenantId},${JSON.stringify(contracts)}::jsonb,${JSON.stringify(built.presentation)}::jsonb,${JSON.stringify(provenance)}::jsonb,${JSON.stringify(slack.manifest)}::jsonb,${JSON.stringify(route)}::jsonb)`;
      for (const [index, part] of slack.parts.entries()) {
        const id = randomUUID();
        await s.raw`insert into survey_report_parts(id,tenant_id,snapshot_id,ordinal,body_hash) values(${id},${h.f.tenantId},${snapshotId},${index + 1},${pulsePublicationHash(part)})`;
        await s.raw`insert into survey_report_part_payloads(part_id,payload) values(${id},${JSON.stringify(part)}::jsonb)`;
      }
      if (purpose === 'final' && sections[0]!.finalGate === 'eligible')
        for (const section of sections) {
          for (const metric of section.metrics.filter((metric) => metric.status === 'eligible'))
            await s.raw`insert into survey_report_completion_supports(snapshot_id,candidate_id,tenant_id,cycle_id,history_key,metric_key,context_hash) values(${snapshotId},${section.candidateId},${h.f.tenantId},${h.f.cycleId},${section.context.historyKey},${metric.metricKey},${pulsePublicationHash(section.context)})`;
          await s.raw`insert into survey_report_final_completions(candidate_id,canonical_snapshot_id) values(${section.candidateId},${snapshotId})`;
        }
      await s.raw`update survey_report_obligations set status='snapshot_ready',lease_until=null where id=${owner.obligationId}`;
      await s.raw`delete from survey_report_assembly_inputs where obligation_id=${owner.obligationId}`;
      const signature = async () => {
        const [row] =
          await s.raw`select jsonb_build_object('snapshot',to_jsonb(snapshot),'payload',to_jsonb(payload),'obligation',to_jsonb(obligation),'parts',(select jsonb_agg(to_jsonb(part)||jsonb_build_object('body',body.payload) order by part.ordinal) from survey_report_parts part left join survey_report_part_payloads body on body.part_id=part.id where part.snapshot_id=snapshot.id),'supports',(select jsonb_agg(to_jsonb(support) order by support.candidate_id,support.metric_key) from survey_report_completion_supports support where support.snapshot_id=snapshot.id),'completions',(select jsonb_agg(to_jsonb(completion) order by completion.candidate_id) from survey_report_final_completions completion where completion.canonical_snapshot_id=snapshot.id)) value from survey_report_native_snapshots snapshot join survey_report_obligations obligation on obligation.id=snapshot.obligation_id left join survey_report_snapshot_payloads payload on payload.snapshot_id=snapshot.id where snapshot.id=${snapshotId}`;
        return row.value;
      };
      return { signature, snapshotId, historyKey: owner.sections[0]!.context.historyKey };
    }
    it('R5-safe-v1 upgrade preserves exact first-cycle and allowed-only selected historical packages despite extra content-free status keys', async () => {
      async function deliverOriginal(
        h: Awaited<ReturnType<typeof setup>>,
        old: Awaited<ReturnType<typeof legacyPackage>>,
      ) {
        const before = await old.signature(),
          calls = h.transport.post.mock.calls.length,
          narrativeCalls = narrative.draft.mock.calls.length;
        for (let index = 0; index < before.parts.length; index++)
          expect((await h.delivery.deliverNext(h.f.tenantId, old.snapshotId)).status).toBe(
            index === before.parts.length - 1 ? 'delivered' : 'part_delivered',
          );
        expect(h.transport.post.mock.calls.slice(calls).map((call) => call[2])).toEqual(
          before.parts.map((part: { body: unknown }) => part.body),
        );
        expect(narrative.draft.mock.calls.length).toBe(narrativeCalls);
        const after = await old.signature();
        expect(after.snapshot).toEqual(before.snapshot);
        expect(after.payload).toEqual(before.payload);
        expect(after.supports).toEqual(before.supports);
        expect(after.completions).toEqual(before.completions);
        expect(after.obligation.id).toBe(before.obligation.id);
        expect(after.obligation.status).toBe('delivered');
        expect(
          after.parts.map(
            (part: {
              id: string;
              ordinal: number;
              body_hash: string;
              body: unknown;
              status: string;
            }) => ({
              id: part.id,
              ordinal: part.ordinal,
              body_hash: part.body_hash,
              body: part.body,
            }),
          ),
        ).toEqual(
          before.parts.map(
            (part: { id: string; ordinal: number; body_hash: string; body: unknown }) => ({
              id: part.id,
              ordinal: part.ordinal,
              body_hash: part.body_hash,
              body: part.body,
            }),
          ),
        );
        expect(after.parts.every((part: { status: string }) => part.status === 'delivered')).toBe(
          true,
        );
        await h.delivery.deliverNext(h.f.tenantId, old.snapshotId);
        expect(h.transport.post.mock.calls.length).toBe(calls + before.parts.length);
      }
      for (const variant of ['final', 'intermediate', 'notice'] as const) {
        const h = await setup(
          6,
          1,
          variant !== 'notice',
          variant === 'intermediate' ? 1 : SHORT_WINDOW_DAYS,
        );
        if (variant === 'intermediate')
          await s.raw.begin(async (tx) => {
            await tx`set local session_replication_role=replica`;
            await tx`update survey_report_final_timings set final_due_at=(select period_end from survey_cycle_scoring_policies where id=${h.f.cycleId}) where cycle_scoring_policy_id=${h.f.cycleId}`;
            await tx`set local session_replication_role=origin`;
          });
        if (variant === 'notice')
          for (const user of h.f.users.slice(0, 4))
            for (let q = 0; q < 3; q++) await s.numeric(h.f, user, q);
        const old = await legacyPackage(h, variant === 'intermediate' ? 'intermediate' : 'final'),
          before = await old.signature(),
          history = await new PulseReportHistoryRepository(s.database).completed(
            h.f.tenantId,
            old.historyKey,
          );
        await upgradeStoredHistory(h.f.tenantId);
        expect(await old.signature()).toEqual(before);
        expect(
          await new PulseReportHistoryRepository(s.database).completed(
            h.f.tenantId,
            old.historyKey,
          ),
        ).toEqual(history);
        await deliverOriginal(h, old);
      }
      for (const purpose of ['final', 'intermediate'] as const) {
        const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]),
          a = await legacyPackage(h, 'final'),
          f = await next(h.f, 1);
        if (purpose === 'final') {
          for (const user of f.users) for (let q = 0; q < 3; q++) await s.numeric(f, user, q);
          await s.raw.begin(async (tx) => {
            await tx`set local session_replication_role=replica`;
            await tx`update survey_report_final_timings set status='scheduled',blocked_reason=null,timezone='UTC',local_date='2026-10-28',local_work_end='23:59',final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=${f.cycleId}) where cycle_scoring_policy_id=${f.cycleId}`;
            await tx`set local session_replication_role=origin`;
          });
        }
        const b = await legacyPackage({ ...h, f }, purpose, true),
          beforeA = await a.signature(),
          beforeB = await b.signature(),
          history = await new PulseReportHistoryRepository(s.database).completed(
            f.tenantId,
            b.historyKey,
          );
        await upgradeStoredHistory(f.tenantId);
        expect(await a.signature()).toEqual(beforeA);
        expect(await b.signature()).toEqual(beforeB);
        expect(
          await new PulseReportHistoryRepository(s.database).completed(f.tenantId, b.historyKey),
        ).toEqual(history);
        expect(history.some((item) => item.authorized && item.metrics.length > 0)).toBe(true);
        await deliverOriginal(h, a);
        await deliverOriginal({ ...h, f }, b);
      }
    }, 180000);
    it('R5-v1 reader rejects unsafe extra objects and missing or changed displayed keys without sending any immutable part', async () => {
      for (const purpose of ['final', 'intermediate'] as const)
        for (const change of [
          'scalar',
          'unknown_field',
          'unknown_status',
          'missing_displayed',
          'changed_displayed',
        ] as const) {
          const h = await setup(6, 1, true);
          if (purpose === 'intermediate')
            await s.raw.begin(async (tx) => {
              await tx`set local session_replication_role=replica`;
              await tx`update survey_report_final_timings set final_due_at=(select period_end from survey_cycle_scoring_policies where id=${h.f.cycleId}) where cycle_scoring_policy_id=${h.f.cycleId}`;
              await tx`set local session_replication_role=origin`;
            });
          const displayed = purpose === 'final' ? 'engagement' : 'autonomy',
            extra = purpose === 'final' ? 'autonomy' : 'engagement',
            edit =
              change === 'missing_displayed'
                ? { key: displayed, remove: true }
                : change === 'changed_displayed'
                  ? { key: displayed, value: { status: 'no_previous_final' } }
                  : {
                      key: extra,
                      value:
                        change === 'scalar'
                          ? { status: 'baseline_established', rawMean: 7 }
                          : change === 'unknown_field'
                            ? { status: 'no_previous_final', unexpected: true }
                            : { status: 'unknown_status' },
                    },
            old = await legacyPackage(h, purpose, false, edit),
            before = await old.signature();
          expect((await h.delivery.deliverNext(h.f.tenantId, old.snapshotId)).status).toBe(
            'not_claimed',
          );
          expect(h.transport.post).not.toHaveBeenCalled();
          const after = await old.signature();
          expect(after.obligation.status).toBe('canceled');
          expect(after.obligation.disposition).toBe('authorization_invalid');
          expect(after.snapshot).toEqual(before.snapshot);
          expect(after.payload).toEqual(before.payload);
          expect(after.parts.every((part: { status: string }) => part.status === 'canceled')).toBe(
            true,
          );
        }
    }, 150000);
    it('R5-upgrade v1 selected-candidate mixed metrics are purged or narrowed for final/intermediate/notice while identity and evidence survive', async () => {
      for (const variant of ['final', 'intermediate', 'notice'] as const) {
        const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [1]),
          a = await freeze(h),
          f = await next(h.f, 1),
          purpose = variant === 'intermediate' ? 'intermediate' : 'final';
        if (variant === 'final')
          for (const user of f.users) for (let q = 0; q < 3; q++) await s.numeric(f, user, q);
        if (purpose === 'final') {
          await s.raw.begin(async (tx) => {
            await tx`set local session_replication_role=replica`;
            await tx`update survey_report_final_timings set status='scheduled',blocked_reason=null,timezone='UTC',local_date='2026-10-28',local_work_end='23:59',final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=${f.cycleId}) where cycle_scoring_policy_id=${f.cycleId}`;
            await tx`set local session_replication_role=origin`;
          });
          expect((await s.start(f)).status).toBe('started');
        }
        const manager = await lifecycle.observe(request(f, purpose));
        expect(manager.obligationId).toBeTruthy();
        const owner = await lifecycle.claim(f.tenantId, manager.obligationId!),
          team = await lifecycle.observe(request(f, purpose, 'team_lead')),
          teamOwner = await lifecycle.claim(f.tenantId, team.obligationId!);
        const legacySections = async (sections: NonNullable<typeof owner>['sections']) => {
          const prepared = await inputs.refreshHistoricalSelection(sections);
          return Promise.all(
            prepared.map(async (section) => ({
              ...section,
              baselineInventory: (
                await new PulseReportHistoryRepository(s.database).completed(
                  f.tenantId,
                  section.context.historyKey,
                )
              ).filter((h) => h.periodEnd <= section.context.periodStart),
            })),
          );
        };
        const legacy = await legacySections(owner!.sections),
          legacyTeam = await legacySections(teamOwner!.sections);
        expect(
          legacy[0]!.baselineInventory![0]!.metrics.some((m) => m.metricKey === 'engagement'),
        ).toBe(true);
        expect(
          legacy[0]!.baselineInventory![0]!.metrics.some((m) => m.metricKey === 'autonomy'),
        ).toBe(true);
        await s.raw`update survey_report_assembly_inputs set sections=${JSON.stringify(legacyTeam)}::jsonb,source_candidate_ids=pulse_native_section_candidate_ids(${JSON.stringify(legacyTeam)}::jsonb) where obligation_id=${teamOwner!.obligationId}`;
        const built = await build.executeInitiated(f.tenantId, owner!.obligationId, owner!.token);
        if (built.status !== 'built') throw Error('new variant build');
        const slack = renderPulseReportForSlack(built.presentation),
          candidate = await h.recipients.resolve(f.tenantId, f.overallId);
        if (!candidate) throw Error('recipient');
        const proof = await h.transport.prove(candidate);
        const route = await h.recipients.verify(candidate, proof!);
        if (!route) throw Error('route');
        const [old] =
          await s.raw`select contracts from survey_report_snapshot_payloads where snapshot_id=${a.snapshotId}`;
        const contracts = {
            ...old.contracts,
            sourceCandidateIds: [
              ...new Set(
                legacy.flatMap((section) => [
                  section.candidateId,
                  ...section.baselineInventory!.map((h) => h.candidateId!),
                ]),
              ),
            ],
          },
          provenance = { ...built.provenance, sections: legacy },
          artifactHash = pulsePublicationHash({
            contracts,
            presentation: built.presentation,
            provenance,
            manifest: slack.manifest,
            parts: slack.parts,
            route,
          }),
          snapshotId = randomUUID();
        // Seed an actual former-producer package through the real DB identity/support/immutability guards.
        await s.raw`insert into survey_report_native_snapshots(id,tenant_id,obligation_id,cycle_id,scope_id,purpose,artifact_hash,part_count,expires_at) values(${snapshotId},${f.tenantId},${owner!.obligationId},${f.cycleId},${f.overallId},${purpose},${artifactHash},${slack.parts.length},clock_timestamp()+interval '1 day')`;
        await s.raw`insert into survey_report_snapshot_payloads(snapshot_id,tenant_id,contracts,presentation,provenance,manifest,route) values(${snapshotId},${f.tenantId},${JSON.stringify(contracts)}::jsonb,${JSON.stringify(built.presentation)}::jsonb,${JSON.stringify(provenance)}::jsonb,${JSON.stringify(slack.manifest)}::jsonb,${JSON.stringify(route)}::jsonb)`;
        const partIds: string[] = [];
        for (const [index, part] of slack.parts.entries()) {
          const partId = randomUUID();
          partIds.push(partId);
          await s.raw`insert into survey_report_parts(id,tenant_id,snapshot_id,ordinal,body_hash) values(${partId},${f.tenantId},${snapshotId},${index + 1},${pulsePublicationHash(part)})`;
          await s.raw`insert into survey_report_part_payloads(part_id,payload) values(${partId},${JSON.stringify(part)}::jsonb)`;
        }
        if (variant === 'final')
          for (const section of legacy) {
            for (const metric of section.metrics.filter((m) => m.status === 'eligible'))
              await s.raw`insert into survey_report_completion_supports(snapshot_id,candidate_id,tenant_id,cycle_id,history_key,metric_key,context_hash) values(${snapshotId},${section.candidateId},${f.tenantId},${f.cycleId},${section.context.historyKey},${metric.metricKey},${pulsePublicationHash(section.context)})`;
            await s.raw`insert into survey_report_final_completions(candidate_id,canonical_snapshot_id) values(${section.candidateId},${snapshotId})`;
          }
        const attemptId = randomUUID();
        await s.raw`insert into survey_report_attempts(id,tenant_id,snapshot_id,part_id,token,artifact_hash,body_hash,route_hash,authorization_receipt) values(${attemptId},${f.tenantId},${snapshotId},${partIds[0]!},1,${artifactHash},${pulsePublicationHash(slack.parts[0])},${pulsePublicationHash(route)},${pulsePublicationHash(provenance)})`;
        await s.raw`update survey_report_attempts set state='unknown' where id=${attemptId}`;
        await s.raw`update survey_report_parts set attempt_token=1,status='unknown' where id=${partIds[0]!}`;
        await s.raw`update survey_report_obligations set status='reconciliation_required',lease_until=null where id=${owner!.obligationId}`;
        await s.raw`delete from survey_report_assembly_inputs where obligation_id=${owner!.obligationId}`;
        await expect(
          s.raw`update survey_report_snapshot_payloads set provenance='{}'::jsonb where snapshot_id=${snapshotId}`,
        ).rejects.toThrow('immutable');
        await upgradeStoredHistory(f.tenantId);
        const [state] =
          await s.raw`select snapshot.purged_at,o.status,(select count(*)::int from survey_report_snapshot_payloads where snapshot_id=snapshot.id) payloads,(select count(*)::int from survey_report_part_payloads where part_id=any(${'{' + partIds.join(',') + '}'}::uuid[])) bodies,(select count(*)::int from survey_report_attempts where snapshot_id=snapshot.id and state='unknown') unknowns from survey_report_native_snapshots snapshot join survey_report_obligations o on o.id=snapshot.obligation_id where snapshot.id=${snapshotId}`;
        expect(state).toMatchObject({
          status: 'reconciliation_required',
          payloads: 0,
          bodies: 0,
          unknowns: 1,
        });
        expect(state.purged_at).not.toBeNull();
        const [cache] =
          await s.raw`select sections from survey_report_assembly_inputs where obligation_id=${teamOwner!.obligationId}`;
        const displayed =
          variant === 'final' ? 'engagement' : variant === 'intermediate' ? 'autonomy' : null;
        for (const section of cache.sections) {
          expect(Object.keys(section.baselines)).toEqual(displayed ? [displayed] : []);
          for (const historical of section.baselineInventory)
            expect(
              historical.metrics.every((m: { metricKey: string }) => m.metricKey === displayed),
            ).toBe(true);
        }
        const [retained] =
          await s.raw`select snapshot.artifact_hash,(select count(*)::int from survey_report_snapshot_payloads where snapshot_id=snapshot.id) payloads from survey_report_native_snapshots snapshot where id=${a.snapshotId}`;
        expect(retained.payloads).toBe(1);
        expect(retained.artifact_hash).toBeTruthy();
        if (variant === 'final') {
          const history = await new PulseReportHistoryRepository(s.database).completed(
            f.tenantId,
            owner!.sections[0]!.context.historyKey,
          );
          expect(history[0]?.cycleId).toBe(f.cycleId);
        }
      }
    }, 140000);
    it('R4 normal retention scrubs official candidate scalars but preserves latest invalid completed cycle', async () => {
      const h = await setup(5, 1, true),
        r = await freeze(h);
      await s.raw`update survey_report_input_candidates set expires_at=clock_timestamp()-interval '1 second' where cycle_id=${h.f.cycleId}`;
      await retain(h.f.tenantId);
      const rows =
        await s.raw`select metrics from survey_report_input_candidates where cycle_id=${h.f.cycleId}`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => JSON.stringify(row.metrics) === '[]')).toBe(true);
      const history = await new PulseReportHistoryRepository(s.database).completed(
        h.f.tenantId,
        r.lease.sections[0]!.context.historyKey,
      );
      expect(history[0]?.cycleId).toBe(h.f.cycleId);
      expect(history[0]?.authorized).toBe(false);
      expect(history[0]?.metrics).toEqual([]);
      expect(
        selectPulseReportBaseline(
          {
            ...r.lease.sections[0]!.context,
            cycleId: randomUUID(),
            periodStart: r.lease.sections[0]!.context.periodEnd,
          },
          r.lease.sections[0]!.metrics.find((m) => m.metricKey === 'engagement')!,
          history,
        ).status,
      ).toBe('baseline_established');
    });
    it('R5 three-cycle snapshot and assembly retain scalars only for selected used history', async () => {
      const h = await setup(6, 1, true, SHORT_WINDOW_DAYS, false, [SHORT_WINDOW_DAYS, 1]),
        a = await freeze(h);
      await s.raw`update users set consent_state=jsonb_set(consent_state,'{surveyEnabled}','false'::jsonb) where id=${h.f.users[0]!}`;
      const bf = await next({ ...h.f, users: h.f.users.slice(1) }, SHORT_WINDOW_DAYS);
      for (const u of bf.users) for (let q = 0; q < 3; q++) await s.numeric(bf, u, q);
      await s.raw.begin(async (tx) => {
        await tx`set local session_replication_role=replica`;
        await tx`update survey_report_final_timings set status='scheduled',blocked_reason=null,timezone='UTC',local_date='2026-10-28',local_work_end='23:59',final_due_at=(select period_start+interval '1 microsecond' from survey_cycle_scoring_policies where id=${bf.cycleId}) where cycle_scoring_policy_id=${bf.cycleId}`;
        await tx`set local session_replication_role=origin`;
      });
      const b = await freeze({ ...h, f: bf }),
        cf = await next(bf, 1),
        observed = await lifecycle.observe(request(cf, 'intermediate'));
      const [cache] =
        await s.raw`select sections from survey_report_assembly_inputs where obligation_id=${observed.obligationId!}`;
      for (const section of cache.sections)
        for (const historical of section.baselineInventory)
          if (historical.cycleId === h.f.cycleId) expect(historical.metrics).toEqual([]);
      const c = await freeze({ ...h, f: cf }, 'intermediate');
      const [payload] =
        await s.raw`select provenance from survey_report_snapshot_payloads where snapshot_id=${c.snapshotId}`;
      for (const section of payload.provenance.sections)
        for (const historical of section.baselineInventory)
          if (historical.cycleId === h.f.cycleId) expect(historical.metrics).toEqual([]);
      expect(c.built.provenance.sections[0]!.baselines?.autonomy?.status).toBe('comparable');
      await s.raw`update survey_report_input_candidates set expires_at=clock_timestamp()-interval '1 second' where cycle_id=${h.f.cycleId}`;
      await retain(h.f.tenantId);
      const [current] =
        await s.raw`select count(*)::int n from survey_report_snapshot_payloads where snapshot_id=${c.snapshotId}`;
      expect(current.n).toBe(1);
      await s.raw`delete from org_employee_placements where employee_person_id=${h.f.users[0]!}`;
      await s.raw`delete from users where id=${h.f.users[0]!}`;
      const [afterErasure] =
        await s.raw`select provenance from survey_report_snapshot_payloads where snapshot_id=${c.snapshotId}`;
      expect(afterErasure).toBeTruthy();
      for (const section of afterErasure.provenance.sections)
        for (const historical of section.baselineInventory)
          if (historical.cycleId === h.f.cycleId) expect(historical.metrics).toEqual([]);
      const fresh = await freeze({ ...h, f: cf }, 'intermediate', 'team_lead');
      expect((await h.delivery.deliverNext(cf.tenantId, fresh.snapshotId)).status).toBe(
        'delivered',
      );
      expect(a.snapshotId).toBeTruthy();
      expect(b.snapshotId).toBeTruthy();
    }, 100000);
    it('rejects malformed native scope/Index and cross-tenant payload/support storage directly in PostgreSQL', async () => {
      const h = await setup(5, 1, true),
        other = await setup(),
        r = await freeze(h);
      await expect(
        s.raw`insert into survey_report_obligations select (jsonb_populate_record(null::survey_report_obligations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'purpose','intermediate','index_key','final'))).* from survey_report_obligations o where id=${r.lease.obligationId}`,
      ).rejects.toThrow('report_obligation_shape');
      await expect(
        s.raw`insert into survey_report_obligations select (jsonb_populate_record(null::survey_report_obligations,to_jsonb(o)||jsonb_build_object('id',gen_random_uuid(),'tenant_id',${other.f.tenantId}::text))).* from survey_report_obligations o where id=${r.lease.obligationId}`,
      ).rejects.toThrow('pulse_obligation_scope_audience');
      const [payload] =
        await s.raw`select * from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}`;
      const [support] =
        await s.raw`select * from survey_report_completion_supports where snapshot_id=${r.snapshotId} limit 1`;
      expect(payload).toBeTruthy();
      expect(support).toBeTruthy();
      await expect(
        s.raw`insert into survey_report_completion_supports select (jsonb_populate_record(null::survey_report_completion_supports,to_jsonb(support)||jsonb_build_object('tenant_id',${other.f.tenantId}::text))).* from survey_report_completion_supports support where snapshot_id=${r.snapshotId} limit 1`,
      ).rejects.toThrow('pulse_final_support_context');
      await expect(
        s.raw`insert into survey_report_completion_supports select (jsonb_populate_record(null::survey_report_completion_supports,to_jsonb(support)||jsonb_build_object('cycle_id',${other.f.cycleId}::text))).* from survey_report_completion_supports support where snapshot_id=${r.snapshotId} limit 1`,
      ).rejects.toThrow('pulse_final_support_context');
      await s.raw`select pulse_publication_payload_purge(${h.f.tenantId},clock_timestamp()+interval '1 year')`;
      await expect(
        s.raw`insert into survey_report_snapshot_payloads(snapshot_id,tenant_id,contracts,presentation,provenance,manifest,route) values(${r.snapshotId},${other.f.tenantId},${JSON.stringify(payload.contracts)}::jsonb,${JSON.stringify(payload.presentation)}::jsonb,${JSON.stringify(payload.provenance)}::jsonb,${JSON.stringify(payload.manifest)}::jsonb,${JSON.stringify(payload.route)}::jsonb)`,
      ).rejects.toThrow('foreign key');
      const [remaining] =
        await s.raw`select (select count(*)::int from survey_report_obligations where cycle_id=${h.f.cycleId}) obligations,(select count(*)::int from survey_report_snapshot_payloads where snapshot_id=${r.snapshotId}) payloads,(select count(*)::int from survey_report_completion_supports where tenant_id=${other.f.tenantId} and snapshot_id=${r.snapshotId}) foreign_supports`;
      expect(remaining).toMatchObject({ obligations: 1, payloads: 0, foreign_supports: 0 });
    }, 30000);
    it('explicit remain-unknown reconciliation revokes a fresh unsent grant and preserves the whole logical hold', async () => {
      const h = await setup(),
        r = await freeze(h),
        grant = await h.delivery.claim(h.f.tenantId, r.snapshotId);
      const [a] =
        await s.raw`select body_hash from survey_report_attempts where id=${grant!.attemptId}`;
      const command = {
        tenantId: h.f.tenantId,
        snapshotId: r.snapshotId,
        attemptId: grant!.attemptId,
        token: grant!.token,
        operator: {
          actorId: 'scoped-operator',
          tenantId: h.f.tenantId,
          snapshotId: r.snapshotId,
          authorizationRef: 'explicit-fixture-scope',
        },
        reason: 'acceptance cannot be proven',
        evidenceRef: 'fixture:inconclusive',
        decision: 'remain_unknown' as const,
        evidence: {
          kind: 'inconclusive' as const,
          bodyHash: String(a.body_hash),
          ownerTerminated: false,
        },
      };
      expect((await h.delivery.reconcile(command)).status).toBe('unknown');
      expect((await h.delivery.dispatch(grant!)).status).toBe('unknown');
      expect(h.transport.post).toHaveBeenCalledTimes(0);
      const [state] =
        await s.raw`select o.status,a.state from survey_report_obligations o join survey_report_native_snapshots s on s.obligation_id=o.id join survey_report_attempts a on a.snapshot_id=s.id where a.id=${grant!.attemptId}`;
      expect(state).toMatchObject({ status: 'reconciliation_required', state: 'unknown' });
    });
    it('conflicting same-cycle canonical candidate blocks atomically without a fabricated completion or an endless active assembly lease', async () => {
      const h = await setup(6, 1, true),
        tl = await freeze(h, 'final', 'team_lead'),
        user = h.f.users[0]!;
      await new ReportingPermissionRepository(s.database).withdraw({
        tenantId: h.f.tenantId,
        userId: user,
        personId: user,
        requestId: randomUUID(),
        target: { kind: 'full_reporting' },
        provenance: {
          kind: 'verified_subject',
          tenantId: h.f.tenantId,
          userId: user,
          personId: user,
          verificationId: randomUUID(),
          receivedAt: new Date(),
        },
      });
      const observed = await lifecycle.observe(request(h.f));
      expect(observed.obligationId).toBeTruthy();
      const result = await new FormPulseReportUseCase(lifecycle, build, h.snapshots).execute(
        h.f.tenantId,
        observed.obligationId!,
      );
      expect(result.status).toBe('blocked');
      const [state] =
        await s.raw`select status,lease_until from survey_report_obligations where id=${observed.obligationId!}`;
      expect(state).toMatchObject({ status: 'blocked', lease_until: null });
      const [count] =
        await s.raw`select count(*)::int n from survey_report_native_snapshots where tenant_id=${h.f.tenantId}`;
      expect(count.n).toBe(1);
      expect(tl.snapshotId).toBeTruthy();
      expect(h.transport.post).toHaveBeenCalledTimes(0);
    }, 30000);
  },
);
