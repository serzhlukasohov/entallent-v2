import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ScenarioResult } from '@langwatch/scenario';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineOutbox } from '../fakes/inline-outbox';
import {
  InMemoryConversationRepository,
  InMemoryGoalRepository,
  InMemoryMemoryRepository,
  InMemoryScheduledActionRepository,
  InMemoryStyleProfileRepository,
} from '../fakes/repositories';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import { CoachHarness, RecordingAiProvider, createSimConversation } from './coach-harness';
import { reportRun, type ScenarioRunReport } from './report';

const PROVIDER_ERROR = 'provider exploded during generation';

function throwingProvider(): ScriptedAiProvider {
  return new ScriptedAiProvider({
    responses: [
      () => {
        throw new TypeError(PROVIDER_ERROR);
      },
    ],
  });
}

describe('CoachHarness.send when the agent turn throws', () => {
  it('records the error on the harness and rethrows it', async () => {
    const harness = new CoachHarness({ aiProvider: throwingProvider() });

    await expect(harness.send('hello there')).rejects.toThrow(PROVIDER_ERROR);

    expect(harness.turns).toHaveLength(0);
    expect(harness.failures).toEqual([
      expect.objectContaining({ turn: 1, name: 'TypeError', message: PROVIDER_ERROR }),
    ]);
    expect(harness.failures[0]?.stack).toContain(PROVIDER_ERROR);
    // The inbound message and the generation attempt made before the throw stay observable.
    expect(harness.transcript.map((message) => message.direction)).toEqual(['inbound']);
    expect(harness.generateResponseCalls).toHaveLength(1);
  });
});

describe('CoachHarness with an injected clock', () => {
  it('stamps every persisted timestamp and the traceId from the same clock', async () => {
    const NOW = new Date('2026-01-05T12:00:00.000Z');
    const clock = { now: () => new Date(NOW.getTime()) };
    const scheduledActions = new InMemoryScheduledActionRepository(clock);
    const harness = new CoachHarness({
      aiProvider: new ScriptedAiProvider(),
      clock,
      scheduledActionRepo: scheduledActions,
      seedMemory: [{ category: 'preference', content: 'likes short replies', importance: 0.5 }],
    });
    const savedMessages = vi.spyOn(harness.conversationRepo, 'saveMessage');
    const deliveries = vi.spyOn(harness.conversationRepo, 'updateMessageDelivery');

    await harness.send('hello there');

    expect(harness.clock).toBe(clock);
    const conversation = await harness.conversationRepo.findById('sim-conversation', 'sim-tenant');
    expect(conversation?.userTimezoneUpdatedAt).toEqual(NOW);
    expect(harness.transcript.map((message) => message.direction)).toEqual(['inbound', 'outbound']);
    for (const message of harness.transcript) {
      expect(message.occurredAt).toEqual(NOW);
      expect(message.createdAt).toEqual(NOW);
    }
    expect(deliveries).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ sentAt: NOW }));
    const outbound = savedMessages.mock.calls.map(([params]) => params).find((params) => params.direction === 'outbound');
    expect(outbound?.traceId).toBe(`sim-turn-1-${NOW.getTime()}`);

    expect(harness.memoryRepo.items[0]?.createdAt).toEqual(NOW);
    const goal = await harness.goalRepo.save({
      tenantId: 'sim-tenant', userId: 'sim-user', title: 'Ship the report', sourceMessageIds: [],
    } as unknown as Parameters<typeof harness.goalRepo.save>[0]);
    expect(goal.createdAt).toEqual(NOW);
    const action = await scheduledActions.save({
      tenantId: 'sim-tenant', userId: 'sim-user', conversationId: 'sim-conversation',
      type: 'user_reminder', intent: 'send the report', context: {}, dueAt: NOW,
      timezone: 'UTC', cancellationConditions: [], sourceMessageIds: [], deduplicationKey: 'k',
    } as unknown as Parameters<typeof scheduledActions.save>[0]);
    expect(action.createdAt).toEqual(NOW);
  });
});

