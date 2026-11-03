import { describe, expect, it, vi } from 'vitest';
import type {
  AiProviderPort,
  ConversationOrchestrator,
  ConversationRepositoryPort,
  OrchestrateInput,
  OrchestrateResult,
  OrchestratorLogger,
  OutboxPort,
} from '@entalent/application';
import type { TracedTurnPayload } from '@entalent/conversation-trace';
import { LocalEncryptionAdapter } from '../crypto/local-encryption.adapter';
import type { DatabaseService } from '../database/database.service';
import { ConversationTraceRecorder } from './conversation-trace.recorder';
import { ConversationTraceRepository, type TurnTraceRow } from './conversation-trace.repository';
import { traceConversationPorts, traceOrchestrator } from './trace-decorators';
import { TurnCapture } from './turn-capture';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function input(tenantId = TENANT, messageId = 'in-1'): OrchestrateInput {
  return {
    messageId, tenantId, userId: 'user-1', conversationId: 'conv-1',
    externalWorkspaceId: 'W', externalConversationId: 'D', traceId: `trace-${messageId}`,
  };
}

/** Fake storage: switch per tenant, rows kept as the repository would receive them. */
class FakeRepository {
  readonly rows: TurnTraceRow[] = [];
  lookups = 0;
  constructor(
    public enabledTenants: Set<string> = new Set([TENANT]),
    public failLookup = false,
    public failInsert: Error | null = null,
  ) {}

  async isTracingEnabled(tenantId: string): Promise<boolean> {
    this.lookups += 1;
    if (this.failLookup) throw new Error('db down');
    return this.enabledTenants.has(tenantId);
  }

  async insert(row: TurnTraceRow): Promise<void> {
    if (this.failInsert) throw this.failInsert;
    this.rows.push(row);
  }
}

/** Every port call the turn made, in order: proves tracing never changes writes or queued jobs. */
type CallLog = Array<[string, unknown[]]>;

/**
 * Stands in for `ConversationOrchestrator`: reads history, classifies, generates with memory and
 * cycle inputs, writes the outbound message, queues the send and warns, through the same ports
 * the composition root decorates.
 */
