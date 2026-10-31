import { afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ConversationOrchestrator, FinalizeQuestionInsightUseCase, RecoverConfirmedQuestionInsightsUseCase } from '@entalent/application';
import { Queue, Worker } from 'bullmq';
import { PulseReportProgressRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-progress.repository';
import { SurveyEvidenceProcessor } from '../../../../apps/worker/src/survey/survey-evidence.processor';
import { QuestionCutoffProcessor } from '../../../../apps/worker/src/survey/question-cutoff.processor';
import { REPORTING_DISCLOSURE_VERSION } from '../../../application/src/utils/reporting-disclosure';
import { QuestionInsightRepository } from '../../../../apps/worker/src/survey/repositories/question-insight.repository';
import { PulseReportScopeRepository } from '../../../../apps/worker/src/survey/repositories/pulse-report-scope.repository';
import { readPulseFinalCandidates } from '../../../../apps/worker/src/survey/repositories/pulse-report-history.repository';
import { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
import * as schema from '../schema';

describe.runIf(Boolean(process.env.DATABASE_URL))(
  'RPT05 review corrections on migrated native storage',
  () => {
    const s = rpt05FixtureSuite();
    afterAll(s.cleanup);
    type F = Awaited<ReturnType<typeof s.fixture>>;
    const repo = () =>
      new QuestionInsightRepository(s.database, {
        findCurrentHierarchyIdentifiers: async () => [],
      } as never);
    async function historyAuthorization(candidateId: string, tenantId: string, historyKey: string) {
      return s.db.transaction(async (tx) => {
        // Exercise production candidate authorization directly; native completed history
        // requires real guarded snapshots and is covered by the RPT07 integration suite.
        const rows = await readPulseFinalCandidates(tx, tenantId, historyKey, [candidateId]);
        return rows[0]?.authorized;
      });
    }
    async function nextCycle(f: F) {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, f.cycle.periodEnd.getTime() - Date.now() + 5)),
      );
      const periodStart = new Date(Date.now() + 80),
        periodEnd = new Date(Date.now() + 86_400_000);
      const [cycle] = await s.db
        .insert(schema.surveyCycleScoringPolicies)
        .values({
          tenantId: f.tenantId,
          surveyDefinitionId: f.definitionId,
          scoringPolicyId: f.policy.id,
          periodStart,
          periodEnd,
        })
        .returning();
      await new Promise((r) => setTimeout(r, Math.max(0, periodStart.getTime() - Date.now() + 2)));
      await new PulseReportScopeRepository(s.database).openOrgNativeCycle({
        tenantId: f.tenantId,
        surveyDefinitionId: f.definitionId,
        periodStart,
        periodEnd,
      });
      const [scope] =
        await s.raw`select id from survey_report_scopes where tenant_id=${f.tenantId} and cycle_scoring_policy_id=${cycle.id} and kind='manager_overall'`;
      const windows = new Map<string, string>();
      for (const userId of [...f.users, ...f.leadList]) {
        const window = await s.survey.findOrCreateActiveWindow(userId, f.tenantId);
        if (!window || 'kind' in window) throw Error('new_cycle_window');
        windows.set(userId, window.id);
      }
      return { ...f, cycleId: cycle.id, cycle, windows, overallId: String(scope.id) };
    }
    async function ready(f: F, questionGroup = 'autonomy') {
      const source = await s.inbound(f, f.users[0], 'A synthetic meaningful employee message');
      const questions = f.questions.filter((q) => q.questionGroup === questionGroup);
      const repository = repo();
      for (const q of questions)
        expect(
          await repository.captureMeaning({
            ...source,
            surveyWindowId: f.windows.get(source.userId)!,
            surveyQuestionId: q.id,
            questionVersion: q.version,
            sourceMessageId: source.inboundMessageId,
            meaning: 'Synthetic choice ' + q.stableKey,
            sufficientMeaning: true,
            driverCaptured: true,
            driverDeclined: false,
          }),
        ).toBe('captured');
      return { source, questions, repository };
    }
    async function orchestrate(
      f: F,
      source: Awaited<ReturnType<typeof s.inbound>>,
      repository: QuestionInsightRepository,
      overrides: Record<string, unknown> = {},
    ) {
      const [message] = await s.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, source.inboundMessageId));
      const saved: Awaited<ReturnType<typeof s.conversation.saveMessage>>[] = [];
      const conversation = {
        findById: async () => ({
          id: source.conversationId,
          tenantId: f.tenantId,
          userId: source.userId,
          channelType: 'dev',
          externalConversationId: source.userId,
          userDisplayName: 'Fixture',
          userLocale: 'en',
          userTimezone: 'UTC',
        }),
        findRecentMessages: async () => [{ ...message, metadata: undefined }],
        findLatestDeliveredReportingDisclosure: async () => ({
          messageId: randomUUID(),
          version: REPORTING_DISCLOSURE_VERSION,
          shownAt: new Date(message.occurredAt.getTime() - 1000),
        }),
        saveMessage: async (input: Parameters<typeof s.conversation.saveMessage>[0]) => {
          const result = await s.conversation.saveMessage(input);
          saved.push(result);
          return result;
        },
        updateActiveTopic: vi.fn(),
      };
      const ai = {
        classifySituation: async () => ({
          primaryIntent: 'casual_conversation',
          secondaryIntents: [],
          emotionalState: [],
          urgency: 'low',
          confidence: 0.9,
          surveyAllowed: true,
          requiresSafetyCheck: false,
          reasoningSummary: 'synthetic',
          reminderRequest: null,
          dialogueAct: 'new_substance',
          latestUserSubstance: message.text,
          topicAnchor: null,
        }),
        detectRisk: async () => ({
          riskType: null,
          severity: 'none',
          confidence: 0.9,
          evidence: [],
          immediateResponseRequired: false,
          escalationRecommended: false,
          surveyMustBeBlocked: false,
          proactiveMessagesMustBePaused: false,
          reasoningSummary: 'synthetic',
        }),
        composeQuestionBundle: async (
          _turns: unknown,
          questions: Array<{ surveyQuestionId: string; workingSummary: string }>,
        ) => ({
          text: questions.map((q) => q.workingSummary).join(' ') + ' Is that right?',
          statements: questions.map((q) => ({
            surveyQuestionId: q.surveyQuestionId,
            statement: q.workingSummary,
          })),
        }),
        generateResponse: async (
          _turns: unknown,
          _strategy: unknown,
          context: { trailingBundle?: { text: string } },
        ) => ({
          text: context.trailingBundle
            ? `Dziękuję 🙂\n\n${context.trailingBundle.text}`
            : 'Dziękuję 🙂',
          replyText: 'Dziękuję 🙂',
          bundleText: context.trailingBundle?.text,
          confidence: 0.9,
          containsSurveyProbe: false,
        }),
        scoreSentiment: async () => 0.9,
        ...overrides,
      };
      const outbox = {
        enqueueMessageSend: vi.fn(),
        enqueueMemoryExtraction: vi.fn(),
        enqueueSurveyEvidence: vi.fn(),
        enqueueStyleAnalysis: vi.fn(),
        enqueueProfileHydration: vi.fn(),
      };
      const survey = {
        findPulseCaptureForConversation: async () => [],
        findPendingConfirmationGroups: async () => [],
        findAwaitingConfirmationGroups: async () => [],
        findCurrentHierarchyIdentifiers: async () => [],
      };
      const orchestrator = new ConversationOrchestrator(
        conversation as never,
        ai as never,
        outbox as never,
        undefined,
        survey as never,
        undefined,
        undefined,
        { isEnabled: async () => true } as never,
        undefined,
        undefined,
        undefined,
        undefined,
        repository,
        {
          run: (work: () => Promise<unknown>) =>
            (
              s.database as { withTransaction: (run: () => Promise<unknown>) => Promise<unknown> }
            ).withTransaction(work),
        } as never,
      );
      await orchestrator.orchestrate({
        ...source,
        messageId: source.inboundMessageId,
        externalWorkspaceId: 'fixture',
        externalConversationId: source.userId,
        traceId: randomUUID(),
      });
      return saved.at(-1)!;
    }
    async function shown(f: F, prefixed = true) {
      const o = await ready(f);
      let prompt: Awaited<ReturnType<typeof s.conversation.saveMessage>>;
      if (prefixed) prompt = await orchestrate(f, o.source, o.repository);
      else {
        const components = o.questions.map((q) => ({
          surveyQuestionId: q.id,
          questionVersion: q.version,
          statement: 'Synthetic statement ' + q.stableKey,
          expectedWorkingSummary: 'Synthetic choice ' + q.stableKey,
        }));
        const text = components.map((c) => c.statement).join(' ') + ' Is that right?';
        prompt = await s.conversation.saveMessage({ ...o.source, direction: 'outbound', text });
        await o.repository.stageQuestionConfirmationBundle({
          ...o.source,
          surveyWindowId: f.windows.get(o.source.userId)!,
          questionGroup: 'autonomy',
          promptMessageId: prompt.id,
          displayedText: text,
          components,
        });
      }
      await s.commit(o.source);
      await s.db
        .update(schema.messages)
        .set({ sentAt: new Date() })
        .where(eq(schema.messages.id, prompt.id));
      return { ...o, prompt };
    }
    it.runIf(Boolean(process.env.REDIS_URL))('R8 active native provider ownership survives cutoff inline recovery for a mixed legacy/native user', async () => {
      const f = await s.fixture(1), o = await shown(f);
      const reply = await s.inbound(f, f.users[0], 'agree');
      const awaiting = await o.repository.findAwaitingQuestionBundle(reply);
      expect(await o.repository.applyQuestionBundleVerdict({ ...reply, bundleId: awaiting!.id, verdict: { kind: 'agree' } })).toBe(true);
      await s.commit(reply);
      const nativeWindowId = f.windows.get(f.users[0])!;
      const [working] = await s.db.select().from(schema.surveyQuestionWorkingInsights).where(and(
        eq(schema.surveyQuestionWorkingInsights.surveyWindowId, nativeWindowId),
        eq(schema.surveyQuestionWorkingInsights.surveyQuestionId, o.questions[0].id),
      ));
      // An independent legacy window for the same employee retains the full real
      // capture -> shown statement -> employee verdict -> finalization path.
      const [legacy] = await s.db.insert(schema.surveyWindows).values({
        tenantId: f.tenantId, userId: f.users[0], surveyDefinitionId: f.definitionId,
        periodStart: new Date(f.cycle.periodStart.getTime() - 1000),
        periodEnd: f.cycle.periodEnd, status: 'active',
      }).returning();
      await s.db.insert(schema.surveyWindowScoringPolicies).values({
        surveyWindowId: legacy.id, tenantId: f.tenantId, scoringPolicyId: f.policy.id,
      });
      const legacyMeaning = 'Legacy opportunities were limited.';
      await s.db.insert(schema.surveyQuestionWorkingInsights).values(o.questions.map((q) => ({
        tenantId: f.tenantId, userId: f.users[0], surveyWindowId: legacy.id,
        surveyQuestionId: q.id, questionVersion: q.version, sourceMessageIds: working.sourceMessageIds,
        workingSummary: legacyMeaning + ' ' + q.stableKey, status: 'collecting', readyForConfirmation: true,
        meaningSufficient: true, driverResolved: true,
      })));
      const legacyText = o.questions.map((q) => legacyMeaning + ' ' + q.stableKey).join(' ');
      const prompt = await s.conversation.saveMessage({ ...reply, direction: 'outbound', text: legacyText });
      const legacyBundle = await o.repository.stageQuestionConfirmationBundle({
        ...reply, surveyWindowId: legacy.id, questionGroup: 'autonomy', promptMessageId: prompt.id,
        displayedText: legacyText, components: o.questions.map((q) => ({ surveyQuestionId: q.id,
          questionVersion: q.version, statement: legacyMeaning + ' ' + q.stableKey, expectedWorkingSummary: legacyMeaning + ' ' + q.stableKey })),
      });
      expect(typeof legacyBundle).toBe('string');
      const deliveredAt = new Date();
      await s.db.update(schema.messages).set({ sentAt: deliveredAt }).where(eq(schema.messages.id, prompt.id));
      await o.repository.activateDeliveredQuestionBundle({ tenantId: f.tenantId, conversationId: reply.conversationId, promptMessageId: prompt.id, deliveredAt });
      const legacyReply = await s.inbound(f, f.users[0], 'agree legacy');
      expect(await o.repository.applyQuestionBundleVerdict({ ...legacyReply, bundleId: legacyBundle as string, verdict: { kind: 'agree' } })).toBe(true);
      await s.commit(legacyReply);
      const nativeInput = { tenantId: f.tenantId, userId: f.users[0], surveyWindowId: nativeWindowId, surveyQuestionId: working.surveyQuestionId };
      const pendingOwner = { tenantId: f.tenantId, userId: f.users[0] };
      expect(await o.repository.listPendingConfirmedQuestions({ ...pendingOwner, scope: 'native_only' })).toHaveLength(3);
      expect(await o.repository.listPendingConfirmedQuestions({ ...pendingOwner, scope: 'legacy_only' })).toHaveLength(3);
      expect(await o.repository.loadConfirmedQuestion(nativeInput)).toMatchObject({ shownStatementReceipt: true });
      const progress = new PulseReportProgressRepository(s.database);
      expect(await progress.finalizationScope(reply)).toBe('native_only');
      expect(await progress.finalizationScope({ ...reply, inboundMessageId: randomUUID() })).toBe('legacy_only');
      let release!: () => void, started!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const entered = new Promise<void>((r) => { started = r; });
      let nativeCalls = 0;
      const scorer = { scoreConfirmedMeaning: vi.fn(async ({ semanticSummary }: { semanticSummary: string }) => {
        if (!semanticSummary.startsWith(legacyMeaning)) {
          nativeCalls++;
          if (nativeCalls === 1) { started(); await gate; }
        }
        return { score: 37, confidence: 0.86, modelId: 'fixture', promptVersion: 'fixture', direction: 'adverse' as const, severity: 'high' as const, rootCauseCategory: 'autonomy' as const };
      }) };
      const deidentifier = { deidentify: vi.fn(async () => 'Work opportunities were limited.') };
      const finalizer = new FinalizeQuestionInsightUseCase(o.repository, scorer, deidentifier);
      const recovery = new RecoverConfirmedQuestionInsightsUseCase({
        listPendingConfirmedUsers: async (...args) => (await o.repository.listPendingConfirmedUsers(...args)).filter((u) => u.tenantId === f.tenantId),
      }, finalizer);
      const url = new URL(process.env.REDIS_URL!);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/15') throw Error('isolated_redis_db15_required');
      const connection = { host: url.hostname, port: Number(url.port), db: 15 };
      const queue = new Queue(`rpt05-inline-${randomUUID()}`, { connection });
      let worker: Worker | undefined;
      const lifecycle = new QuestionCutoffProcessor(
        { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
        recovery, {} as never,
        { findUndispatchedTimelyQuestionReplies: async () => [], findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
        { getJob: async () => undefined, add: async () => {} } as never,
        { findRecoverableSurveyEvidence: async () => [] } as never,
        undefined, undefined, undefined, undefined, queue as never, undefined, undefined,
        { recoveryBatch: async () => [], reconcileOnly: async () => {} } as never,
      );
      try {
        const queued = await queue.add('finalize', { ...reply, mode: 'finalize_only' }, { jobId: `survey-evidence-${reply.inboundMessageId}` });
        const completed = new Promise<void>((resolve, reject) => {
          const consumer = new SurveyEvidenceProcessor({ assertConversationOwner: async () => {} } as never, finalizer, undefined, undefined, progress);
          worker = new Worker(queue.name, async (job) => consumer.process(job), { connection });
          worker.once('completed', () => resolve());
          worker.once('failed', (_job, error) => reject(error));
        });
        await entered;
        expect(await queued.getState()).toBe('active');
        await lifecycle.process({ name: 'cutoff' } as never);
        expect(nativeCalls).toBe(1);
        expect(scorer.scoreConfirmedMeaning).toHaveBeenCalledTimes(4);
        expect(deidentifier.deidentify).toHaveBeenCalledTimes(3);
        const legacyFinal = await s.db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.surveyWindowId, legacy.id));
        expect(legacyFinal).toHaveLength(3);
        // The user remains pending exclusively in native windows after legacy recovery.
        const legacyUsers = await o.repository.listPendingConfirmedUsers({ scope: 'legacy_only' });
        expect(legacyUsers).not.toContainEqual({ tenantId: f.tenantId, userId: f.users[0] });
        release();
        await completed;
        expect(nativeCalls).toBe(3);
        expect(deidentifier.deidentify).toHaveBeenCalledTimes(6);
      } finally {
        release();
        await worker?.close();
        await queue.obliterate({ force: true });
        await queue.close();
      }
    });
    it('R1 actual orchestrator Unicode answer prefix retains exact shown suffix after consumed bundle purge', async () => {
      const f = await s.fixture(1);
      const o = await shown(f);
      expect(o.prompt.text).toMatch(/^Dziękuję 🙂\n\n/);
      const reply = await s.inbound(f, f.users[0], 'agree');
      const awaiting = await o.repository.findAwaitingQuestionBundle(reply);
      expect(awaiting?.displayedText).toBe(o.prompt.text.split('\n\n').slice(1).join('\n\n'));
      expect(
        await o.repository.applyQuestionBundleVerdict({
          ...reply,
          bundleId: awaiting!.id,
          verdict: { kind: 'agree' },
        }),
      ).toBe(true);
      await s.commit(reply);
      const duplicate = await s.inbound(f, f.users[0], 'agree');
      expect(await o.repository.findAwaitingQuestionBundle(duplicate)).toMatchObject({
        id: awaiting!.id,
        displayedText: awaiting!.displayedText,
      });
    });
    it.each([false, true])(
      'R1/R2 native corrected statement prefix=%s preserves Unicode suffix/newline and the remaining clarification',
      async (prefixed) => {
        const f = await s.fixture(1);
        const o = await ready(f);
        await s.commit(o.source);
        const q = o.questions[0],
          windowId = f.windows.get(f.users[0])!;
        const [working] = await s.db
          .update(schema.surveyQuestionWorkingInsights)
          .set({ clarificationAttempts: 1 })
          .where(
            and(
              eq(schema.surveyQuestionWorkingInsights.surveyWindowId, windowId),
              eq(schema.surveyQuestionWorkingInsights.surveyQuestionId, q.id),
            ),
          )
          .returning();
        const statement = 'A synthetic corrected choice',
          text = statement + ' Is that right?' + (prefixed ? '\n' : '');
        const [prompt] = await s.db
          .insert(schema.messages)
          .values({
            tenantId: f.tenantId,
            userId: f.users[0],
            conversationId: o.source.conversationId,
            direction: 'outbound',
            senderType: 'agent',
            text: prefixed ? 'Dziękuję 🙂\n\n' + text : text,
            occurredAt: new Date(),
          })
          .returning();
        await o.repository.stageCorrectedStatementConfirmation({
          ...o.source,
          surveyWindowId: windowId,
          questionGroup: 'autonomy',
          workingInsightId: working.id,
          surveyQuestionId: q.id,
          questionVersion: q.version,
          promptMessageId: prompt.id,
          displayedText: text,
          statement,
          expectedWorkingSummary: working.workingSummary!,
        });
        await s.db
          .update(schema.messages)
          .set({ sentAt: new Date() })
          .where(eq(schema.messages.id, prompt.id));
        const reply = await s.inbound(f, f.users[0], 'No, still not right');
        expect(await o.repository.findAwaitingQuestionBundle(reply)).toMatchObject({
          clarificationAttempts: 1,
          displayedText: text,
        });
        const response = await orchestrate(f, reply, o.repository, {
          interpretQuestionBundleResponse: async () => ({ kind: 'reject' }),
          composeQuestionClarification: async () => 'Which work choice would you describe instead?',
        });
        expect(response.text).toContain('Which work choice would you describe instead?');
        expect(
          (
            await s.db
              .select()
              .from(schema.surveyQuestionWorkingInsights)
              .where(eq(schema.surveyQuestionWorkingInsights.id, working.id))
          )[0],
        ).toMatchObject({ status: 'pending_clarification', clarificationAttempts: 2 });
        await s.db
          .delete(schema.surveyQuestionWorkingInsights)
          .where(eq(schema.surveyQuestionWorkingInsights.id, working.id));
        expect(await o.repository.findAwaitingQuestionBundle(reply)).toMatchObject({
          clarificationAttempts: 2,
        });
      },
    );
    it.each(['unverified', 'blocked'] as const)(
      'R4 %s old cycle remains blocked for its report but cannot stop actual new-cycle orchestration',
      async (kind) => {
        const f = await s.fixture(1, 0.000025);
        const old = await s.inbound(
          f,
          f.users[0],
          'old',
          kind === 'unverified' ? new Date().toISOString() : undefined,
        );
        if (kind === 'blocked')
          await s.raw`update survey_report_inbound_work set native_verdict='blocked',failure_code='manual_reconciliation' where inbound_receipt_id=${old.inboundMessageId}`;
        await s.start(f);
        const next = await nextCycle(f);
        const input = await s.inbound(next, f.users[0], 'new');
        const token = await s.conversation.claimNativeInput({
          ...input,
          messageId: input.inboundMessageId,
        });
        expect(token).toBeTypeOf('string');
        const result = await orchestrate(next, input, repo());
        expect(result.text).toContain('Dziękuję');
        expect((await s.inputs.execute(s.request(f))).status).toBe('blocked');
      },
    );
    it('R3 post-frontier ordinary and new-cycle stages preserve old candidate; current full erasure still invalidates', async () => {
      const f = await s.fixture(1, 0.000025);
      await s.start(f);
      const candidate = await s.inputs.execute(s.request(f));
      if (candidate.status !== 'prepared') throw Error('candidate');
      expect(
        await historyAuthorization(candidate.candidateId, f.tenantId, candidate.context.historyKey),
      ).toBe(true);
      const later = await s.inbound(f, f.users[0], 'ordinary');
      await s.capture.capture(later);
      await s.commit(later);
      const next = await nextCycle(f);
      const input = await s.inbound(next, f.users[0], 'new cycle');
      await s.capture.capture(input);
      await s.commit(input);
      const [retained] =
        await s.raw`select invalidated_at from survey_report_input_candidates where id=${candidate.candidateId}`;
      expect(retained.invalidated_at).toBeNull();
      const replay = await s.inputs.execute(s.request(f));
      expect(replay.status === 'prepared' && replay.candidateId).toBe(candidate.candidateId);
      expect(
        await historyAuthorization(candidate.candidateId, f.tenantId, candidate.context.historyKey),
      ).toBe(true);
      await s.db
        .update(schema.users)
        .set({ status: 'deleted', deletedAt: new Date() })
        .where(eq(schema.users.id, f.users[0]));
      expect(
        (
          await s.raw`select invalidated_at from survey_report_input_candidates where id=${candidate.candidateId}`
        )[0].invalidated_at,
      ).not.toBeNull();
      expect(
        await historyAuthorization(candidate.candidateId, f.tenantId, candidate.context.historyKey),
      ).toBe(false);
    });
    it('R3 erasure of team B leaves disjoint team A candidate valid while Manager overall invalidates', async () => {
      const f = await s.fixture(2, 1, 2);
      const [teamA] =
        await s.raw`select id from survey_report_scopes where tenant_id=${f.tenantId} and org_team_id=${f.team.id}`;
      await s.start(f);
      const a = await s.inputs.execute({ ...s.request(f), scopeId: teamA.id });
      const overall = await s.inputs.execute(s.request(f));
      if (a.status !== 'prepared' || overall.status !== 'prepared') throw Error('candidate');
      await s.db
        .update(schema.users)
        .set({ status: 'deleted', deletedAt: new Date() })
        .where(eq(schema.users.id, f.users[1]));
      expect(
        (
          await s.raw`select invalidated_at from survey_report_input_candidates where id=${a.candidateId}`
        )[0].invalidated_at,
      ).toBeNull();
      expect(
        (
          await s.raw`select invalidated_at from survey_report_input_candidates where id=${overall.candidateId}`
        )[0].invalidated_at,
      ).not.toBeNull();
      expect(await historyAuthorization(a.candidateId, f.tenantId, a.context.historyKey)).toBe(
        true,
      );
      expect(
        await historyAuthorization(overall.candidateId, f.tenantId, overall.context.historyKey),
      ).toBe(false);
    });
    it.each(['consumed', 'expired'] as const)(
      'R5 new cycle never interprets latest old %s shown form',
      async (state) => {
        const f = await s.fixture(1, 0.000025);
        const o = await shown(f, false);
        if (state === 'consumed') {
          const reply = await s.inbound(f, f.users[0], 'agree');
          const bundle = await o.repository.findAwaitingQuestionBundle(reply);
          await o.repository.applyQuestionBundleVerdict({
            ...reply,
            bundleId: bundle!.id,
            verdict: { kind: 'agree' },
          });
          await s.commit(reply);
        } else
          await s.raw`update survey_question_confirmation_bundles set status='purged',purged_at=clock_timestamp(),components=null,displayed_text=null where prompt_message_id=${o.prompt.id}`;
        const next = await nextCycle(f);
        const reply = await s.inbound(next, f.users[0], 'new cycle message');
        expect(await o.repository.findAwaitingQuestionBundle(reply)).toBeNull();
        expect(
          await s.survey.hasUnresolvedQuestionConfirmationForInbound({
            ...reply,
            messageId: reply.inboundMessageId,
          }),
        ).toBe(false);
      },
    );
    it('R6 missing historical binding recovers a closed old window and late meaning without replacing newer active window', async () => {
      const f = await s.fixture(1, 0.000025, 1, false);
      const input = await s.inbound(f, f.users[0], 'timely old meaning');
      const next = await nextCycle(f);
      const newer = next.windows.get(f.users[0])!;
      const historical = await s.survey.findNativeWindowForInbound(input, true);
      expect(historical && historical.id).not.toBe(newer);
      if (!historical) throw Error('missing historical');
      expect(
        (
          await s.db.select().from(schema.surveyWindows).where(eq(schema.surveyWindows.id, newer))
        )[0].status,
      ).toBe('active');
      expect(historical.status).toBe('closed');
      const repository = repo();
      expect(await repository.getWindowMode({ ...input, surveyWindowId: historical.id })).toBe(
        'v2',
      );
      const q = f.questions.find((q) => q.questionGroup === 'autonomy')!;
      expect(
        await repository.captureMeaning({
          ...input,
          surveyWindowId: historical.id,
          surveyQuestionId: q.id,
          questionVersion: q.version,
          sourceMessageId: input.inboundMessageId,
          meaning: 'Synthetic timely old choice',
          sufficientMeaning: true,
          driverCaptured: true,
          driverDeclined: false,
        }),
      ).toBe('captured');
      const current = await s.inbound(next, f.users[0], 'current');
      expect((await s.survey.findNativeWindowForInbound(current, true))?.id).toBe(newer);
    });
    it('R7 actual erasure endpoint removes private shown metadata while preserving unknown-send proof clocks', async () => {
      const f = await s.fixture(1);
      const o = await shown(f);
      await s.numeric(f, f.users[0], 0, '7');
      expect((await s.raw`select id from messages where tenant_id=${f.tenantId} and sent_at is not null and metadata ? 'engagementProbe'`).length).toBe(1);
      const [unknown] = await s.db
        .insert(schema.messages)
        .values({
          tenantId: f.tenantId,
          userId: f.users[0],
          conversationId: o.source.conversationId,
          direction: 'outbound',
          senderType: 'agent',
          text: 'Private copied content',
          occurredAt: new Date(),
          metadata: {
            nativeShownComponents: [{ statement: 'Private copied content' }],
            deliveryState: 'unknown',
          },
        })
        .returning();
      await s.raw`update messages set delivery_attempted_at=clock_timestamp() where id=${unknown.id}`;
      const [before] =
        await s.raw`select persisted_at,delivery_attempted_at,delivery_recorded_at from messages where id=${unknown.id}`;
      expect((await s.raw`select engagement_delivery_ambiguous(persisted_at,delivery_attempted_at,delivery_recorded_at,clock_timestamp()) ambiguous from messages where id=${unknown.id}`)[0].ambiguous).toBe(true);
      const previous = process.env.DEFAULT_TENANT_ID;
      process.env.DEFAULT_TENANT_ID = f.tenantId;
      try {
        const { UserDataController } =
          await import('../../../../apps/api/src/users/user-data.controller');
        await new UserDataController(s.database, { append: async () => {} } as never).delete(
          f.users[0],
        );
      } finally {
        if (previous === undefined) delete process.env.DEFAULT_TENANT_ID;
        else process.env.DEFAULT_TENANT_ID = previous;
      }
      const rows =
        await s.raw`select text,normalized_text,metadata,deleted_at from messages where tenant_id=${f.tenantId} and user_id=${f.users[0]}`;
      expect(
        rows.every(
          (r) =>
            r.text === '[deleted]' &&
            r.normalized_text === null &&
            r.deleted_at !== null &&
            Object.keys(r.metadata).length === 0,
        ),
      ).toBe(true);
      const [after] =
        await s.raw`select persisted_at,delivery_attempted_at,delivery_recorded_at from messages where id=${unknown.id}`;
      expect(after).toEqual(before);
      expect((await s.raw`select engagement_delivery_ambiguous(persisted_at,delivery_attempted_at,delivery_recorded_at,clock_timestamp()) ambiguous from messages where id=${unknown.id}`)[0].ambiguous).toBe(true);
    });
  },
);
