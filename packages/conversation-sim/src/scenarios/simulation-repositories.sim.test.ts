import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { SurveyRepositoryPort } from '@entalent/application';
import { CoachHarness } from '../harness/coach-harness';
import { reportDeterministicRun } from './baseline-test-helpers';
import type { ScenarioRunReport } from '../harness/report';
import { makeClassification, ScriptedAiProvider } from '../fakes/scripted-ai';
import { InMemoryConversationRepository, InMemoryStyleProfileRepository } from '../fakes/repositories';

const scope = { conversationId: 'conversation-1', tenantId: 'tenant-1', userId: 'user-1' };

describe('simulation repositories for committed work', () => {
  it('keeps delayed analysis history bounded by its scoped inbound source', async () => {
    const repo = new InMemoryConversationRepository({
      id: scope.conversationId, tenantId: scope.tenantId, userId: scope.userId,
      channelType: 'sim', externalConversationId: 'sim-channel', status: 'active',
    } as never);
    const first = await repo.saveMessage({ ...scope, direction: 'inbound', text: 'First',
      occurredAt: new Date('2026-01-01T10:00:00.000Z') });
    await repo.saveMessage({ ...scope, direction: 'inbound', text: 'Later',
      occurredAt: new Date('2026-01-01T10:01:00.000Z') });

    expect((await repo.findMessagesThrough({ ...scope, inboundMessageId: first.id, limit: 30 }))
      .map((message) => message.text)).toEqual(['First']);
    expect(await repo.findMessagesThrough({ ...scope, userId: 'other',
      inboundMessageId: first.id, limit: 30 })).toEqual([]);
  });

  it('applies a committed style update once for the same scoped source', async () => {
    const repo = new InMemoryStyleProfileRepository();
    const input = { ...scope, inboundMessageId: 'inbound-1' };
    const update = () => ({ userId: scope.userId, tenantId: scope.tenantId,
      version: 1 } as never);

    await repo.completeCommittedStyleAnalysis(input, update);
    await repo.completeCommittedStyleAnalysis(input, () => { throw new Error('duplicate update'); });

    expect(await repo.isCommittedStyleAnalysisComplete(input)).toBe(true);
    expect(await repo.isCommittedStyleAnalysisComplete({ ...input, userId: 'other' })).toBe(false);
    expect(await repo.findByUser(scope.userId, scope.tenantId)).toMatchObject({ version: 1 });
  });
});