function buildTurn(options: {
  repository: FakeRepository;
  calls: CallLog;
  failWith?: Error;
  delayMs?: number;
  lateWrite?: () => void;
}) {
  const recorder = new ConversationTraceRecorder(options.repository as unknown as ConversationTraceRepository);
  const log = (name: string) => (...args: unknown[]) => { options.calls.push([name, args]); };
  const repo = {
    findMessagesThrough: async (query: { inboundMessageId: string }) => [
      { id: 'older', text: 'earlier message', direction: 'inbound' },
      { id: query.inboundMessageId, text: 'I am swamped with the release', direction: 'inbound' },
    ],
    saveMessage: async (params: Record<string, unknown>) => { log('conversation.saveMessage')(params); return { id: 'out-1', ...params }; },
  } as unknown as ConversationRepositoryPort;
  const ai = {
    classifySituation: async () => ({
      primaryIntent: 'venting', secondaryIntents: [], dialogueAct: 'statement', emotionalState: ['stressed'],
      urgency: 'low', requiresSafetyCheck: false, surveyAllowed: true,
    }),
    generateResponse: async () => ({ text: 'That sounds like a heavy week.' }),
  } as unknown as AiProviderPort;
  const outbox = { enqueueMessageSend: async (payload: unknown) => log('outbox.enqueueMessageSend')(payload) } as unknown as OutboxPort;
  const memory = { save: async (item: unknown) => { log('memory.save')(item); return item; } };
  const escalation = { raise: async (event: unknown) => log('escalation.raise')(event) };
  const warnings: string[] = [];
  const baseLogger: OrchestratorLogger = { warn: (message) => warnings.push(message) };

  const traced = traceConversationPorts(recorder);
  const ports = {
    repo: traced.conversation(repo),
    ai: traced.ai(ai),
    outbox: traced.writes(outbox, 'outbox'),
    memory: traced.writes(memory, 'memory'),
    escalation: traced.writes(escalation, 'escalation'),
    logger: traced.logger(baseLogger),
  };
  const orchestrator = {
    async orchestrate(turn: OrchestrateInput): Promise<OrchestrateResult> {
      await ports.repo.findMessagesThrough!({
        conversationId: turn.conversationId, tenantId: turn.tenantId, userId: turn.userId,
        inboundMessageId: turn.messageId, limit: 20,
      });
      const classification = await ports.ai.classifySituation([], {} as never);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.failWith) throw options.failWith;
      const context = {
        languagePolicy: { responseLanguage: 'en' },
        memoryContext: { items: [{ category: 'work', content: 'Leads the release' }], goals: [] },
        cycleProgress: { closed: 1, total: 3 },
        replyPlan: { responseMove: 'acknowledge', questionPolicy: { maxQuestions: 0 } },
      };
      const response = await ports.ai.generateResponse([], { mode: 'coach', tone: 'warm', maxResponseLength: 'short' } as never, context as never);
      await ports.memory.save({ category: 'work', content: `Release week (${turn.tenantId.slice(0, 2)})`, importance: 0.5 });
      ports.logger.warn('onboarding_degraded', { reason: 'test' });
      await ports.escalation.raise({ type: 'risk', severity: 'high', riskType: 'burnout', userId: 'u', tenantId: turn.tenantId, messageIds: [], traceId: 't' });
      await ports.repo.saveMessage({
        conversationId: turn.conversationId, tenantId: turn.tenantId, userId: turn.userId,
        direction: 'outbound', text: response.text, metadata: { replyPlanMove: 'acknowledge' },
      });
      await ports.outbox.enqueueMessageSend({ messageId: 'out-1', tenantId: turn.tenantId } as never);
      if (options.lateWrite) setTimeout(options.lateWrite, 5);
      return {
        outboundMessageId: 'out-1', responseText: response.text, mode: 'coach',
        classification, risk: { severity: 'none', riskType: null },
      } as unknown as OrchestrateResult;
    },
    async resumeCommittedTurn() { return false; },
  } as unknown as ConversationOrchestrator;
  return { recorder, orchestrator: traceOrchestrator(orchestrator, recorder), warnings, ports };
}

function payloadOf(row: TurnTraceRow): TracedTurnPayload {
  return JSON.parse(row.payloadJson) as TracedTurnPayload;
}

