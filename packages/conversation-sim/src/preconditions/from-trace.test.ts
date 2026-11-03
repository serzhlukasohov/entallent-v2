import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversationTurn } from '@entalent/application';
import {
  preconditionFromTrace,
  responseInputs,
  StateBeforeCollector,
  TRACED_TURN_SCHEMA_VERSION,
  type TracedStateBefore,
  type TracedTurnPayload,
  type TracePreconditionFile,
} from '@entalent/conversation-trace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeClassification, ScriptedAiProvider } from '../fakes/scripted-ai';
import { listQaTests, loadQaTest } from '../qa/load';
import { qaTestSchema } from '../qa/schema';
import { parsePrecondition, restoreClock, seedHarness } from './load';
import type { PreconditionInput } from './schema';

// SPEC CAP-8: a traced turn becomes a precondition plus a test draft, and replaying the draft feeds
// the orchestrator the state the original turn read. Every value here is synthetic.

const GOAL = 'Hand over release duty by December';
const t = (minute: number) => new Date(Date.UTC(2026, 10, 2, 8, minute)).toISOString();

/** What the worker would have captured for the original turn (see `StateBeforeCollector`). */
function originalState(): TracedStateBefore {
  return {
    conversation: { userDisplayName: 'Sam', userTimezone: 'Europe/Kyiv', hasActiveTopic: false },
    messages: [
      { id: 'p-1', direction: 'outbound', text: 'Hi Sam, how is the week going?', occurredAt: t(0), metadata: { reportingDisclosureVersion: 'reporting-disclosure-v1' } },
      { id: 'p-2', direction: 'inbound', text: 'The team covers for each other a lot.', occurredAt: t(3) },
      { id: 'p-3', direction: 'outbound', text: 'That kind of cover matters. What made it work?', occurredAt: t(4), metadata: { replyShape: { askedQuestion: true }, internalDecision: 'x' } },
      { id: 'p-4', direction: 'inbound', text: 'Mostly the handover notes.', occurredAt: t(9) },
      { id: 'p-5', direction: 'outbound', text: 'Handover notes are underrated.', occurredAt: t(10) },
      { id: 'p-in', direction: 'inbound', text: 'Handover is moving. How far along are we with the check-in topics?', occurredAt: t(42) },
    ],
    inboundIndex: 5,
    messagesLimit: 20,
    reportingDisclosure: { version: 'reporting-disclosure-v1', shownAt: t(0) },
    // Production returns active memory by importance, highest first.
    memory: [
      { category: 'work', content: 'Leads the release checklist for the mobile app', importance: 0.9 },
      { category: 'preference', content: 'Prefers short messages during release weeks', importance: 0.6 },
    ],
    goals: [{ title: GOAL, category: 'work', status: 'active', priority: 'high' }],
    styleProfile: { dimensions: { register: 0.3, humor: 0.2, verbosity: 0.25, emoji: 0 }, phrases: [{ text: 'tbh', count: 2 }], adaptationWeight: 0.4, conversationsAnalyzed: 4 },
    onboarding: {
      track: 'employee', introStatus: 'completed', participation: 'active', reminderStatus: 'none',
      buttonsActive: false, completedAt: t(0), managementAckAt: null, reminderOriginAt: null,
    },
    cycleProgress: {
      surveyWindowId: 'window-7',
      groups: [
        { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-autonomy', status: 'confirmed' }] },
        { questionGroup: 'belonging', questions: [{ surveyQuestionId: 'q-belonging', status: 'collecting' }] },
        { questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-growth', status: 'collecting' }] },
      ],
    },
    nextProbe: {
      windowId: 'window-7', focus: 'open',
      question: { id: 'q-belonging', questionGroup: 'belonging', title: 'Belonging', canonicalMeaning: 'Feels part of the team', responseType: 'open_ended' },
    },
    pulseCapture: {
      filteredBySource: false,
      items: [{ evidenceSummary: 'The team covers for each other', questionGroup: 'belonging', status: 'temporary', sourceMessageIds: ['p-2'] }],
    },
    readAfterWrite: [],
  };
}

function originalPayload(): TracedTurnPayload {
  const state = originalState();
  return {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage: state.messages![5]!.text,
    trace: [{ turn: 1, kind: 'decision', name: 'turn outcome', summary: 'mode=coach' }],
    turn: null,
    error: null,
    truncated: false,
    stateBefore: state,
  };
}

const META = {
  tenantId: '7d1e0163-6d53-4713-bd24-254690cc5090',
  conversationId: '1c0b8a5e-3d7f-4f2a-9a51-6f1f3c2b9e10',
  traceRowId: '5f2c9a10-0000-4000-8000-000000000001',
  startedAt: t(42),
  status: 'completed' as const,
};

/** Records every call of `method` on `target` with its arguments and result as it was when read; the caller gets it unchanged. */
function recordReads(target: object, store: string, method: string, log: Array<[string, string, unknown[], Promise<unknown>]>): void {
  const original = (target as Record<string, (...args: unknown[]) => Promise<unknown>>)[method]!.bind(target);
  vi.spyOn(target as Record<string, (...args: unknown[]) => Promise<unknown>>, method).mockImplementation((...args: unknown[]) => {
    const result = original(...args);
    // Copied when it resolves: in-memory stores hand out live objects the turn later changes.
    log.push([store, method, args, result.then((value) => structuredClone(value))]);
    return result;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreClock();
});

describe('precondition from a traced turn (CAP-8)', () => {
  it('produces files the precondition and QA test schemas accept', () => {
    const { precondition, testDraft } = preconditionFromTrace(originalPayload(), META);
    // Compile-time: the converter's file type is a precondition input of this package.
    const typed: PreconditionInput = precondition satisfies TracePreconditionFile;
    const resolved = parsePrecondition(typed, 'traced/trace-5f2c9a10.json');
    expect(resolved.origin).toEqual({
      kind: 'trace', tenantId: META.tenantId, turnId: META.traceRowId, conversationId: META.conversationId, tracedAt: META.startedAt,
    });
    expect(resolved.state.history).toHaveLength(5);
    // The draft is a QA test that cannot run until QA writes an expected result.
    const draft = qaTestSchema.safeParse(testDraft);
    expect(draft.success).toBe(false);
    expect(draft.error?.issues[0]?.message).toContain('needs at least one expected result');
    expect(qaTestSchema.safeParse({ ...testDraft, expected: ['The reply states 1 of 3 topics are closed'] }).success).toBe(true);
  });

  it('keeps drafts out of the QA run folder and fails a moved draft loudly', () => {
    const root = mkdtempSync(join(tmpdir(), 'trace-extract-'));
    try {
      const { files, precondition, testDraft } = preconditionFromTrace(originalPayload(), META);
      const preconditions = join(root, 'preconditions');
      const qaTests = join(root, 'qa-tests');
      mkdirSync(join(preconditions, 'traced'), { recursive: true });
      mkdirSync(join(qaTests, 'drafts'), { recursive: true });
      writeFileSync(join(preconditions, files.precondition), JSON.stringify(precondition));
      writeFileSync(join(qaTests, files.testDraft), JSON.stringify(testDraft));
      expect(listQaTests(qaTests)).toEqual([]);

      const moved = join(qaTests, 'trace-5f2c9a10.json');
      writeFileSync(moved, JSON.stringify(testDraft));
      expect(() => loadQaTest(moved, preconditions)).toThrow(/expected: a QA test needs at least one expected result/);
      writeFileSync(moved, JSON.stringify({ ...testDraft, expected: ['The reply names the open topics'] }));
      expect(loadQaTest(moved, preconditions).resolvedPrecondition.name).toBe('trace-5f2c9a10');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('feeds the orchestrator the same history, memory, goals and cycle state as the original turn', async () => {
    const original = originalPayload();
    const { precondition, testDraft } = preconditionFromTrace(original, META);
    const classifierTurns: ConversationTurn[][] = [];
    const seeded = await seedHarness(parsePrecondition(precondition, 'traced/trace-5f2c9a10.json'), {
      aiProvider: new ScriptedAiProvider({
        classifications: [({ turns }) => {
          classifierTurns.push(turns);
          // A goal reaches the reply only on a progress update anchored on it; the cycle only on a status question.
          return makeClassification({ primaryIntent: 'progress_update', topicAnchor: GOAL, latestUserSubstance: GOAL, cycleStatusQuestion: true });
        }],
      }),
    });
    const { harness, cycle, onboarding } = seeded;
    const reads: Array<[string, string, unknown[], Promise<unknown>]> = [];
    recordReads(harness.conversationRepo, 'conversation', 'findById', reads);
    recordReads(harness.conversationRepo, 'conversation', 'findMessagesThrough', reads);
    recordReads(harness.memoryRepo, 'memory', 'findActiveByUser', reads);
    recordReads(harness.goalRepo, 'goals', 'findActiveByUser', reads);
    recordReads(harness.styleRepo, 'style', 'findByUser', reads);
    recordReads(onboarding!, 'onboarding', 'contextFor', reads);
    recordReads(cycle!.questionConfirmation, 'questionConfirmation', 'findCycleProgress', reads);

    await harness.send(testDraft.replies[0]!);

    // The replay's own reads, collected exactly as the worker collects production ones.
    const inbound = harness.transcript.filter((message) => message.direction === 'inbound').at(-1)!;
    const replay = new StateBeforeCollector(inbound.id);
    for (const [store, method, args, result] of reads) replay.observeRead(store, method, args, await result);
    const before = original.stateBefore!;
    const after = replay.state;

    const view = (state: TracedStateBefore) => state.messages!.map((message, index) => ({
      role: message.direction,
      text: message.text,
      minutesBeforeInbound: Math.round((Date.parse(state.messages![state.inboundIndex!]!.occurredAt) - Date.parse(message.occurredAt)) / 600) / 100,
      disclosure: message.metadata?.['reportingDisclosureVersion'] ?? null,
      replyShape: message.metadata?.['replyShape'] ?? null,
      index,
    }));
    expect(view(after)).toEqual(view(before));
    expect(after.conversation).toEqual(before.conversation);
    expect(after.memory).toEqual(before.memory);
    expect(after.goals).toEqual(before.goals);
    expect(after.styleProfile).toEqual(before.styleProfile);
    expect(after.onboarding).toEqual(before.onboarding);
    expect(after.cycleProgress).toEqual(before.cycleProgress);
    expect(after.readAfterWrite).toEqual([]);

    // The model saw the same conversation: history then the triggering message.
    expect(classifierTurns[0]!.map((turn) => [turn.role, turn.content])).toEqual(
      before.messages!.map((message) => [message.direction === 'inbound' ? 'user' : 'assistant', message.text]),
    );
    // And the generator got the memory, goals and cycle progress of that state.
    const inputs = responseInputs(harness.responseCallsByTurn[0]?.context ?? undefined);
    expect(inputs?.['memoryContext']).toEqual({
      items: before.memory!.map((item) => `${item.category}: ${item.content}`),
      goals: [`${GOAL} (active)`],
    });
    expect(inputs?.['cycleProgress']).toMatchObject({ topicsTotal: 3, topicsClosed: 1, openTopics: ['belonging', 'growth'] });

    // Pulse state not read on this turn is still what the original read: next probe and evidence.
    const probe = await cycle!.backlog.getNextProbeQuestion(inbound.userId, inbound.tenantId);
    expect(probe).toMatchObject({ windowId: 'window-7', focus: 'open', question: { id: 'q-belonging', title: 'Belonging', canonicalMeaning: 'Feels part of the team' } });
    const evidence = await cycle!.surveyRepo.findPulseCaptureForConversation({} as never);
    expect(evidence).toEqual([expect.objectContaining({ evidenceSummary: 'The team covers for each other', questionGroup: 'belonging', status: 'temporary' })]);
    const source = harness.transcript.find((message) => message.id === evidence[0]!.sourceMessageIds[0]);
    expect(source?.text).toBe('The team covers for each other a lot.');
  });

  it('keeps a disclosure delivered before a full history window out of what the model sees', async () => {
    const window = Array.from({ length: 19 }, (_, index) => ({
      id: `w-${index}`, direction: index % 2 ? 'inbound' as const : 'outbound' as const, text: `Window message ${index}`, occurredAt: t(index + 10),
    }));
    const payload: TracedTurnPayload = {
      ...originalPayload(),
      stateBefore: {
        ...originalState(),
        messages: [...window, { id: 'in', direction: 'inbound', text: 'And now?', occurredAt: t(40) }],
        inboundIndex: 19,
        reportingDisclosure: { version: 'reporting-disclosure-v1', shownAt: t(1) },
        pulseCapture: undefined,
      },
    };
    const { precondition, testDraft } = preconditionFromTrace(payload, META);
    const classifierTurns: ConversationTurn[][] = [];
    const harness = (await seedHarness(parsePrecondition(precondition, 'traced/x.json'), {
      aiProvider: new ScriptedAiProvider({ classifications: [({ turns }) => { classifierTurns.push(turns); return makeClassification(); }] }),
    })).harness;
    const disclosure = vi.spyOn(harness.conversationRepo, 'findLatestDeliveredReportingDisclosure');

    await harness.send(testDraft.replies[0]!);

    expect(classifierTurns[0]!.map((turn) => turn.content)).toEqual([...window.map((message) => message.text), 'And now?']);
    await expect(disclosure.mock.results[0]!.value).resolves.toMatchObject({ version: 'reporting-disclosure-v1' });
  });
});
