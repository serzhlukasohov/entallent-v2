import { describe, expect, it } from 'vitest';
import { hasStateReads, observeStateReads, StateBeforeCollector, type StateReadObserver } from './state-before';

const INBOUND = 'm-3';
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute));

function messages() {
  return [
    { id: 'm-1', direction: 'outbound', text: 'Hi Sam', occurredAt: at(0), metadata: { reportingDisclosureVersion: 'v1', decisions: { x: 1 } } },
    { id: 'm-2', direction: 'inbound', text: 'Busy week', occurredAt: at(1) },
    { id: INBOUND, direction: 'inbound', text: 'Release slipped again', occurredAt: at(5) },
  ];
}

class Observer implements StateReadObserver {
  recording = true;
  readonly collector = new StateBeforeCollector(INBOUND);
  observeRead(store: string, method: string, args: readonly unknown[], result: unknown): void {
    this.collector.observeRead(store, method, args, result);
  }
}

describe('StateBeforeCollector', () => {
  it('keeps the first read of each area, with plain JSON values', () => {
    const collector = new StateBeforeCollector(INBOUND);
    collector.observeRead('conversation', 'findMessagesThrough', [{ limit: 20 }], messages());
    collector.observeRead('conversation', 'findMessagesThrough', [{ limit: 20 }], []);
    collector.observeRead('memory', 'findActiveByUser', ['u', 't', 20], [{ category: 'work', content: 'Leads releases', importance: 0.8, id: 'x' }]);
    collector.observeRead('memory', 'findActiveByUser', ['u', 't', 20], []);
    collector.observeRead('goals', 'findActiveByUser', ['u', 't'], [{ title: 'Ship v2', category: 'work', status: 'active', priority: 'high' }]);
    collector.observeRead('questionConfirmation', 'findCycleProgress', [{}], {
      surveyWindowId: 'w-1', groups: [{ questionGroup: 'growth', questions: [{ surveyQuestionId: 'q-1', status: 'collecting' }] }],
    });
    collector.observeRead('onboarding', 'contextFor', ['t', 'u'], { state: {
      track: 'employee', introStatus: 'completed', participation: 'active', reminderStatus: 'none',
      buttonsActive: false, completedAt: at(0), managementAckAt: null, reminderOriginAt: null,
    } });

    const { state } = collector;
    expect(state.messages?.map((message) => message.text)).toEqual(['Hi Sam', 'Busy week', 'Release slipped again']);
    expect(state.messages?.[0]).toMatchObject({ occurredAt: at(0).toISOString(), metadata: { reportingDisclosureVersion: 'v1' } });
    expect(state.inboundIndex).toBe(2);
    expect(state.messagesLimit).toBe(20);
    expect(state.memory).toEqual([{ category: 'work', content: 'Leads releases', importance: 0.8 }]);
    expect(state.goals).toEqual([{ title: 'Ship v2', category: 'work', status: 'active', priority: 'high' }]);
    expect(state.cycleProgress?.groups[0]?.questions).toEqual([{ surveyQuestionId: 'q-1', status: 'collecting' }]);
    expect(state.onboarding).toMatchObject({ track: 'employee', completedAt: at(0).toISOString() });
    expect(state.readAfterWrite).toEqual([]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('ignores a history read that does not hold the inbound message', () => {
    const collector = new StateBeforeCollector(INBOUND);
    collector.observeRead('conversation', 'findRecentMessages', ['c', 20], messages().slice(0, 2));
    expect(collector.state.messages).toBeUndefined();
    collector.observeRead('conversation', 'findRecentMessages', ['c', 20], messages());
    expect(collector.state.inboundIndex).toBe(2);
  });

  it('flags an area first read after the turn wrote to a store that can change it', () => {
    const collector = new StateBeforeCollector(INBOUND);
    collector.noteWrite('conversation');
    collector.observeRead('memory', 'findActiveByUser', [], []);
    collector.noteWrite('questionConfirmation');
    collector.observeRead('questionConfirmation', 'findCycleProgress', [{}], null);
    collector.observeRead('questionConfirmation', 'findAwaitingQuestionBundle', [{}], { id: 'b' });
    expect(collector.state.readAfterWrite).toEqual(['cycleProgress', 'awaitingBundle']);
    expect(collector.state.cycleProgress).toBeNull();
    expect(collector.state.confirmation).toEqual({ awaitingBundle: true });
  });

  it('records an exact evidence read as filtered', () => {
    const collector = new StateBeforeCollector(INBOUND);
    collector.observeRead('survey', 'findPulseCaptureForConversation', [{ sourceMessageId: 'm-2' }], [
      { evidenceSummary: 'Covers for others', questionGroup: 'belonging', status: 'temporary', sourceMessageIds: ['m-2'] },
    ]);
    expect(collector.state.pulseCapture).toEqual({
      filteredBySource: true,
      items: [{ evidenceSummary: 'Covers for others', questionGroup: 'belonging', status: 'temporary', sourceMessageIds: ['m-2'] }],
    });
  });
});

describe('observeStateReads', () => {
  const port = {
    calls: 0,
    async findActiveByUser(): Promise<Array<{ category: string; content: string; importance: number }>> {
      this.calls += 1;
      return [{ category: 'work', content: 'x', importance: 0.5 }];
    },
    async save(): Promise<string> {
      return 'saved';
    },
    async failRead(): Promise<never> {
      throw new Error('db down');
    },
  };

  it('passes reads through and feeds the recording observer', async () => {
    const observer = new Observer();
    const wrapped = observeStateReads(port, 'memory', () => observer);
    expect(await wrapped.findActiveByUser()).toEqual([{ category: 'work', content: 'x', importance: 0.5 }]);
    expect(await wrapped.save()).toBe('saved');
    expect(observer.collector.state.memory).toHaveLength(1);
  });

  it('returns the read untouched when nothing records or the observer throws', async () => {
    const idle = new Observer();
    idle.recording = false;
    const read = port.findActiveByUser.bind(port);
    const wrappedIdle = observeStateReads(port, 'memory', () => idle);
    await wrappedIdle.findActiveByUser();
    expect(idle.collector.state.memory).toBeUndefined();

    const throwing: StateReadObserver = { recording: true, observeRead: () => { throw new Error('boom'); } };
    expect(await observeStateReads(port, 'memory', () => throwing).findActiveByUser()).toEqual(await read());
    expect(await observeStateReads(port, 'memory', () => { throw new Error('ctx'); }).findActiveByUser()).toHaveLength(1);
  });

  it('keeps rejections and leaves ports without state reads unwrapped', async () => {
    const failing = { async findActiveByUser(): Promise<never> { throw new Error('db down'); } };
    await expect(observeStateReads(failing, 'memory', () => new Observer()).findActiveByUser()).rejects.toThrow('db down');
    expect(observeStateReads(port, 'outbox', () => new Observer())).toBe(port);
    expect(hasStateReads('outbox')).toBe(false);
    expect(hasStateReads('conversation')).toBe(true);
  });
});