describe('ConversationTraceRecorder', () => {
  it('stores every report section of a traced turn, captured while it ran', async () => {
    const repository = new FakeRepository();
    const { orchestrator, recorder } = buildTurn({ repository, calls: [] });

    const result = await orchestrator.orchestrate(input());
    await recorder.flush();

    expect(result.responseText).toBe('That sounds like a heavy week.');
    expect(repository.rows).toHaveLength(1);
    const [row] = repository.rows;
    expect(row).toMatchObject({
      tenantId: TENANT, userId: 'user-1', conversationId: 'conv-1', inboundMessageId: 'in-1',
      outboundMessageId: 'out-1', traceId: 'trace-in-1', status: 'completed', schemaVersion: 1,
    });
    const payload = payloadOf(row!);
    expect(payload.userMessage).toBe('I am swamped with the release');
    expect(payload.trace.map((event) => `${event.kind}:${event.name}`)).toEqual([
      'inbound:message accepted',
      'llm:classifySituation',
      'llm:generateResponse',
      'write:memory.save',
      'warning:onboarding_degraded',
      'write:escalation.raise',
      'write:conversation.saveMessage',
      'queue:outbox.enqueueMessageSend',
      'decision:turn outcome',
    ]);
    expect(payload.turn).toMatchObject({
      index: 1,
      mode: 'coach',
      primaryIntent: 'venting',
      classification: { primaryIntent: 'venting', emotionalState: ['stressed'] },
      replyPlan: { responseMove: 'acknowledge' },
      responseInputs: { memoryContext: { items: ['work: Leads the release'], goals: [] }, cycleProgress: { closed: 1, total: 3 } },
      effects: {
        outboundMetadata: { replyPlanMove: 'acknowledge' },
        memoryAdded: [{ category: 'work', content: 'Release week (11)', importance: 0.5 }],
        escalations: [{ type: 'risk', severity: 'high', riskType: 'burnout' }],
        generationAttempts: 1,
      },
    });
    expect(payload.error).toBeNull();
  });

  it('stores nothing and summarizes nothing when the tenant switch is off', async () => {
    const repository = new FakeRepository(new Set());
    const { orchestrator, recorder } = buildTurn({ repository, calls: [] });

    await orchestrator.orchestrate(input());
    await recorder.flush();
    expect(repository.rows).toEqual([]);

    // The cached "off" answer means the next turn never even opens a capture.
    const record = vi.spyOn(recorder.sink, 'record');
    await orchestrator.orchestrate(input(TENANT, 'in-2'));
    await recorder.flush();
    expect(record).not.toHaveBeenCalled();
    expect(repository.rows).toEqual([]);
    expect(repository.lookups).toBe(1);
  });

  it('rethrows the same error and stores a failed trace', async () => {
    const repository = new FakeRepository();
    const failure = new TypeError('provider down');
    const { orchestrator, recorder } = buildTurn({ repository, calls: [], failWith: failure });

    await expect(orchestrator.orchestrate(input())).rejects.toBe(failure);
    await recorder.flush();

    const [row] = repository.rows;
    expect(row).toMatchObject({ status: 'failed', outboundMessageId: null });
    const payload = payloadOf(row!);
    expect(payload.turn).toBeNull();
    expect(payload.error).toBe('TypeError: provider down');
    expect(payload.trace.at(-1)).toMatchObject({ kind: 'error', name: 'orchestrate' });
  });

  it('leaves the turn untouched when the switch lookup fails', async () => {
    const repository = new FakeRepository(new Set([TENANT]), true);
    const calls: CallLog = [];
    const { orchestrator, recorder } = buildTurn({ repository, calls });

    const result = await orchestrator.orchestrate(input());
    await recorder.flush();

    expect(result.responseText).toBe('That sounds like a heavy week.');
    expect(calls.map(([name]) => name)).toEqual(['memory.save', 'escalation.raise', 'conversation.saveMessage', 'outbox.enqueueMessageSend']);
    expect(repository.rows).toEqual([]);
  });

  it.each([
    ['insert', () => new FakeRepository(new Set([TENANT]), false, new Error('insert failed'))],
    ['encryption', () => {
      // The real repository with a bad key: encryption throws before any insert.
      const repository = new FakeRepository();
      const real = new ConversationTraceRepository(
        { rootClient: { insert: () => { throw new Error('unreachable'); } } } as unknown as DatabaseService,
        new LocalEncryptionAdapter({ get: () => 'not-a-key' } as never),
      );
      repository.insert = (row) => real.insert(row);
      return repository;
    }],
  ])('a %s failure never changes the reply, the writes or the queued jobs', async (_name, makeRepository) => {
    const untracedCalls: CallLog = [];
    const untraced = buildTurn({ repository: new FakeRepository(new Set()), calls: untracedCalls });
    const expected = await untraced.orchestrator.orchestrate(input());

    const tracedCalls: CallLog = [];
    const traced = buildTurn({ repository: makeRepository(), calls: tracedCalls });
    const actual = await traced.orchestrator.orchestrate(input());
    await traced.recorder.flush();

    expect(actual).toEqual(expected);
    expect(tracedCalls).toEqual(untracedCalls);
    expect(traced.warnings).toEqual(untraced.warnings);
  });

  it('survives a payload that cannot be serialized', async () => {
    const repository = new FakeRepository();
    const recorder = new ConversationTraceRecorder(repository as unknown as ConversationTraceRepository);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const produced = {
      outboundMessageId: 'out-1', responseText: 'ok', mode: 'coach', classification: circular,
      risk: { severity: 'none', riskType: null },
    } as unknown as OrchestrateResult;

    await expect(recorder.traceTurn(input(), async () => produced)).resolves.toBe(produced);
    await recorder.flush();
    expect(repository.rows).toEqual([]);
  });

  it('does not make the job wait for the trace write', async () => {
    const repository = new FakeRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let inserted = false;
    repository.insert = async () => { await gate; inserted = true; };
    const { orchestrator, recorder } = buildTurn({ repository, calls: [] });

    await expect(orchestrator.orchestrate(input())).resolves.toMatchObject({ outboundMessageId: 'out-1' });
    expect(inserted).toBe(false);
    release();
    await recorder.flush();
  });

  it('keeps concurrent turns of different tenants apart', async () => {
    const repository = new FakeRepository(new Set([TENANT, OTHER_TENANT]));
    const { orchestrator, recorder } = buildTurn({ repository, calls: [], delayMs: 10 });

    await Promise.all([
      orchestrator.orchestrate(input(TENANT, 'in-a')),
      orchestrator.orchestrate(input(OTHER_TENANT, 'in-b')),
    ]);
    await recorder.flush();

    expect(repository.rows).toHaveLength(2);
    for (const row of repository.rows) {
      const payload = payloadOf(row);
      const own = row.tenantId.slice(0, 2);
      expect(payload.trace.filter((event) => event.kind === 'llm')).toHaveLength(2);
      expect(payload.trace.filter((event) => event.kind === 'write' || event.kind === 'queue')).toHaveLength(4);
      expect(payload.turn?.effects?.memoryAdded).toEqual([{ category: 'work', content: `Release week (${own})`, importance: 0.5 }]);
    }
  });

  it('ignores a write that lands after the turn settled', async () => {
    const repository = new FakeRepository();
    let lateWrite!: () => void;
    const late = new Promise<void>((resolve) => { lateWrite = resolve; });
    const built = buildTurn({ repository, calls: [], lateWrite: () => {
      void built.ports.memory.save({ category: 'late', content: 'after the turn', importance: 1 });
      lateWrite();
    } });

    await built.orchestrator.orchestrate(input());
    await late;
    await built.recorder.flush();

    const payload = payloadOf(repository.rows[0]!);
    expect(payload.trace.filter((event) => event.name === 'memory.save')).toHaveLength(1);
    expect(payload.turn?.effects?.memoryAdded.map((item) => item.category)).toEqual(['work']);
  });

  it('keeps the turn outcome as the last event of a runaway turn', async () => {
    const repository = new FakeRepository();
    const recorder = new ConversationTraceRecorder(repository as unknown as ConversationTraceRepository);
    const produced = {
      outboundMessageId: 'out-1', responseText: 'ok', mode: 'coach',
      classification: { primaryIntent: 'venting' }, risk: { severity: 'none', riskType: null },
    } as unknown as OrchestrateResult;
    await recorder.traceTurn(input(), async () => {
      for (let index = 0; index < 500; index += 1) recorder.sink.record('write', `store.save${index}`, 'x');
      return produced;
    });
    await recorder.flush();
    const payload = payloadOf(repository.rows[0]!);
    expect(payload.trace).toHaveLength(400);
    expect(payload.trace.at(-2)).toMatchObject({ kind: 'decision', name: 'turn outcome' });
    expect(payload.trace.at(-1)).toMatchObject({ kind: 'warning', name: 'trace truncated', summary: '102 events dropped' });
  });

  it('passes other orchestrator methods through untraced', async () => {
    const repository = new FakeRepository();
    const { orchestrator } = buildTurn({ repository, calls: [] });
    await expect(orchestrator.resumeCommittedTurn(input())).resolves.toBe(false);
    expect(repository.lookups).toBe(0);
  });
});

