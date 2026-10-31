import { afterAll, describe, it, expect, vi } from 'vitest';
import { BuildPulseReportUseCase } from '../../../application/src/use-cases/build-pulse-report.use-case';
import { PulseReportSlackAssemblyService } from '../../../../apps/worker/src/survey/pulse-report-slack-assembly.service';
import { addPulsePresentationTopics } from './pulse-report-presentation.fixture';
import type { PulseNarrativeRequest } from '@entalent/contracts';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rpt05FixtureSuite, SHORT_WINDOW_DAYS } from './pulse-report-inputs.fixture';
import { PulseReportInputRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-input.repository';
import { PulseReportPresentationRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import {
  PreparePulseReportInputsUseCase,
  computePulseReportInputs,
} from '../../../application/src/use-cases/prepare-pulse-report-inputs.use-case';
import {
  PulseReportHistoryRepository,
  readPulseFinalCandidates,
} from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';
import type { PulseReportExecutor } from '../pulse-report-state';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { ReportConfigurationService } from '../../../../apps/api/src/report-configuration/report-configuration.service';

describe.runIf(Boolean(process.env.DATABASE_URL))('RPT06 migrated frozen presentation', () => {
  const s = rpt05FixtureSuite();
  afterAll(s.cleanup);
  const repo = new PulseReportPresentationRepository(s.database);
  const inputs = new PreparePulseReportInputsUseCase(
    new PulseReportInputRepository(s.database),
    new PulseReportHistoryRepository(s.database),
  );
  const req = (
    f: Awaited<ReturnType<typeof s.fixture>>,
    purpose: 'final' | 'intermediate' = 'intermediate',
  ) => ({
    tenantId: f.tenantId,
    cycleId: f.cycleId,
    overallScopeId: f.overallId,
    audience: 'manager' as const,
    purpose,
    ...(purpose === 'intermediate' ? { indexKey: 'autonomy' as const } : {}),
  });
  async function prepare(
    f: Awaited<ReturnType<typeof s.fixture>>,
    purpose: 'final' | 'intermediate' = 'intermediate',
  ) {
    const context = await repo.read(req(f, purpose));
    expect(context).not.toBeNull();
    if (!context) throw Error('context missing');
    const prepared = await inputs.preparePresentationSet(
      context.scopes.map((scope, i) => ({
        ...s.request(f, purpose),
        scopeId: scope.scopeId,
        projection: i === 0 ? ('manager_overall' as const) : ('manager_team' as const),
      })),
    );
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') throw Error('not prepared');
    return { context, sections: prepared.sections };
  }
  it('coherent manager batch shares DB microsecond frontier and generation, freezes every exact child and rejects caller clock', async () => {
    const f = await s.fixture(9, 1, 3);
    const { context, sections } = await prepare(f);
    expect(context.scopes).toHaveLength(4);
    expect(new Set(sections.map((s) => s.context.frontier)).size).toBe(1);
    expect(new Set(sections.map((s) => s.context.generation)).size).toBe(1);
    expect(sections[0]!.context.frontier).toMatch(/\.\d{6}Z$/);
    expect(await repo.validate(context, sections)).toBe(true);
    const injected = await new PulseReportInputRepository(s.database).preparePresentationSet(
      context.scopes.map((scope) => ({
        ...s.request(f, 'intermediate'),
        scopeId: scope.scopeId,
        frontier: '1900-01-01T00:00:00.000000Z',
      })),
      computePulseReportInputs,
    );
    expect(
      injected.status === 'prepared' &&
        injected.sections.every((s) => s.context.frontier.startsWith('1900')),
    ).toBe(false);
    await s.raw`update org_teams set name='MUTABLE NAME' where tenant_id=${f.tenantId}`;
    expect((await repo.read(req(f)))?.scopes).toEqual(context.scopes);
    expect(await repo.read({ ...req(f), audience: 'team_lead' })).toBeNull();
    expect(await repo.read({ ...req(f), cycleId: randomUUID() })).toBeNull();
    expect(await repo.read({ ...req(f), tenantId: randomUUID() })).toBeNull();
  });
  it('final batch preserves immutable cutoff and canonical team computation while explicit audience remains manager', async () => {
    const f = await s.fixture(6, 1, 2);
    for (const u of f.users) for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
    await s.start(f);
    const { context, sections } = await prepare(f, 'final');
    const [timing] =
      await s.raw`select to_char(report_data_cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff from survey_report_final_timings where tenant_id=${f.tenantId}`;
    expect(sections.every((s) => s.context.frontier === timing.cutoff)).toBe(true);
    expect(sections.slice(1).every((s) => s.context.projection === 'team_lead_overall')).toBe(true);
    expect(context.request.audience).toBe('manager');
    expect(await repo.validate(context, sections)).toBe(true);
    await new ReportConfigurationService(s.database).saveLanguage(f.tenantId, 'de', 1, {
      type: 'internal_operator',
      operatorId: 'fixture',
    });
    expect((await repo.read(req(f, 'final')))?.locale).toBe('en');
    expect(await repo.validate(context, sections)).toBe(true);
  });
  it('current authoritative configuration invalidates intermediate after edit and never reads personal locale', async () => {
    const f = await s.fixture();
    const { context, sections } = await prepare(f);
    await new ReportConfigurationService(s.database).saveLanguage(f.tenantId, 'de', 1, {
      type: 'internal_operator',
      operatorId: 'fixture',
    });
    expect((await repo.read(req(f)))?.locale).toBe('de');
    expect(await repo.validate(context, sections)).toBe(false);
  });
  it('withdrawal after preparation invalidates current candidates under sorted subject locks without a fresh frontier', async () => {
    const f = await s.fixture();
    for (const u of f.users) for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
    const { context, sections } = await prepare(f);
    const rights = new ReportingPermissionRepository(s.database);
    await rights.withdraw({
      tenantId: f.tenantId,
      userId: f.users[0],
      personId: f.users[0],
      requestId: randomUUID(),
      target: { kind: 'full_reporting' },
      provenance: {
        kind: 'verified_subject',
        tenantId: f.tenantId,
        userId: f.users[0],
        personId: f.users[0],
        verificationId: randomUUID(),
        receivedAt: new Date(),
      },
    });
    expect(await repo.validate(context, sections)).toBe(false);
    const fresh = await prepare(f);
    expect(await repo.validate(fresh.context, fresh.sections)).toBe(true);
  });
  it('expiry and altered source inventory invalidate rather than substituting fresh observations', async () => {
    const f = await s.fixture();
    const { context, sections } = await prepare(f);
    await s.raw`update survey_report_input_candidates set expires_at=clock_timestamp()-interval '1 second' where id=${sections[0]!.candidateId}`;
    expect(await repo.validate(context, sections)).toBe(false);
  });
  it('native source readers contain no private-working query and preserve final-history producer guard', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of [
      'pulse-report-input.repository.ts',
      'pulse-report-presentation.repository.ts',
      'pulse-report-history.repository.ts',
    ]) {
      const source = readFileSync(
        resolve(__dirname, '../../../../apps/worker/src/survey/repositories/', file),
        'utf8',
      );
      expect(source).not.toMatch(
        /\b(?:from|join)\s+(?:messages|survey_question_working_insights|survey_question_confirmation_bundles|people|org_teams|org_units)\b/i,
      );
    }
    const f = await s.fixture();
    await s.start(f);
    const { sections } = await prepare(f, 'final');
    await expect(
      s.raw`insert into survey_report_final_completions(candidate_id)values(${sections[0]!.candidateId})`,
    ).rejects.toThrow('pulse_final_completion_requires_real_native_support');
  });
  it('actual SQL query spy sees one coherent batch during concurrent ingress and no private-working hierarchy reads', async () => {
    const f = await s.fixture(9, 1, 3);
    const queries: { sql: string; params: unknown[] }[] = [];
    let racing: ReturnType<typeof s.inbound> | undefined;
    const db = drizzle(s.raw, {
      schema,
      logger: {
        logQuery(query, params) {
          queries.push({ sql: query, params });
          if (!racing && query.includes('select s.kind,s.history_key'))
            racing = s.inbound(f, f.users[0], 'Synthetic concurrent ingress');
        },
      },
    });
    const service = { client: db } as never;
    const metadata = new PulseReportPresentationRepository(service);
    const context = await metadata.read(req(f));
    if (!context) throw Error('context');
    const batch = await new PreparePulseReportInputsUseCase(
      new PulseReportInputRepository(service),
      new PulseReportHistoryRepository(service),
    ).preparePresentationSet(
      context.scopes.map((c, i) => ({
        ...s.request(f, 'intermediate'),
        scopeId: c.scopeId,
        projection: i === 0 ? 'manager_overall' : 'manager_team',
      })),
    );
    if (batch.status !== 'prepared') throw Error('prepared');
    expect(new Set(batch.sections.map((s) => s.context.frontier)).size).toBe(1);
    expect(new Set(batch.sections.map((s) => s.context.generation)).size).toBe(1);
    await racing;
    for (const q of queries)
      expect(q.sql).not.toMatch(
        /\b(?:from|join)\s+(?:messages|survey_question_working_insights|survey_question_confirmation_bundles|people|org_teams|org_units)\b/i,
      );
    expect(queries.length).toBeGreaterThan(30);
    const locks = queries
      .filter((q) => q.sql.includes('pulse-report-subject:'))
      .map((q) => String(q.params[1]));
    const firstPass = locks.slice(0, 10);
    expect(firstPass).toEqual([...firstPass].sort());
  });
  for (const invalidation of ['withdrawal', 'expiry', 'inventory_deletion'] as const)
    it(`prior-only baseline contributor ${invalidation} invalidates under globally sorted union locks without changing current frontier`, async () => {
      const f = await s.fixture(6, SHORT_WINDOW_DAYS, 1, true, [1]);
      for (const u of f.users) {
        await addPulsePresentationTopics(s, f, u);
        for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
      }
      await s.start(f);
      const prior = await prepare(f, 'final');
      const ids = prior.sections.map((s) => s.candidateId);
      // Synthetic completion inventory; the real completion guard is never bypassed.
      await s.raw`update users set consent_state=jsonb_set(consent_state,'{surveyEnabled}','false'::jsonb) where id=${f.users[0]}`;
      const next = await s.successor(f.cycleId, 1);
      await s.waitForDbTime(next.periodStart);
      await new PulseReportScopeRepository(s.database).openOrgNativeCycle({
        tenantId: f.tenantId,
        surveyDefinitionId: f.definitionId,
        periodStart: next.periodStart,
        periodEnd: next.periodEnd,
      });
      const [overall] =
        await s.raw`select id from survey_report_scopes where cycle_scoring_policy_id=${next.id} and kind='manager_overall'`;
      const request = { ...req(f), cycleId: String(next.id), overallScopeId: String(overall.id) };
      const currentFixture = {
        ...f,
        cycleId: String(next.id),
        users: f.users.slice(1),
        windows: new Map(f.windows),
      };
      for (const userId of currentFixture.users) {
        const window = await s.survey.findOrCreateActiveWindow(userId, f.tenantId);
        if (!window || 'kind' in window) throw Error('current window');
        currentFixture.windows.set(userId, window.id);
        await addPulsePresentationTopics(s, currentFixture, userId, 60);
      }

      const logged: { sql: string; params: unknown[] }[] = [];
      const db = drizzle(s.raw, {
        schema,
        logger: {
          logQuery(query, params) {
            logged.push({ sql: query, params });
          },
        },
      });
      const service = { client: db } as never;
      class SyntheticCompletedRepository extends PulseReportPresentationRepository {
        protected completed(tx: PulseReportExecutor, tenantId: string, historyKey: string) {
          return readPulseFinalCandidates(tx, tenantId, historyKey, ids);
        }
      }
      const presentation = new SyntheticCompletedRepository(service);
      const context = await presentation.read(request);
      if (!context) throw Error('context');
      const history = {
        completed: (tenantId: string, historyKey: string) =>
          readPulseFinalCandidates(db, tenantId, historyKey, ids),
      };
      const currentInputs = new PreparePulseReportInputsUseCase(
        new PulseReportInputRepository(service),
        history,
      );
      const current = await currentInputs.preparePresentationSet(
        context.scopes.map((c, i) => ({
          tenantId: f.tenantId,
          cycleId: String(next.id),
          scopeId: c.scopeId,
          purpose: 'intermediate' as const,
          projection: i === 0 ? 'manager_overall' : 'manager_team',
        })),
      );
      if (current.status !== 'prepared') throw Error('prepared');
      expect(current.sections[0]!.baselineInventory?.[0]?.candidateId).toBe(
        prior.sections[0]!.candidateId,
      );
      logged.length = 0;
      expect(await presentation.validate(context, current.sections)).toBe(true);
      const artifact = await new BuildPulseReportUseCase(presentation, currentInputs, {
        draft: async (input) => ({
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
      }).execute(request);
      expect(artifact.status).toBe('built');
      if (artifact.status !== 'built') throw Error('artifact');
      expect(artifact.presentation.sections[0]).toMatchObject({
        status: 'eligible',
        metric: { kind: 'index', direction: 'declining', value: '60.0' },
      });
      const [membership] =
        await s.raw`select count(*)::int n from survey_report_participants where cycle_scoring_policy_id=${next.id} and user_id=${f.users[0]}`;
      expect(membership.n).toBe(0);
      const firstInventory = logged.findIndex(
        (q) => q.sql.includes('candidate_id') && q.sql.includes('authorization_token'),
      );
      const firstCycleLock = logged.findIndex((q) => q.sql.includes('pg_advisory_xact_lock'));
      expect(firstInventory).toBeGreaterThanOrEqual(0);
      expect(firstCycleLock).toBeGreaterThan(firstInventory);
      logged.length = 0;
      if (invalidation === 'withdrawal')
        await new ReportingPermissionRepository(s.database).withdraw({
          tenantId: f.tenantId,
          userId: f.users[0],
          personId: f.users[0],
          requestId: randomUUID(),
          target: { kind: 'full_reporting' },
          provenance: {
            kind: 'verified_subject',
            tenantId: f.tenantId,
            userId: f.users[0],
            personId: f.users[0],
            verificationId: randomUUID(),
            receivedAt: new Date(),
          },
        });
      else if (invalidation === 'expiry') {
        const [ages] = await s.raw`select
          extract(epoch from clock_timestamp()-(select max(i.processed_at) from survey_question_insights i join survey_report_insight_revisions r on r.insight_id=i.id join survey_report_question_lineages l on l.id=r.lineage_id where l.cycle_scoring_policy_id=${f.cycleId})) old_age,
          extract(epoch from clock_timestamp()-(select min(i.processed_at) from survey_question_insights i join survey_report_insight_revisions r on r.insight_id=i.id join survey_report_question_lineages l on l.id=r.lineage_id where l.cycle_scoring_policy_id=${next.id})) current_age`;
        expect(Number(ages.old_age)).toBeGreaterThan(Number(ages.current_age));
        const retentionDays = (Number(ages.old_age) + Number(ages.current_age)) / 2 / 86400;
        await s.raw`update tenants set retention_policy=retention_policy||${JSON.stringify({ memoryRetentionDays: retentionDays })}::jsonb where id=${f.tenantId}`;
        const withoutBaseline = current.sections.map((s) => ({
          ...s,
          baselineInventory: [],
          baselines: Object.fromEntries(
            s.metrics.map((m) => [m.metricKey, { status: 'baseline_established' as const }]),
          ),
        }));
        expect(
          await new PulseReportPresentationRepository(service).validate(context, withoutBaseline),
        ).toBe(true);
        logged.length = 0;
      } else
        await s.raw`delete from survey_report_candidate_sources where tenant_id=${f.tenantId} and user_id=${f.users[0]}`;
      expect(await presentation.validate(context, current.sections)).toBe(false);
      const locks = logged
        .filter((q) => q.sql.includes('pulse-report-subject:'))
        .map((q) => String(q.params[1]));
      expect(locks).toEqual([...locks].sort());
      if (invalidation !== 'inventory_deletion') expect(locks).toContain(f.users[0]);
      const [gen] =
        await s.raw`select generation from survey_report_input_generations where cycle_id=${next.id}`;
      expect(Number(gen.generation)).toBe(current.sections[0]!.context.generation);
    }, 80000);

  it('non-started final metadata cannot bypass formation preparation gate', async () => {
    const f = await s.fixture();
    const context = await repo.read(req(f, 'final'));
    if (!context) throw Error('context');
    const result = await inputs.preparePresentationSet(
      context.scopes.map((c, i) => ({
        ...s.request(f, 'final'),
        scopeId: c.scopeId,
        projection: i === 0 ? 'manager_overall' : 'manager_team',
      })),
    );
    expect(result).toEqual({ status: 'pending', reason: 'formation_not_started' });
  });

  it('native source confirmations through coherent allowed set, semantic-reviewed four variants and literal Slack package remain connected', async () => {
    const f = await s.fixture(5);
    for (const userId of f.users) {
      await addPulsePresentationTopics(s, f, userId);
      for (let q = 0; q < 3; q++) await s.numeric(f, userId, q);
    }
    const draft = vi.fn(async (input: PulseNarrativeRequest) => ({
      explanation: [
        {
          text: 'Employees describe sufficient choice over work methods.',
          references: [input.evidence[0]!.handle],
        },
      ],
      focus: { kind: 'none_supported' },
      actions: [],
    }));
    const provider = {
      draft,
      review: vi.fn(async () => ({ verdict: 'pass', violations: [] })),
      localize: vi.fn(),
      reviewLabels: vi.fn(),
    };
    const assembly = new PulseReportSlackAssemblyService(
      new BuildPulseReportUseCase(repo, inputs, provider) as never,
      repo,
    );
    for (const purpose of ['intermediate', 'final'] as const) {
      if (purpose === 'final') await s.start(f);
      for (const audience of ['team_lead', 'manager'] as const) {
        const request = {
          ...req(f, purpose),
          audience,
          overallScopeId: audience === 'team_lead' ? f.teamScopeId : f.overallId,
        };
        const built = await assembly.assemble(request);
        expect(built.status).toBe('built');
        if (built.status !== 'built' || !('slack' in built)) throw Error('built');
        expect(built.presentation.variant).toBe(audience + '_' + purpose);
        expect(built.slack.parts.length).toBeGreaterThan(0);
        const serialized = JSON.stringify(built.slack.parts);
        for (const id of [
          f.tenantId,
          ...f.users,
          ...built.provenance.sections.map((s) => s.candidateId),
        ])
          expect(serialized).not.toContain(id);
        expect(serialized).not.toContain('Synthetic autonomy meaning');
        if (purpose === 'intermediate' && audience === 'team_lead')
          expect(serialized).not.toContain('70.0');
      }
    }
    for (const [input] of draft.mock.calls) {
      const serialized = JSON.stringify(input);
      for (const userId of f.users) expect(serialized).not.toContain(userId);
      expect(serialized).not.toContain('subjectId');
      expect(serialized).not.toContain('revisionId');
      expect(serialized).not.toContain('value');
    }
    const [history] =
      await s.raw`select count(*)::int n from survey_report_final_completions f join survey_report_input_candidates c on c.id=f.candidate_id where c.tenant_id=${f.tenantId}`;
    expect(history.n).toBe(0);
    draft.mockImplementationOnce(async (input) => {
      await new ReportingPermissionRepository(s.database).withdraw({
        tenantId: f.tenantId,
        userId: f.users[0],
        personId: f.users[0],
        requestId: randomUUID(),
        target: { kind: 'full_reporting' },
        provenance: {
          kind: 'verified_subject',
          tenantId: f.tenantId,
          userId: f.users[0],
          personId: f.users[0],
          verificationId: randomUUID(),
          receivedAt: new Date(),
        },
      });
      return {
        explanation: [
          {
            text: 'Employees describe sufficient choice over work methods.',
            references: [input.evidence[0]!.handle],
          },
        ],
        focus: { kind: 'none_supported' },
        actions: [],
      };
    });
    expect(await assembly.assemble({ ...req(f, 'final') })).toEqual({ status: 'invalidated' });
  }, 20000);
  it('changed closed source inventory cannot preserve a numeric artifact by deleting its provenance row', async () => {
    const f = await s.fixture();
    for (const u of f.users) for (let i = 0; i < 3; i++) await s.numeric(f, u, i);
    const { context, sections } = await prepare(f);
    expect(await repo.validate(context, sections)).toBe(true);
    await s.raw`delete from survey_report_candidate_sources where candidate_id=${sections[0]!.candidateId} and revision_id=(select revision_id from survey_report_candidate_sources where candidate_id=${sections[0]!.candidateId} limit 1)`;
    expect(await repo.validate(context, sections)).toBe(false);
  });

  it('out-of-sync source configuration blocks intermediate even when locale canonicalization would hide the raw revision mismatch', async () => {
    const f = await s.fixture();
    expect(await repo.read(req(f))).not.toBeNull();
    await s.raw`update tenants set locale='EN' where id=${f.tenantId}`;
    expect(await repo.read(req(f))).toBeNull();
  });
});
