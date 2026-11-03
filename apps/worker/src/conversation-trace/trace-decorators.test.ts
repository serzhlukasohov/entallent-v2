import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ConversationOrchestrator, type OrchestrateInput } from '@entalent/application';
import { TracingAiProvider } from '@entalent/conversation-trace';
import { ConversationModule } from '../conversation/conversation.module';
import { ConversationTraceRecorder } from './conversation-trace.recorder';
import type { ConversationTraceRepository, TurnTraceRow } from './conversation-trace.repository';
import { TurnCapture } from './turn-capture';

const TENANT = '11111111-1111-4111-8111-111111111111';
const input: OrchestrateInput = {
  messageId: 'in-1', tenantId: TENANT, userId: 'user-1', conversationId: 'conv-1',
  externalWorkspaceId: 'W', externalConversationId: 'D', traceId: 'trace-1',
};

/** Calls the module's real orchestrator factory with stub ports and a recorder whose switch is on. */
function buildFromCompositionRoot() {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConversationModule) as unknown[];
  const provider = providers.find((candidate) => (
    typeof candidate === 'object' && candidate !== null && 'provide' in candidate
    && (candidate as { provide: unknown }).provide === ConversationOrchestrator
  )) as { useFactory: (...deps: unknown[]) => ConversationOrchestrator; inject: unknown[] };
  const rows: TurnTraceRow[] = [];
  const recorder = new ConversationTraceRecorder({
    isTracingEnabled: async () => true,
    insert: async (row: TurnTraceRow) => { rows.push(row); },
  } as unknown as ConversationTraceRepository);
  const stub = () => ({
    findById: vi.fn(async () => { throw new Error('stub_stop'); }),
    raise: vi.fn(async () => undefined),
    enqueueMessageSend: vi.fn(async () => undefined),
    recordProbeSent: vi.fn(async () => undefined),
    // State reads (SPEC CAP-8): every store answers with something the capture can recognize.
    findActiveByUser: vi.fn(async () => [{ category: 'work', content: 'Leads releases', importance: 0.7, title: 'Ship', status: 'active', priority: 'high' }]),
    findByUser: vi.fn(async () => null),
    contextFor: vi.fn(async () => null),
    findCycleProgress: vi.fn(async () => ({ surveyWindowId: 'w', groups: [] })),
    getNextProbeQuestion: vi.fn(async () => null),
    findPulseCaptureForConversation: vi.fn(async () => []),
  });
  const deps = provider.inject.map((token) => (token === ConversationTraceRecorder
    ? recorder
    : { ...stub(), withTransaction: async (callback: () => Promise<unknown>) => callback() }));
  return { orchestrator: provider.useFactory(...deps), recorder, rows };
}

describe('conversation trace wiring at the composition root', () => {
  it('traces a turn of the real orchestrator built by the module factory', async () => {
    const { orchestrator, recorder, rows } = buildFromCompositionRoot();
    expect(orchestrator).toBeInstanceOf(ConversationOrchestrator);

    await expect(orchestrator.orchestrate(input)).rejects.toThrow('stub_stop');
    await recorder.flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: TENANT, inboundMessageId: 'in-1', status: 'failed' });
    expect(JSON.parse(rows[0]!.payloadJson).trace.at(-1)).toMatchObject({ kind: 'error', name: 'orchestrate' });
  });

  it('decorates the model port and labels each store the way the trace effects expect', async () => {
    const { orchestrator, recorder } = buildFromCompositionRoot();
    const ports = orchestrator as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
    expect(ports['aiProvider']).toBeInstanceOf(TracingAiProvider);

    const capture = new TurnCapture(input);
    await recorder.context.run(capture, async () => {
      await ports['escalation']!['raise']!({ type: 'risk', severity: 'high', riskType: 'burnout' });
      await ports['outbox']!['enqueueMessageSend']!({ text: 'hi' });
      await ports['pulseBacklogService']!['recordProbeSent']!('q-1');
    });

    expect(capture.events.map((event) => `${event.kind}:${event.name}`)).toEqual([
      'write:escalation.raise',
      'queue:outbox.enqueueMessageSend',
      'write:pulseBacklog.recordProbeSent',
    ]);
    expect(capture.effects.escalations).toEqual([{ type: 'risk', severity: 'high', riskType: 'burnout' }]);
  });

  it('hands the state reads of every store to the running turn and nothing outside a turn', async () => {
    const { orchestrator, recorder } = buildFromCompositionRoot();
    const ports = orchestrator as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
    const reads = async () => {
      await ports['memoryRepo']!['findActiveByUser']!('user-1', TENANT, 20);
      await ports['goalRepo']!['findActiveByUser']!('user-1', TENANT);
      await ports['styleProfileRepo']!['findByUser']!('user-1', TENANT);
      await ports['onboardingTurn']!['contextFor']!(TENANT, 'user-1');
      await ports['questionConfirmationRepo']!['findCycleProgress']!({ tenantId: TENANT, userId: 'user-1' });
      await ports['pulseBacklogService']!['getNextProbeQuestion']!('user-1', TENANT);
      await ports['surveyRepo']!['findPulseCaptureForConversation']!({ tenantId: TENANT });
    };

    const outside = new TurnCapture(input);
    await reads();
    expect(outside.stateBefore.state).toEqual({ readAfterWrite: [] });

    const capture = new TurnCapture(input);
    await recorder.context.run(capture, reads);
    expect(capture.stateBefore.state).toMatchObject({
      memory: [{ category: 'work', content: 'Leads releases', importance: 0.7 }],
      goals: [{ title: 'Ship', status: 'active', priority: 'high' }],
      styleProfile: null,
      onboarding: null,
      cycleProgress: { surveyWindowId: 'w', groups: [] },
      nextProbe: null,
      pulseCapture: { filteredBySource: false, items: [] },
      readAfterWrite: [],
    });
  });
});