describe('in-memory fakes under a fixed clock', () => {
  const NOW = new Date('2026-01-05T12:00:00.000Z');
  const clock = { now: () => new Date(NOW.getTime()) };

  it('keeps the first turn in history when a frozen clock gives every message the same occurredAt', async () => {
    const harness = new CoachHarness({ aiProvider: new ScriptedAiProvider(), clock });

    await harness.send('first message');
    await harness.send('second message');

    const secondTurnHistory = harness.responseCallsByTurn[1]?.turns.map((turn) => turn.content) ?? [];
    expect(secondTurnHistory).toContain('first message');
    expect(secondTurnHistory).toContain('second message');
    const [, , secondInbound] = harness.transcript;
    const through = await harness.conversationRepo.findMessagesThrough({
      conversationId: 'sim-conversation', tenantId: 'sim-tenant', userId: 'sim-user',
      inboundMessageId: secondInbound!.id, limit: 20,
    });
    expect(through.map((message) => message.text)).toEqual([
      'first message', harness.replies[0], 'second message',
    ]);
  });

  it('filters memory expiry against the clock', async () => {
    const memory = new InMemoryMemoryRepository(clock);
    const base = {
      tenantId: 't', userId: 'u', category: 'preference', confidence: 0.9, importance: 0.5,
      sensitivity: 'normal', sourceMessageIds: [],
    };
    await memory.save({ ...base, content: 'expired', expiresAt: new Date(NOW.getTime() - 1) } as unknown as Parameters<typeof memory.save>[0]);
    await memory.save({ ...base, content: 'still valid', expiresAt: new Date(NOW.getTime() + 1) } as unknown as Parameters<typeof memory.save>[0]);

    const active = await memory.findActiveByUser('u', 't');

    expect(active.map((item) => item.content)).toEqual(['still valid']);
  });

  it('stamps scheduled-action markSent, postpone and cancel from the clock', async () => {
    let current = NOW.getTime();
    const advancing = { now: () => new Date(current) };
    const actions = new InMemoryScheduledActionRepository(advancing);
    const params = {
      tenantId: 't', userId: 'u', conversationId: 'c', type: 'user_reminder', intent: 'x', context: {},
      dueAt: NOW, timezone: 'UTC', cancellationConditions: [], sourceMessageIds: [],
    } as unknown as Parameters<typeof actions.save>[0];
    const sent = await actions.save({ ...params, deduplicationKey: 'a' });
    const postponed = await actions.save({ ...params, deduplicationKey: 'b' });
    const cancelled = await actions.save({ ...params, deduplicationKey: 'c' });

    current += 1000;
    await actions.markSent(sent.id, 't', 1);
    expect(sent.lastAttemptAt).toEqual(new Date(current));
    expect(sent.updatedAt).toEqual(new Date(current));

    current += 1000;
    await actions.postpone(postponed.id, 't', new Date(current + 60_000), 1);
    expect(postponed.lastAttemptAt).toEqual(new Date(current));
    expect(postponed.updatedAt).toEqual(new Date(current));

    current += 1000;
    await actions.cancel(cancelled.id, 't');
    expect(cancelled.updatedAt).toEqual(new Date(current));
  });
});

