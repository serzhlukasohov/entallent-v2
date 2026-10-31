import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { resolve } from 'node:path';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import * as schema from '../schema';
import { ReportingPermissionRepository } from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import { PulseReportHistoryRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { PULSE_REPORT_CALCULATION_CONTRACT } from '@entalent/contracts';
describe.runIf(Boolean(process.env.DATABASE_URL))('RPT05 native permanent input sets', () => {
  const s = rpt05FixtureSuite();
  afterAll(s.cleanup);
  it('six complete respondents with two incomplete native stages remains pending, recovers six under same cutoff, persists candidates and locks completion', async () => {
    const f = await s.fixture();
    const waiting = [];
    for (const [i, u] of f.users.entries())
      for (let q = 0; q < 3; q++) waiting.push(await s.numeric(f, u, q, '7', i < 4));
    const started = await s.start(f);
    expect(started.status).toBe('started');
    expect(await s.inputs.execute(s.request(f))).toEqual({
      status: 'pending',
      reason: 'unresolved_stage',
    });
    for (const input of waiting.slice(12)) await s.commit(input);
    const result = await s.inputs.execute(s.request(f));
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') throw Error('expected prepared');
    expect(result.context.frontier).toBe(
      started.status === 'started' ? started.context.reportDataCutoff : '',
    );
    expect(result.finalGate).toBe('eligible');
    expect(result.metrics.find((m) => m.kind === 'engagement')).toMatchObject({
      completeCount: 6,
      rawMean: 7,
      status: 'eligible',
    });
    const replay = await s.inputs.execute(s.request(f));
    expect(replay.status === 'prepared' && replay.candidateId).toBe(result.candidateId);
    await expect(
      s.raw`insert into survey_report_final_completions(candidate_id)values(${result.candidateId})`,
    ).rejects.toThrow('pulse_final_completion_requires_real_native_support');
    expect(
      await new PulseReportHistoryRepository(s.database).completed(
        f.tenantId,
        result.context.historyKey,
      ),
    ).toEqual([]);
    expect(await s.inputs.execute(s.request(f, 'intermediate'))).toEqual({
      status: 'blocked',
      reason: 'final_already_started',
    });
  });
  it('candidate replay invalidates a mismatched frozen contract without rewriting the retained context', async () => {
    const f = await s.fixture();
    await s.start(f);
    const first = await s.inputs.execute(s.request(f));
    if (first.status !== 'prepared') throw Error('expected prepared');
    const [stored] =
      await s.raw`select calculation_contract from survey_report_input_candidates where id=${first.candidateId}`;
    expect(stored.calculation_contract).toBe(PULSE_REPORT_CALCULATION_CONTRACT);
    await s.raw`update survey_report_input_candidates set context=jsonb_set(context,'{compatibilitySignature}','"previous-contract"'::jsonb) where id=${first.candidateId}`;
    expect(await s.inputs.execute(s.request(f))).toEqual({
      status: 'blocked',
      reason: 'invalidated',
    });
    const [invalidated] =
      await s.raw`select context,invalidated_at from survey_report_input_candidates where id=${first.candidateId}`;
    expect(invalidated.context.compatibilitySignature).toBe('previous-contract');
    expect(invalidated.invalidated_at).not.toBeNull();
    const replacement = await s.inputs.execute(s.request(f));
    expect(replacement.status === 'prepared' && replacement.candidateId).not.toBe(
      first.candidateId,
    );
    expect(replacement.status === 'prepared' && replacement.context.compatibilitySignature).toBe(
      first.context.compatibilitySignature,
    );
  });
  it('alternating final team views share one canonical candidate without generation churn', async () => {
    const f = await s.fixture();
    await s.start(f);
    const ids = new Set<string>();
    const generations = new Set<number>();
    for (const projection of [
      'team_lead_overall',
      'manager_team',
      'team_lead_overall',
      'manager_team',
    ] as const) {
      const prepared = await s.inputs.execute({
        ...s.request(f),
        scopeId: f.teamScopeId,
        projection,
      });
      if (prepared.status !== 'prepared') throw Error('expected prepared');
      expect(prepared.context.projection).toBe('team_lead_overall');
      ids.add(prepared.candidateId);
      generations.add(prepared.context.generation);
    }
    expect(ids.size).toBe(1);
    expect(generations.size).toBe(1);
    expect(
      (
        await s.raw`select count(*)::integer n from survey_report_input_candidates where tenant_id=${f.tenantId} and invalidated_at is not null`
      )[0].n,
    ).toBe(0);
    expect(
      await s.inputs.execute({
        ...s.request(f),
        scopeId: f.teamScopeId,
        projection: 'manager_overall',
      }),
    ).toEqual({ status: 'blocked', reason: 'missing_native_scope' });
  });
  it('five of100 actual native numeric respondents qualifies without80percent participation', async () => {
    const f = await s.fixture(100);
    for (const u of f.users.slice(0, 5)) for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '8');
    await s.start(f);
    const selected = await s.inputs.execute({ ...s.request(f), scopeId: f.teamScopeId });
    expect(selected.status === 'prepared' && selected.finalGate).toBe('eligible');
    expect(
      selected.status === 'prepared' && selected.metrics.find((m) => m.kind === 'engagement'),
    ).toMatchObject({ completeCount: 5, requiredCount: 5, rawMean: 8 });
    expect(
      (
        await s.raw`select count(*)::integer n from survey_report_scope_memberships where scope_id=${f.teamScopeId}`
      )[0].n,
    ).toBe(100);
  });
  it('all native team sections may be insufficient while deduplicated Manager overall is eligible', async () => {
    const f = await s.fixture(6, 1, 2);
    for (const u of f.users) for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '7');
    await s.start(f);
    const overall = await s.inputs.execute(s.request(f));
    expect(overall.status === 'prepared' && overall.finalGate).toBe('eligible');
    expect(
      overall.status === 'prepared' &&
        overall.metrics.find((m) => m.kind === 'engagement')?.completeCount,
    ).toBe(6);
    for (const team of await s.raw`select id from survey_report_scopes where tenant_id=${f.tenantId} and kind='team'`) {
      const section = await s.inputs.execute({
        ...s.request(f),
        scopeId: team.id,
        projection: 'manager_team',
      });
      expect(section.status === 'prepared' && section.finalGate).toBe('insufficient_data');
      expect(
        section.status === 'prepared' &&
          section.metrics.find((m) => m.kind === 'engagement')?.completeCount,
      ).toBe(3);
    }
  });
  it('team own TL excluded, full withdrawal changes denominator while partial does not', async () => {
    const f = await s.fixture(6);
    for (const u of [...f.users.slice(0, 5), f.lead])
      for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '8');
    await s.start(f);
    const overall = await s.inputs.execute(s.request(f));
    expect(
      overall.status === 'prepared' &&
        overall.metrics.find((m) => m.kind === 'engagement')?.completeCount,
    ).toBe(6);
    const team = await s.inputs.execute({
      ...s.request(f),
      scopeId: f.teamScopeId,
      projection: 'manager_team',
    });
    expect(
      team.status === 'prepared' &&
        team.metrics.find((m) => m.kind === 'engagement')?.completeCount,
    ).toBe(5);
    const [lineage] =
      await s.raw`select id from survey_report_question_lineages where tenant_id=${f.tenantId} and user_id=${f.users[0]} and answer_kind='numeric_1_10_integer' limit 1`;
    const rights = new ReportingPermissionRepository(s.database);
    const withdraw = (userId: string, lineageIds?: string[]) =>
      rights.withdraw({
        tenantId: f.tenantId,
        userId,
        personId: userId,
        requestId: randomUUID(),
        provenance: {
          kind: 'verified_subject',
          tenantId: f.tenantId,
          userId,
          personId: userId,
          verificationId: randomUUID(),
          receivedAt: new Date(),
        },
        target: lineageIds ? { kind: 'partial_reporting', lineageIds } : { kind: 'full_reporting' },
      });
    await withdraw(f.users[0], [lineage.id]);
    const after = await s.inputs.execute({ ...s.request(f), scopeId: f.teamScopeId });
    expect(
      after.status === 'prepared' &&
        after.metrics.find((m) => m.kind === 'engagement')?.completeCount,
    ).toBe(4);
    if (overall.status === 'prepared')
      expect(
        (
          await s.raw`select invalidated_at from survey_report_input_candidates where id=${overall.candidateId}`
        )[0].invalidated_at,
      ).not.toBeNull();
    await withdraw(f.users[1]);
    expect(
      (
        await s.raw`select count(*)::integer n from survey_report_participants where tenant_id=${f.tenantId}`
      )[0].n,
    ).toBe(7);
  });
  it('actual frozen TL denominator changes from10 to8 on two full withdrawals; partial leaves8', async () => {
    const f = await s.fixture(10);
    const request = {
      ...s.request(f, 'intermediate'),
      scopeId: f.teamScopeId,
      projection: 'team_lead_overall' as const,
    };
    const before = await s.inputs.execute(request);
    expect(
      before.status === 'prepared' &&
        before.metrics.find((m) => m.metricKey === 'autonomy')?.requiredCount,
    ).toBe(8);
    const rights = new ReportingPermissionRepository(s.database);
    const withdraw = async (userId: string, lineageIds?: string[]) =>
      rights.withdraw({
        tenantId: f.tenantId,
        userId,
        personId: userId,
        requestId: randomUUID(),
        provenance: {
          kind: 'verified_subject',
          tenantId: f.tenantId,
          userId,
          personId: userId,
          verificationId: randomUUID(),
          receivedAt: new Date(),
        },
        target: lineageIds ? { kind: 'partial_reporting', lineageIds } : { kind: 'full_reporting' },
      });
    await withdraw(f.users[0]);
    await withdraw(f.users[1]);
    const after = await s.inputs.execute(request);
    expect(
      after.status === 'prepared' &&
        after.metrics.find((m) => m.metricKey === 'autonomy')?.requiredCount,
    ).toBe(7);
    const [lineage] =
      await s.raw`select pulse_report_lineage(${f.windows.get(f.users[2])!},${f.questions[0].id}) id`;
    await withdraw(f.users[2], [lineage.id]);
    const partial = await s.inputs.execute(request);
    expect(
      partial.status === 'prepared' &&
        partial.metrics.find((m) => m.metricKey === 'autonomy')?.requiredCount,
    ).toBe(7);
  });
  it('transferred/deactivated frozen subjects retain timely origin votes and denominator', async () => {
    const f = await s.fixture();
    for (const u of f.users.slice(0, 5)) for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '7');
    const { HierarchyMutationService } =
      await import('../../../../apps/api/src/hierarchy/hierarchy-mutation.service');
    await new HierarchyMutationService(s.database).moveEmployee(
      f.tenantId,
      f.users[0],
      f.unit.id,
      null,
      { type: 'internal_operator', operatorId: 'fixture' } as never,
    );
    await s.db
      .update(schema.users)
      .set({ status: 'inactive' })
      .where(eq(schema.users.id, f.users[1]));
    await s.start(f);
    const selected = await s.inputs.execute({ ...s.request(f), scopeId: f.teamScopeId });
    expect(
      selected.status === 'prepared' && selected.metrics.find((m) => m.kind === 'engagement'),
    ).toMatchObject({ completeCount: 5, rawMean: 7, status: 'eligible' });
    expect(await s.inputs.execute({ ...s.request(f), scopeId: randomUUID() })).toEqual({
      status: 'blocked',
      reason: 'missing_native_scope',
    });
  });
  it.each(['soft', 'hard'] as const)(
    'both certification orders invalidate %s erasure before provenance disappears',
    async (mode) => {
      for (const deletionFirst of [true, false]) {
        const f = await s.fixture();
        for (const u of f.users) for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '7');
        await s.start(f);
        const erase = async (tx: Pick<typeof s.db, 'delete' | 'update'>) => {
          if (mode === 'hard') {
            await tx
              .delete(schema.orgEmployeePlacements)
              .where(eq(schema.orgEmployeePlacements.employeePersonId, f.users[0]));
            await tx.delete(schema.users).where(eq(schema.users.id, f.users[0]));
          } else
            await tx
              .update(schema.users)
              .set({ deletedAt: new Date(), status: 'deleted' })
              .where(eq(schema.users.id, f.users[0]));
        };
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>((r) => (release = r)),
          locked = new Promise<void>((r) => (ready = r));
        if (deletionFirst) {
          const deleting = s.db.transaction(async (tx) => {
            await erase(tx);
            ready();
            await gate;
          });
          await locked;
          const preparing = s.inputs.execute(s.request(f));
          release();
          await deleting;
          const result = await preparing;
          expect(
            result.status === 'prepared' &&
              result.metrics.find((m) => m.kind === 'engagement')?.completeCount,
          ).toBe(5);
        } else {
          const { PulseReportInputRepository } =
            await import('../../../../apps/worker/src/survey/repositories/pulse-report-input.repository');
          const { computePulseReportInputs } =
            await import('../../../application/src/use-cases/prepare-pulse-report-inputs.use-case');
          let candidate = '';
          const sealing = s.db.transaction(async (tx) => {
            const result = await new PulseReportInputRepository({ client: tx } as never).prepare(
              s.request(f),
              computePulseReportInputs,
            );
            if (result.status !== 'prepared') throw Error('expected prepared');
            candidate = result.candidateId;
            ready();
            await gate;
          });
          await locked;
          const deleting = s.db.transaction((tx) => erase(tx));
          release();
          await sealing;
          await deleting;
          expect(
            (
              await s.raw`select invalidated_at from survey_report_input_candidates where id=${candidate}`
            )[0].invalidated_at,
          ).not.toBeNull();
          const result = await s.inputs.execute(s.request(f));
          expect(
            result.status === 'prepared' &&
              result.metrics.find((m) => m.kind === 'engagement')?.completeCount,
          ).toBe(5);
        }
      }
    },
  );
  it('unverified admission blocks final and explicit backdate after first-start is rejected', async () => {
    const f = await s.fixture();
    const old = await s.inbound(f, f.users[0], '7', new Date().toISOString());
    await s.start(f);
    expect(await s.inputs.execute(s.request(f))).toEqual({
      status: 'blocked',
      reason: 'unverified_receipt',
    });
    await expect(
      s.inbound(
        f,
        f.users[1],
        '7',
        String(
          (
            await s.raw`select received_at::text as at from messages where id=${old.inboundMessageId}`
          )[0].at,
        ),
      ),
    ).rejects.toThrow('pulse_receipt_backdate_after_formation');
  });
  it('saved-but-unqueued and fallback receipts cannot become insufficiency; current soft erasure invalidates safely', async () => {
    const f = await s.fixture();
    const input = await s.inbound(f, f.users[0]);
    await s.capture.capture(input);
    await s.commit(input, { fallback: true });
    await s.start(f);
    expect(await s.inputs.execute(s.request(f))).toEqual({
      status: 'blocked',
      reason: 'manual_reconciliation',
    });
    await s.db
      .update(schema.users)
      .set({ deletedAt: new Date(), status: 'deleted' })
      .where(eq(schema.users.id, f.users[0]));
    expect((await s.inputs.execute(s.request(f))).status).toBe('prepared');
  });
  it('actual positive prepare/history SQL spy cannot access private message or working traps', async () => {
    const f = await s.fixture();
    for (const u of f.users.slice(0, 5)) for (let q = 0; q < 3; q++) await s.numeric(f, u, q, '7');
    await s.db.insert(schema.surveyQuestionWorkingInsights).values({
      tenantId: f.tenantId,
      userId: f.users[0],
      surveyWindowId: f.windows.get(f.users[0])!,
      surveyQuestionId: f.questions[0].id,
      questionVersion: f.questions[0].version,
      workingSummary: 'PRIVATE_WORKING_TRAP',
    });
    await s.start(f);
    const queries: string[] = [];
    const db = drizzle(s.raw, {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    const { PulseReportInputRepository } =
      await import('../../../../apps/worker/src/survey/repositories/pulse-report-input.repository');
    const { PreparePulseReportInputsUseCase } =
      await import('../../../application/src/use-cases/prepare-pulse-report-inputs.use-case');
    const { PulseReportHistoryRepository } =
      await import('../../../../apps/worker/src/survey/repositories/pulse-report-history.repository');
    const service = { client: db } as never;
    const selected = await new PreparePulseReportInputsUseCase(
      new PulseReportInputRepository(service),
      new PulseReportHistoryRepository(service),
    ).execute(s.request(f));
    expect(selected.status === 'prepared' && selected.finalGate).toBe('eligible');
    expect(selected.status === 'prepared' && selected.qualitative).toEqual([]);
    expect(selected.status === 'prepared' && selected.baselines?.engagement).toEqual({
      status: 'baseline_established',
    });
    expect(queries.length).toBeGreaterThan(10);
    for (const query of queries)
      expect(query).not.toMatch(
        /\b(?:from|join)\s+(?:messages|survey_question_working_insights|survey_question_confirmation_bundles)\b/i,
      );
    const tables = [
      ...new Set(
        queries.flatMap((q) =>
          [...q.matchAll(/\b(?:from|join|into|update)\s+([a-z_][a-z_0-9]*)/gi)].map((m) => m[1]),
        ),
      ),
    ].sort();
    writeFileSync(
      resolve(__dirname, '../../../../runs/rpt-05/reader-query-isolation.json'),
      JSON.stringify(
        { status: 'passed', queryCount: queries.length, forbiddenPrivateReads: 0, tables },
        null,
        2,
      ) + '\n',
    );
  });
  it('reader and its transitive frontier helper never read private storage or reach recovery/provider APIs', () => {
    for (const file of [
      'apps/worker/src/survey/repositories/pulse-report-input.repository.ts',
      'apps/worker/src/survey/repositories/pulse-report-settlement.repository.ts',
      'packages/database/src/pulse-report-input-state.ts',
    ]) {
      const text = readFileSync(resolve(__dirname, '../../../..', file), 'utf8');
      expect(text).not.toMatch(
        /\b(?:from|join)\s+(?:messages|survey_question_working_insights|survey_question_confirmation_bundles)\b/i,
      );
      expect(text).not.toMatch(/\.add\(|recoveryBatch\(|generateResponse\(/);
    }
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))(
  'RPT05 shown forms and safe open-ended histories',
  () => {
    const s = rpt05FixtureSuite();
    afterAll(s.cleanup);
    async function open(f: Awaited<ReturnType<typeof s.fixture>>, userId = f.users[0]) {
      const { QuestionInsightRepository } =
        await import('../../../../apps/worker/src/survey/repositories/question-insight.repository');
      const repo = new QuestionInsightRepository(s.database, {
        findCurrentHierarchyIdentifiers: async () => [],
      } as never);
      const source = await s.inbound(
        f,
        userId,
        'Synthetic employee status with a clear work reason',
      );
      await s.capture.capture(source);
      const questions = f.questions.filter((q) => q.questionGroup === 'autonomy');
      const windowId = f.windows.get(userId)!;
      for (const q of questions)
        expect(
          await repo.captureMeaning({
            ...source,
            surveyWindowId: windowId,
            surveyQuestionId: q.id,
            questionVersion: q.version,
            sourceMessageId: source.inboundMessageId,
            meaning: 'Synthetic autonomy meaning ' + q.stableKey,
            sufficientMeaning: true,
            driverCaptured: true,
            driverDeclined: false,
          }),
        ).toBe('captured');
      await s.commit(source);
      const components = questions.map((q) => ({
        surveyQuestionId: q.id,
        questionVersion: q.version,
        statement: 'Synthetic statement ' + q.stableKey,
        expectedWorkingSummary: 'Synthetic autonomy meaning ' + q.stableKey,
      }));
      const text = components.map((c) => c.statement).join('\n');
      const [prompt] = await s.db
        .insert(schema.messages)
        .values({
          tenantId: f.tenantId,
          userId,
          conversationId: source.conversationId,
          direction: 'outbound',
          senderType: 'agent',
          text,
          occurredAt: new Date(),
        })
        .returning();
      const bundleId = await repo.stageQuestionConfirmationBundle({
        ...source,
        surveyWindowId: windowId,
        questionGroup: 'autonomy',
        promptMessageId: prompt.id,
        displayedText: text,
        components,
      });
      if (typeof bundleId !== 'string') throw Error('stage failed');
      await s.db
        .update(schema.messages)
        .set({ sentAt: new Date() })
        .where(eq(schema.messages.id, prompt.id));
      const confirmation = await s.inbound(f, userId, 'agree');
      await s.capture.capture(confirmation);
      return { repo, source, questions, windowId, prompt, bundleId, confirmation };
    }
    it('orders reverse native claims, preserves consumed shown identity and finalizes late into the same cutoff', async () => {
      const f = await s.fixture();
      const o = await open(f);
      const second = await s.inbound(f, f.users[0], 'agree');
      await s.capture.capture(second);
      await expect(
        s.conversation.claimNativeInput({ ...second, messageId: second.inboundMessageId }),
      ).rejects.toThrow('pulse_input_earlier_native_stage');
      const token = await s.conversation.claimNativeInput({
        ...o.confirmation,
        messageId: o.confirmation.inboundMessageId,
      });
      expect(await o.repo.findAwaitingQuestionBundle(o.confirmation)).toMatchObject({
        id: o.bundleId,
      });
      await o.repo.applyQuestionBundleVerdict({
        ...o.confirmation,
        nativeReportClaimToken: token!,
        bundleId: o.bundleId,
        verdict: { kind: 'agree' },
      });
      await s.commit(o.confirmation, { token: token!, evidence: true });
      const { SurveyEvidenceIntentRepository } =
        await import('../../../../apps/worker/src/survey/repositories/survey-evidence-intent.repository');
      await new SurveyEvidenceIntentRepository(s.database).complete(o.confirmation, async () => {});
      expect(
        (
          await s.raw`select evidence,finalization from survey_report_inbound_work where inbound_receipt_id=${o.confirmation.inboundMessageId}`
        )[0],
      ).toMatchObject({ evidence: 'applied', finalization: 'pending' });
      await s.db
        .update(schema.users)
        .set({ status: 'inactive' })
        .where(eq(schema.users.id, f.users[0]));
      const { ConversationProcessor } =
        await import('../../../../apps/worker/src/conversation/conversation.processor');
      const { CaptureEngagementAnswerUseCase } = await import('@entalent/application');
      let processed = 0;
      expect(
        await s.survey.hasUnresolvedQuestionConfirmationForInbound({
          ...second,
          messageId: second.inboundMessageId,
        }),
      ).toBe(true);
      const processor = new ConversationProcessor(
        {
          resumeCommittedTurn: async () => false,
          orchestrate: async (input: { nativeReportClaimToken?: string }) => {
            processed++;
            expect(await o.repo.findAwaitingQuestionBundle(second)).toMatchObject({
              id: o.bundleId,
            });
            await o.repo.applyQuestionBundleVerdict({
              ...second,
              nativeReportClaimToken: input.nativeReportClaimToken,
              bundleId: o.bundleId,
              verdict: { kind: 'agree' },
            });
            await s.commit(second, { token: input.nativeReportClaimToken });
            return {
              mode: 'coaching',
              classification: { primaryIntent: 'normal' },
              risk: { severity: 'low' },
            };
          },
        } as never,
        {} as never,
        { record: async () => {} } as never,
        s.database,
        s.conversation,
        s.survey,
        {} as never,
        new CaptureEngagementAnswerUseCase(s.capture),
      );
      await processor.process({
        name: 'conversation',
        data: { ...second, messageId: second.inboundMessageId, rapidMessageCoalescing: true },
        opts: { attempts: 3 },
        attemptsMade: 0,
      } as never);
      expect(processed).toBe(1);

      await s.start(f);
      expect(await s.inputs.execute(s.request(f))).toEqual({
        status: 'pending',
        reason: 'unresolved_stage',
      });
      const { FinalizeQuestionInsightUseCase } =
        await import('../../../application/src/use-cases/finalize-question-insight.use-case');
      const finalizer = new FinalizeQuestionInsightUseCase(
        o.repo,
        {
          scoreConfirmedMeaning: async () => ({
            outcome: 'scored',
            score: 70,
            confidence: 0.9,
            modelId: 'synthetic',
            promptVersion: 'fixture',
            direction: 'favorable',
            severity: 'low',
            rootCauseCategory: 'autonomy',
          }),
        },
        { deidentify: async () => 'Employees describe sufficient choice over their work methods.' },
      );
      expect(await finalizer.executePending({ tenantId: f.tenantId, userId: f.users[0] })).toBe(3);
      const result = await s.inputs.execute(s.request(f));
      expect(result.status).toBe('prepared');
      if (result.status !== 'prepared') throw Error('expected prepared');
      expect(result.qualitative).toHaveLength(3);
      expect(result.metrics.find((m) => m.metricKey === 'autonomy')).toMatchObject({
        rawMean: 70,
        completeCount: 1,
        status: 'insufficient_data',
      });
      expect(
        (
          await s.raw`select count(*)::integer n from survey_report_shown_components where tenant_id=${f.tenantId}`
        )[0].n,
      ).toBe(3);
      const [revision] =
        await s.raw`select * from survey_report_topic_watermarks where tenant_id=${f.tenantId} limit 1`;
      await expect(
        s.raw`update survey_report_insight_revisions set confirmation_received_at=confirmation_received_at+interval '1 microsecond' where insight_id=${revision.insight_id}`,
      ).rejects.toThrow('pulse_report_revision_metadata_immutable');
    });
    async function finalize(
      o: Awaited<ReturnType<typeof open>>,
      f: Awaited<ReturnType<typeof s.fixture>>,
      score: number | null,
    ) {
      const { FinalizeQuestionInsightUseCase } =
        await import('../../../application/src/use-cases/finalize-question-insight.use-case');
      const finalizer = new FinalizeQuestionInsightUseCase(
        o.repo,
        {
          scoreConfirmedMeaning: async () => ({
            outcome: score === null ? 'insufficient_evidence' : 'scored',
            score,
            confidence: 0.9,
            modelId: 'synthetic',
            promptVersion: 'fixture',
            direction: 'mixed',
            severity: 'low',
            rootCauseCategory: 'autonomy',
          }),
        },
        { deidentify: async () => 'Employees describe sufficient choice over their work methods.' },
      );
      return finalizer.executePending({ tenantId: f.tenantId, userId: f.users[0] });
    }
    async function agree(o: Awaited<ReturnType<typeof open>>) {
      const token = await s.conversation.claimNativeInput({
        ...o.confirmation,
        messageId: o.confirmation.inboundMessageId,
      });
      await o.repo.applyQuestionBundleVerdict({
        ...o.confirmation,
        nativeReportClaimToken: token!,
        bundleId: o.bundleId,
        verdict: { kind: 'agree' },
      });
      await s.commit(o.confirmation, { token: token! });
    }
    it('only the approved permanent privacy policy can enter a prepared input set', async () => {
      const f = await s.fixture();
      const o = await open(f);
      await agree(o);
      await finalize(o, f, 70);
      await s.start(f);
      const initial = await s.inputs.execute(s.request(f));
      expect(initial.status === 'prepared' && initial.qualitative).toHaveLength(3);
      await s.raw`update survey_question_insights set privacy_policy_version='unapproved-policy' where tenant_id=${f.tenantId}`;
      expect(await s.inputs.execute(s.request(f))).toEqual({
        status: 'blocked',
        reason: 'missing_proof',
      });
    });
    it('latest confirmed unscored state wins before eligibility; deletion/expiry cannot resurrect an older scored topic', async () => {
      const f = await s.fixture();
      const a = await open(f);
      await agree(a);
      await finalize(a, f, 70);
      const b = await open(f);
      await agree(b);
      await finalize(b, f, null);
      await s.start(f);
      const selected = await s.inputs.execute(s.request(f));
      expect(selected.status === 'prepared' && selected.qualitative.map((t) => t.value)).toEqual([
        null,
        null,
        null,
      ]);
      expect(
        selected.status === 'prepared' &&
          selected.metrics.find((m) => m.metricKey === 'autonomy')?.completeCount,
      ).toBe(0);
      const [latest] =
        await s.raw`select i.id from survey_question_insights i join survey_report_insight_revisions r on r.insight_id=i.id where i.tenant_id=${f.tenantId} and i.outcome='insufficient_evidence' order by i.id limit 1`;
      await s.raw`delete from survey_question_insights where id=${latest.id}`;
      const deleted = await s.inputs.execute(s.request(f));
      expect(deleted.status === 'prepared' && deleted.qualitative).toHaveLength(2);
      expect(
        deleted.status === 'prepared' &&
          deleted.metrics.find((m) => m.metricKey === 'autonomy')?.completeCount,
      ).toBe(0);
      await s.db
        .update(schema.tenants)
        .set({
          retentionPolicy: {
            messagesRetentionDays: 365,
            memoryRetentionDays: 0.000001,
            riskSignalRetentionDays: 90,
            auditLogRetentionDays: 2555,
          },
        })
        .where(eq(schema.tenants.id, f.tenantId));
      await new Promise((r) => setTimeout(r, 120));
      expect(await s.inputs.execute(s.request(f))).toEqual({
        status: 'blocked',
        reason: 'invalidated',
      });
      const expired = await s.inputs.execute(s.request(f));
      expect(expired.status === 'prepared' && expired.qualitative).toHaveLength(0);
    });
    it('post-cutoff confirmed correction cannot hide the original timely permanent revision', async () => {
      const f = await s.fixture();
      const a = await open(f);
      await agree(a);
      await finalize(a, f, 70);
      await s.start(f);
      const first = await s.inputs.execute(s.request(f));
      expect(first.status === 'prepared' && first.qualitative.map((t) => t.value)).toEqual([
        70, 70, 70,
      ]);
      const b = await open(f);
      await agree(b);
      await finalize(b, f, 20);
      const later = await s.inputs.execute(s.request(f));
      expect(later.status === 'prepared' && later.qualitative.map((t) => t.value)).toEqual([
        70, 70, 70,
      ]);
      expect(
        later.status === 'prepared' && later.qualitative.map((t) => t.revisionId).sort(),
      ).toEqual(
        first.status === 'prepared' ? first.qualitative.map((t) => t.revisionId).sort() : [],
      );
    });

    it('old consumed shown form outside participation bounds cannot block later inactive ordinary coaching', async () => {
      const f = await s.fixture();
      const o = await open(f);
      await agree(o);
      await finalize(o, f, 70);
      const { HierarchyMutationService } =
        await import('../../../../apps/api/src/hierarchy/hierarchy-mutation.service');
      await new HierarchyMutationService(s.database).moveEmployee(
        f.tenantId,
        f.users[0],
        f.unit.id,
        null,
        { type: 'internal_operator', operatorId: 'fixture' } as never,
      );
      await s.db
        .update(schema.users)
        .set({ status: 'inactive' })
        .where(eq(schema.users.id, f.users[0]));
      const later = await s.inbound(f, f.users[0], 'ordinary later message');
      expect(
        await s.survey.hasUnresolvedQuestionConfirmationForInbound({
          ...later,
          messageId: later.inboundMessageId,
        }),
      ).toBe(false);
      expect(
        await s.conversation.claimNativeInput({ ...later, messageId: later.inboundMessageId }),
      ).toBeNull();
      await expect(
        s.conversation.deferNativeInput({ ...later, messageId: later.inboundMessageId }),
      ).resolves.toBeUndefined();
    });
  },
);