describe('simulation turn-aligned generation evidence', () => {
  const reportDirs: string[] = [];
  afterAll(() => reportDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  async function readReport(harness: CoachHarness): Promise<{ report: ScenarioRunReport; markdown: string }> {
    const reportDir = mkdtempSync(join(tmpdir(), 'sim-turn-alignment-'));
    reportDirs.push(reportDir);
    vi.stubEnv('SIM_GATE_REPORT_DIR', reportDir);
    vi.stubEnv('SIM_GATE_RUN_ID', 'offline-alignment');
    try {
      await reportDeterministicRun('Turn alignment regression', harness);
    } finally {
      vi.unstubAllEnvs();
    }
    const fileStem = join(reportDir, 'turn-alignment-regression-offline-alignment');
    return {
      report: JSON.parse(readFileSync(`${fileStem}.json`, 'utf8')) as ScenarioRunReport,
      markdown: readFileSync(`${fileStem}.md`, 'utf8'),
    };
  }

  it('retains both de-identification generation attempts but reports the final plan for the send', async () => {
    const rejection = vi.fn().mockResolvedValue(true);
    const surveyRepo = {
      findAwaitingConfirmationGroups: async () => [],
      findPendingConfirmationGroups: vi.fn().mockResolvedValueOnce([{
        surveyWindowId: 'window-1', userId: 'sim-user', tenantId: 'sim-tenant',
        questionGroup: 'autonomy', updatedAt: new Date('2026-09-03T09:59:00.000Z'),
      }]).mockResolvedValue([]),
      findQuestionsForWindow: async () => [{ id: 'question-1', stableKey: 'ownership', questionGroup: 'autonomy' }],
      findEvidenceForQuestion: async () => [{ evidenceSummary: 'unclear ownership', polarity: 'negative',
        createdAt: new Date(), sourceMessageIds: ['source-1'] }],
      findTeamByMemberId: async () => null,
      findCurrentHierarchyIdentifiers: async () => [],
      recordGroupDeidentificationDecision: rejection,
    } as unknown as SurveyRepositoryPort;
    const harness = new CoachHarness({ surveyRepo, aiProvider: new ScriptedAiProvider({
      classifications: [makeClassification(), makeClassification({ surveyAllowed: false })],
      responses: [
        { text: 'Project Apollo is blocked on 2026-09-03. Is that fair?',
          confirmationSummary: 'Project Apollo is blocked on 2026-09-03.', confidence: 0.9, containsSurveyProbe: false },
        { text: 'We can work through ownership.', confidence: 0.9, containsSurveyProbe: false },
        { text: 'The next step is clear.', confidence: 0.9, containsSurveyProbe: false },
      ],
    }) });
    vi.spyOn(harness.conversationRepo, 'findLatestDeliveredReportingDisclosure').mockResolvedValue({
      version: 'reporting-disclosure-v1', shownAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(await harness.send('Ownership is unclear.')).toBe('We can work through ownership.');
    expect(rejection).toHaveBeenCalledWith(expect.objectContaining({
      deidentificationDecision: expect.objectContaining({ status: 'rejected' }),
    }));
    expect(harness.generateResponseCalls).toHaveLength(2);
    expect(harness.generateResponseCalls[0]?.context.confirmationRequest).toBeDefined();
    expect(harness.generateResponseCalls[1]?.context.confirmationRequest).toBeUndefined();
    expect(harness.responseCallsByTurn).toEqual([harness.generateResponseCalls[1]]);

    await harness.send('I know the next step now.');
    expect(harness.generateResponseCalls).toHaveLength(3);
    expect(harness.responseCallsByTurn).toEqual([
      harness.generateResponseCalls[1], harness.generateResponseCalls[2],
    ]);
    const { report } = await readReport(harness);
    expect(report.turns[0]?.replyPlan).toEqual(harness.generateResponseCalls[1]?.context.replyPlan);
    expect(report.turns[0]?.replyPlan).not.toEqual(harness.generateResponseCalls[0]?.context.replyPlan);
    expect(report.turns[1]?.replyPlan).toEqual(harness.generateResponseCalls[2]?.context.replyPlan);
  });

  it('does not attach a failed send generation call to the next successful turn', async () => {
    const harness = new CoachHarness({ aiProvider: new ScriptedAiProvider({
      responses: [
        () => { throw new Error('synthetic generation failure'); },
        { text: 'Recovered reply.', confidence: 0.9, containsSurveyProbe: false },
      ],
    }) });
    await expect(harness.send('First attempt.')).rejects.toThrow('synthetic generation failure');
    expect(harness.turns).toEqual([]);
    expect(harness.responseCallsByTurn).toEqual([]);
    expect(harness.generateResponseCalls).toHaveLength(1);

    expect(await harness.send('Second attempt.')).toBe('Recovered reply.');
    expect(harness.turns).toHaveLength(1);
    expect(harness.generateResponseCalls).toHaveLength(2);
    expect(harness.responseCallsByTurn).toEqual([harness.generateResponseCalls[1]]);
    expect(harness.responseCallsByTurn[0]?.turns.at(-1)?.content).toBe('Second attempt.');
    const { report } = await readReport(harness);
    expect(report.turns[0]?.replyPlan).toEqual(harness.generateResponseCalls[1]?.context.replyPlan);
  });

  it('keeps report plans and assertions aligned across a data_use_explanation bypass', async () => {
    const primaryIntent = 'data_use_explanation';
    const first = 'Help me prepare a meeting.';
    const bypass = 'How do you use my messages?';
    const third = 'No, I was asking for meeting preparation advice.';
    const harness = new CoachHarness({
      aiProvider: new ScriptedAiProvider({
        classifications: [
          makeClassification({ dialogueAct: 'request', latestUserSubstance: first }),
          makeClassification({ primaryIntent, dialogueAct: 'request', latestUserSubstance: bypass, surveyAllowed: false }),
          makeClassification({ dialogueAct: 'correction', latestUserSubstance: third }),
        ],
      }),
    });
    await harness.send(first);
    await harness.send(bypass);
    await harness.send(third);

    const { report, markdown } = await readReport(harness);
    expect(report.turns).toHaveLength(3);
    expect(report.turns[0]?.replyPlan?.latestUserSubstance).toBe(first);
    expect(report.turns[1]).toMatchObject({ primaryIntent, replyPlan: null, replyBrief: null });
    expect(report.turns[2]?.replyPlan).toMatchObject({ dialogueAct: 'correction', latestUserSubstance: third });
    expect(markdown).toMatch(new RegExp(`\\*\\*2\\. \\[.*${primaryIntent}.*\\nreplyPlan=none`));
    expect(markdown).toContain(`substance=${third}`);

    expect(harness.generateResponseCalls).toHaveLength(2);
    expect(harness.responseCallsByTurn).toHaveLength(harness.turns.length);
    expect(harness.responseCallsByTurn[0]).toBe(harness.generateResponseCalls[0]);
    expect(harness.responseCallsByTurn[1]).toBeNull();
    expect(harness.responseCallsByTurn[2]).toBe(harness.generateResponseCalls[1]);
    expect(harness.responseCallsByTurn[2]?.turns.at(-1)?.content).toBe(third);
  });

  // GC round 3 CAP-5: a pulse-capture question is answered by the model from captureFacts, so the
  // turn is generated (not bypassed) and the report must carry that generation call's plan.
  it('aligns a generated pulse_capture_explanation turn with its captureFacts generation call', async () => {
    const primaryIntent = 'pulse_capture_explanation';
    const first = 'Help me prepare a meeting.';
    const question = 'What exact pulse information did you capture from this discussion?';
    const third = 'No, I was asking for meeting preparation advice.';
    const findPulseCaptureForConversation = vi.fn().mockResolvedValue([{
      evidenceSummary: 'Meeting preparation feels rushed.', questionGroup: 'workload',
      sourceMessageIds: ['source-1'], status: 'temporary',
    }]);
    const harness = new CoachHarness({
      surveyRepo: {
        findPulseCaptureForConversation,
        findAwaitingConfirmationGroups: async () => [],
        findPendingConfirmationGroups: async () => [],
      } as unknown as SurveyRepositoryPort,
      aiProvider: new ScriptedAiProvider({
        classifications: [
          makeClassification({ dialogueAct: 'request', latestUserSubstance: first }),
          makeClassification({ primaryIntent, dialogueAct: 'request', latestUserSubstance: question,
            pulseCaptureScope: { type: 'conversation' }, surveyAllowed: false }),
          makeClassification({ dialogueAct: 'correction', latestUserSubstance: third }),
        ],
      }),
    });
    await harness.send(first);
    await harness.send(question);
    await harness.send(third);

    expect(harness.generateResponseCalls).toHaveLength(3);
    expect(harness.responseCallsByTurn).toEqual(harness.generateResponseCalls);
    expect(findPulseCaptureForConversation).toHaveBeenCalledTimes(1);
    expect(harness.generateResponseCalls[1]?.turns.at(-1)?.content).toBe(question);
    expect(harness.generateResponseCalls[1]?.context.captureFacts).toEqual({
      scope: 'conversation',
      captures: [{ evidenceSummary: 'Meeting preparation feels rushed.', status: 'temporary' }],
    });
    expect(harness.generateResponseCalls[0]?.context.captureFacts).toBeUndefined();
    expect(harness.generateResponseCalls[2]?.context.captureFacts).toBeUndefined();

    const { report, markdown } = await readReport(harness);
    expect(report.turns).toHaveLength(3);
    expect(report.turns[0]?.replyPlan?.latestUserSubstance).toBe(first);
    expect(report.turns[1]).toMatchObject({
      primaryIntent,
      replyPlan: { dialogueAct: 'request', responseMove: 'answer_request', latestUserSubstance: question },
    });
    expect(report.turns[1]?.replyPlan).toEqual(harness.generateResponseCalls[1]?.context.replyPlan);
    expect(report.turns[2]?.replyPlan).toMatchObject({ dialogueAct: 'correction', latestUserSubstance: third });
    expect(markdown).toMatch(new RegExp(`\\*\\*2\\. \\[.*${primaryIntent}.*\\nreplyPlan=request/answer_request`));
    expect(markdown).toContain(`substance=${question}`);
    expect(markdown).not.toContain('replyPlan=none');
  });
});