describe('scenario report after a failed agent turn', () => {
  const fixtureDirs: string[] = [];
  const originalReportDir = process.env.SIM_GATE_REPORT_DIR;
  const originalRunId = process.env.SIM_GATE_RUN_ID;

  afterEach(() => {
    process.env.SIM_GATE_REPORT_DIR = originalReportDir;
    process.env.SIM_GATE_RUN_ID = originalRunId;
    for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reportRun writes the recorded error as an agent-turn-error violation', async () => {
    const reportDir = mkdtempSync(join(process.cwd(), 'report-fixture-'));
    fixtureDirs.push(reportDir);
    process.env.SIM_GATE_REPORT_DIR = reportDir;
    process.env.SIM_GATE_RUN_ID = '';

    const harness = new CoachHarness({ aiProvider: throwingProvider() });
    await expect(harness.send('hello there')).rejects.toThrow(PROVIDER_ERROR);

    await reportRun(
      'agent turn error fixture',
      harness,
      { success: false, metCriteria: [], unmetCriteria: [], reasoning: 'judge not reached' } as unknown as ScenarioResult,
      false,
    );

    const report = JSON.parse(readFileSync(join(reportDir, 'agent-turn-error-fixture.json'), 'utf8')) as ScenarioRunReport;
    expect(report.deterministic.passed).toBe(false);
    expect(report.deterministic.violations).toEqual([
      { turn: 1, rule: 'agent-turn-error', detail: `TypeError: ${PROVIDER_ERROR}` },
    ]);
    expect(report.agentTurnErrors?.[0]).toEqual(
      expect.objectContaining({ turn: 1, name: 'TypeError', message: PROVIDER_ERROR }),
    );
    expect(report.turns).toEqual([]);
    const markdown = readFileSync(join(reportDir, 'agent-turn-error-fixture.md'), 'utf8');
    expect(markdown).toContain('agent-turn-error');
    expect(markdown).toContain(PROVIDER_ERROR);
    expect(markdown).not.toContain('all clear');
  });

  it('leaves a report with the error class when the test aborts before reportRun', () => {
    // Keep generated TypeScript outside src so parallel typechecks cannot discover a deleted fixture.
    const fixtureDir = mkdtempSync(join(process.cwd(), 'report-fixture-'));
    fixtureDirs.push(fixtureDir);
    const reportDir = join(fixtureDir, 'reports');
    const fixtureFile = join(fixtureDir, 'agent-turn-error.test.ts');
    const fixtureConfig = join(fixtureDir, 'vitest.config.mjs');
    writeFileSync(fixtureFile, `
      import { it } from 'vitest';
      import { CoachHarness } from ${JSON.stringify(join(process.cwd(), 'src/harness/coach-harness.ts'))};
      import { ScriptedAiProvider } from ${JSON.stringify(join(process.cwd(), 'src/fakes/scripted-ai.ts'))};
      it('aborted agent turn', async () => {
        const harness = new CoachHarness({
          aiProvider: new ScriptedAiProvider({ responses: [() => { throw new TypeError(${JSON.stringify(PROVIDER_ERROR)}); }] }),
        });
        await harness.send('hello there');
        throw new Error('unreachable: send must rethrow');
      });
    `);
    writeFileSync(fixtureConfig, `export default { root: ${JSON.stringify(process.cwd())}, test: { include: [${JSON.stringify(relative(process.cwd(), fixtureFile))}] } };`);

    const child = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', fixtureConfig, fixtureFile], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, SIM_GATE_REPORT_DIR: reportDir, SIM_GATE_RUN_ID: 'sample-1', SIM_GATE_ID: 'gate-1' },
    });
    expect(child.error).toBeUndefined();
    expect(child.status, `${child.stdout} ${child.stderr}`).toBe(1);

    const report = JSON.parse(readFileSync(join(reportDir, 'aborted-agent-turn-sample-1.json'), 'utf8')) as ScenarioRunReport;
    expect(report.gateId).toBe('gate-1');
    expect(report.gateRunId).toBe('sample-1');
    expect(report.judge.evaluated).toBe(false);
    expect(report.deterministic.passed).toBe(false);
    expect(report.deterministic.violations).toEqual(expect.arrayContaining([
      { turn: 1, rule: 'agent-turn-error', detail: `TypeError: ${PROVIDER_ERROR}` },
      expect.objectContaining({ rule: 'test-failure', detail: expect.stringContaining(PROVIDER_ERROR) }),
    ]));
    expect(readFileSync(join(reportDir, 'aborted-agent-turn-sample-1.md'), 'utf8')).toContain(PROVIDER_ERROR);
  }, 70_000);
});

describe('RecordingAiProvider', () => {
  it('forwards the bundle variant to the delegate', async () => {
    const delegate = new ScriptedAiProvider();
    const compose = vi.spyOn(delegate, 'composeQuestionBundle');
    const provider = new RecordingAiProvider(delegate, []);
    const turns = [{ role: 'user' as const, content: 'hi', timestamp: new Date() }];
    const questions = [{ surveyQuestionId: 'q-b', workingSummary: 'I decide my methods.' }];

    await provider.composeQuestionBundle(turns, questions, 'en', 'corrected_statement');

    expect(compose).toHaveBeenCalledWith(turns, questions, 'en', 'corrected_statement');
  });
});