describe('ConversationTraceRecorder: state before the turn (SPEC CAP-8)', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute));

  function stateTurn(repository: FakeRepository, options: { throwingRead?: boolean } = {}) {
    const recorder = new ConversationTraceRecorder(repository as unknown as ConversationTraceRepository);
    const traced = traceConversationPorts(recorder);
    const history = [
      { id: 'old-1', direction: 'outbound', text: 'Hi Sam', occurredAt: at(0), metadata: { reportingDisclosureVersion: 'v1' } },
      { id: 'in-1', direction: 'inbound', text: 'Release slipped again', occurredAt: at(5) },
    ];
    const repo = traced.conversation({
      findMessagesThrough: async () => history,
      findById: async () => ({ userDisplayName: 'Sam', userTimezone: 'Europe/Kyiv', activeTopic: null }),
    } as unknown as ConversationRepositoryPort);
    const memory = traced.writes({ findActiveByUser: async () => [{ category: 'work', content: 'Leads releases', importance: 0.8 }] }, 'memory');
    const confirmation = traced.writes({
      applyQuestionBundleVerdict: async () => true,
      findCycleProgress: async () => ({ surveyWindowId: 'w-1', groups: [{ questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-1', status: 'confirmed' }] }] }),
    }, 'questionConfirmation');
    if (options.throwingRead) {
      // A capture that throws on every read must not change what the orchestrator gets.
      vi.spyOn(TurnCapture.prototype, 'observeRead').mockImplementation(() => { throw new Error('capture broke'); });
    }
    const seen: unknown[] = [];
    const orchestrator = traceOrchestrator({
      async orchestrate(turn: OrchestrateInput): Promise<OrchestrateResult> {
        seen.push(await repo.findById(turn.conversationId, turn.tenantId));
        seen.push(await repo.findMessagesThrough!({ ...turn, inboundMessageId: turn.messageId, limit: 20 }));
        seen.push(await memory.findActiveByUser());
        await confirmation.applyQuestionBundleVerdict();
        seen.push(await confirmation.findCycleProgress());
        return { outboundMessageId: 'out-1', responseText: 'ok', mode: 'coach', classification: {}, risk: { severity: 'none', riskType: null } } as unknown as OrchestrateResult;
      },
    } as unknown as ConversationOrchestrator, recorder);
    return { recorder, orchestrator, seen, history };
  }

  it('stores the history, memory and cycle the turn read, flagging a read that followed its own write', async () => {
    const repository = new FakeRepository();
    const { recorder, orchestrator } = stateTurn(repository);
    await orchestrator.orchestrate(input());
    await recorder.flush();

    const state = payloadOf(repository.rows[0]!).stateBefore!;
    expect(state.conversation).toEqual({ userDisplayName: 'Sam', userTimezone: 'Europe/Kyiv', hasActiveTopic: false });
    expect(state.messages?.map((message) => [message.direction, message.text, message.occurredAt])).toEqual([
      ['outbound', 'Hi Sam', at(0).toISOString()],
      ['inbound', 'Release slipped again', at(5).toISOString()],
    ]);
    expect(state.inboundIndex).toBe(1);
    expect(state.messagesLimit).toBe(20);
    expect(state.memory).toEqual([{ category: 'work', content: 'Leads releases', importance: 0.8 }]);
    expect(state.cycleProgress?.groups[0]?.questions).toEqual([{ surveyQuestionId: 'q-1', status: 'confirmed' }]);
    expect(state.readAfterWrite).toEqual(['cycleProgress']);
  });

  it('gives the orchestrator the same reads whether the capture works, throws or is switched off', async () => {
    const results: unknown[][] = [];
    for (const [tenants, throwingRead] of [[new Set([TENANT]), false], [new Set([TENANT]), true], [new Set<string>(), false]] as const) {
      const repository = new FakeRepository(tenants);
      const { recorder, orchestrator, seen } = stateTurn(repository, { throwingRead });
      await orchestrator.orchestrate(input());
      await recorder.flush();
      vi.restoreAllMocks();
      results.push(seen);
      if (tenants.size === 0) expect(repository.rows).toEqual([]);
      else if (throwingRead) expect(payloadOf(repository.rows[0]!).stateBefore).toEqual({ readAfterWrite: [] });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