describe('CoachHarness with injected ports', () => {
  it('uses the injected repositories and outbox and reports each turn with its traceId', async () => {
    const NOW = new Date('2026-01-05T12:00:00.000Z');
    const clock = { now: () => new Date(NOW.getTime()) };
    const ai = new ScriptedAiProvider();
    const conversationRepo = new InMemoryConversationRepository(createSimConversation({ timezone: 'UTC', clock }), clock);
    const memoryRepo = new InMemoryMemoryRepository(clock);
    const goalRepo = new InMemoryGoalRepository(clock);
    const styleRepo = new InMemoryStyleProfileRepository();
    const outbox = new InlineOutbox(ai, conversationRepo, memoryRepo, goalRepo, styleRepo, { clock });
    const enqueued = vi.spyOn(outbox, 'enqueueMessageSend');
    const harness = new CoachHarness({ aiProvider: ai, clock, conversationRepo, memoryRepo, goalRepo, styleRepo, outbox });

    const turn = await harness.sendTurn('hello there');

    expect(harness.conversationRepo).toBe(conversationRepo);
    expect(harness.outbox).toBe(outbox);
    expect(enqueued).toHaveBeenCalledTimes(1);
    expect(turn.traceId).toBe(`sim-turn-1-${NOW.getTime()}`);
    const [inbound, outbound] = conversationRepo.messages;
    expect(turn.inboundMessageId).toBe(inbound?.id);
    expect(turn.result.outboundMessageId).toBe(outbound?.id);
    expect(conversationRepo.sideFieldsOf(outbound!.id)).toEqual({ traceId: turn.traceId });
    expect(conversationRepo.deliveredAtOf(outbound!.id)).toEqual(NOW);
    expect(await harness.send('and again')).toBe(harness.replies[1]);
  });

  it('never reuses a traceId after a throwing turn under a fixed clock', async () => {
    const NOW = new Date('2026-01-05T12:00:00.000Z');
    const clock = { now: () => new Date(NOW.getTime()) };
    const harness = new CoachHarness({
      aiProvider: new ScriptedAiProvider({
        responses: [
          (_input, callIndex) => {
            if (callIndex === 0) throw new TypeError(PROVIDER_ERROR);
            return { text: 'Second try.', confidence: 0.9, containsSurveyProbe: false };
          },
        ],
      }),
      clock,
      fallbackReport: false,
    });

    await expect(harness.send('first')).rejects.toThrow(PROVIDER_ERROR);
    const turn = await harness.sendTurn('second');

    expect(turn.traceId).toBe(`sim-turn-2-${NOW.getTime()}`);
    expect(harness.failures[0]?.turn).toBe(1);
    const outbound = harness.transcript.filter((message) => message.direction === 'outbound');
    expect(outbound.map((message) => harness.conversationRepo.sideFieldsOf(message.id).traceId)).toEqual([turn.traceId]);
  });

  it('numbers ids per repository instance', async () => {
    const first = new InMemoryMemoryRepository();
    const second = new InMemoryMemoryRepository();
    const item = {
      tenantId: 't', userId: 'u', category: 'preference' as const, content: 'x', confidence: 1, importance: 1,
      sensitivity: 'normal' as const, sourceMessageIds: [],
    };
    expect((await first.save(item)).id).toBe('mem-1');
    expect((await second.save(item)).id).toBe('mem-1');
    expect((await first.save(item)).id).toBe('mem-2');
  });

  it('stores messageType and traceId as side fields without changing MessageRecord', async () => {
    const repo = new InMemoryConversationRepository(createSimConversation());
    const saved = await repo.saveMessage({
      conversationId: 'sim-conversation', tenantId: 'sim-tenant', userId: 'sim-user', direction: 'outbound',
      text: 'Check-in.', traceId: 'trace-1', messageType: 'proactive_check_in',
    });
    expect(saved).not.toHaveProperty('traceId');
    expect(saved).not.toHaveProperty('messageType');
    expect(repo.sideFieldsOf(saved.id)).toEqual({ traceId: 'trace-1', messageType: 'proactive_check_in' });
    expect(repo.sideFieldsOf('unknown')).toEqual({});
  });
});
