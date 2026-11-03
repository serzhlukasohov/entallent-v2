import { describe, expect, it } from 'vitest';
import type { TracedStateBefore } from '../state-before';
import { TRACED_TURN_SCHEMA_VERSION, type TracedTurnPayload } from '../turn';
import { preconditionFromTrace, traceExtractionName, TraceExtractionError } from './from-trace';

// Synthetic test-tenant data only.
const META = {
  tenantId: '7d1e0163-6d53-4713-bd24-254690cc5090',
  conversationId: '1c0b8a5e-3d7f-4f2a-9a51-6f1f3c2b9e10',
  traceRowId: '5f2c9a10-0000-4000-8000-000000000001',
  startedAt: '2026-11-01T09:10:00.500Z',
  status: 'completed' as const,
};
const t = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 1, 9, minute, second)).toISOString();

function state(overrides: Partial<TracedStateBefore> = {}): TracedStateBefore {
  return {
    conversation: { userDisplayName: 'Sam', userTimezone: 'Europe/Kyiv', hasActiveTopic: false },
    messages: [
      { id: 'm-1', direction: 'outbound', text: 'Hi Sam, quick check-in.', occurredAt: t(0), metadata: { reportingDisclosureVersion: 'v1', decisions: { internal: true } } },
      { id: 'm-2', direction: 'inbound', text: 'The team covers for each other.', occurredAt: t(2) },
      { id: 'm-3', direction: 'outbound', text: 'That sounds supportive.', occurredAt: t(3), metadata: { replyShape: { askedQuestion: true }, sourceInboundMessageId: 'm-2' } },
      { id: 'm-4', direction: 'inbound', text: 'Release slipped again', occurredAt: t(10) },
    ],
    inboundIndex: 3,
    messagesLimit: 20,
    reportingDisclosure: { version: 'v1', shownAt: t(0) },
    memory: [{ category: 'work', content: 'Leads the release checklist', importance: 0.8 }],
    goals: [{ title: 'Hand over release duty', category: 'work', status: 'active', priority: 'high' }],
    styleProfile: { dimensions: { register: 0.3, humor: 0.2, verbosity: 0.4, emoji: 0 }, phrases: [], adaptationWeight: 0.4, conversationsAnalyzed: 3 },
    onboarding: {
      track: 'employee', introStatus: 'completed', participation: 'active', reminderStatus: 'none',
      buttonsActive: false, completedAt: t(0), managementAckAt: null, reminderOriginAt: null,
    },
    cycleProgress: {
      surveyWindowId: 'w-1',
      groups: [
        { questionGroup: 'autonomy', questions: [{ surveyQuestionId: 'q-autonomy', status: 'confirmed' }] },
        { questionGroup: 'belonging', questions: [{ surveyQuestionId: 'q-belonging', status: 'collecting' }] },
      ],
    },
    nextProbe: { windowId: 'w-1', focus: 'open', question: { id: 'q-belonging', questionGroup: 'belonging', title: 'Belonging', canonicalMeaning: 'Feels part of the team' } },
    pulseCapture: { filteredBySource: false, items: [{ evidenceSummary: 'The team covers for each other', questionGroup: 'belonging', status: 'temporary', sourceMessageIds: ['m-2'] }] },
    readAfterWrite: [],
    ...overrides,
  };
}

function payload(stateBefore: TracedStateBefore | undefined, userMessage = 'Release slipped again'): TracedTurnPayload {
  return {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage,
    trace: [],
    turn: null,
    error: null,
    truncated: false,
    ...(stateBefore ? { stateBefore } : {}),
  };
}

describe('preconditionFromTrace', () => {
  it('builds the state before the turn and a draft whose only reply is the triggering message', () => {
    const { name, files, precondition, testDraft, gaps } = preconditionFromTrace(payload(state()), META);

    expect(name).toBe('trace-5f2c9a10');
    expect(files).toEqual({ precondition: 'traced/trace-5f2c9a10.json', testDraft: 'drafts/trace-5f2c9a10.json' });
    expect(precondition.origin).toEqual({
      kind: 'trace', tenantId: META.tenantId, turnId: META.traceRowId, conversationId: META.conversationId, tracedAt: META.startedAt,
    });
    expect(precondition.startTime).toBe(t(10));
    expect(precondition.user).toEqual({ name: 'Sam', timezone: 'Europe/Kyiv' });
    expect(precondition.history).toEqual([
      { role: 'bot', text: 'Hi Sam, quick check-in.', minutesBeforeStart: 10, metadata: { reportingDisclosureVersion: 'v1' } },
      { role: 'employee', text: 'The team covers for each other.', minutesBeforeStart: 8 },
      { role: 'bot', text: 'That sounds supportive.', minutesBeforeStart: 7, metadata: { replyShape: { askedQuestion: true } } },
    ]);
    expect(precondition.memory).toEqual([{ category: 'work', content: 'Leads the release checklist', importance: 0.8 }]);
    expect(precondition.goals).toEqual([{ title: 'Hand over release duty', category: 'work', status: 'active', priority: 'high' }]);
    expect(precondition.onboarding).toMatchObject({ role: 'employee', introStatus: 'completed', completedAt: t(0) });
    expect(precondition.pulseCycle).toEqual({
      open: true,
      surveyWindowId: 'w-1',
      topics: [
        { group: 'autonomy', questions: [{ id: 'q-autonomy', status: 'confirmed' }], evidence: [] },
        {
          group: 'belonging',
          questions: [{ id: 'q-belonging', status: 'collecting', title: 'Belonging', canonicalMeaning: 'Feels part of the team' }],
          evidence: [{ summary: 'The team covers for each other', status: 'temporary', sourceHistoryIndexes: [1] }],
        },
      ],
      nextProbe: { questionId: 'q-belonging', focus: 'open' },
    });
    expect(testDraft).toEqual({
      schemaVersion: 1,
      title: 'DRAFT - fill expected: traced turn 5f2c9a10 of 2026-11-01',
      precondition: 'traced/trace-5f2c9a10.json',
      replies: ['Release slipped again'],
      expected: [],
      hardChecks: [],
      tags: ['from-trace'],
    });
    // Message ids and internal metadata never reach the files.
    expect(JSON.stringify({ precondition, testDraft })).not.toMatch(/m-[0-9]|decisions|sourceInboundMessageId/);
    expect(gaps).toEqual([
      expect.stringContaining('message ids'),
      expect.stringContaining('other than the next probe'),
    ]);
    expect(precondition.description).toContain('Fidelity gaps:');
  });

  it('refuses rows without captured state or without an employee message', () => {
    const noState = () => preconditionFromTrace(payload(undefined), META);
    expect(noState).toThrow(TraceExtractionError);
    expect(noState).toThrow(expect.objectContaining({ code: 'trace_state_not_captured' }));
    const empty = state();
    empty.messages![3] = { ...empty.messages![3]!, text: '' };
    expect(() => preconditionFromTrace(payload(empty, '  '), META)).toThrow(expect.objectContaining({ code: 'trace_user_message_missing' }));
  });

  it('keeps history strictly ordered before the start and names every gap', () => {
    const tied = state({
      messages: [
        { id: 'a', direction: 'outbound', text: 'One', occurredAt: t(9) },
        { id: 'b', direction: 'outbound', text: 'Two', occurredAt: t(9) },
        { id: 'c', direction: 'outbound', text: '', occurredAt: t(9) },
        { id: 'd', direction: 'inbound', text: ' Same minute ', occurredAt: t(9) },
      ],
      inboundIndex: 3,
      reportingDisclosure: null,
      pulseCapture: undefined,
      readAfterWrite: ['cycleProgress'],
      confirmation: { awaitingBundle: true },
      conversation: { userDisplayName: null, userTimezone: null, hasActiveTopic: true },
    });
    const { precondition, testDraft, gaps } = preconditionFromTrace(payload(tied), { ...META, status: 'failed' });
    const offsets = precondition.history.map((entry) => entry.minutesBeforeStart);
    expect(offsets[1]).toBeGreaterThan(0);
    expect(offsets[0]).toBeGreaterThan(offsets[1]!);
    expect(precondition.history.map((entry) => entry.text)).toEqual(['One', 'Two']);
    expect(precondition.user).toEqual({ name: 'there', timezone: 'UTC' });
    expect(testDraft.replies).toEqual(['Same minute']);
    expect(testDraft.title).toContain('(the original turn failed)');
    const text = gaps.join('\n');
    for (const fragment of ['whitespace', 'read cycleProgress only after', 'without text', 'shared a timestamp',
      'display name', 'no timezone', 'active topic', 'awaitingBundle']) {
      expect(text).toContain(fragment);
    }
  });

  it('stands in for a disclosure delivered before a full history window, and flags one from elsewhere', () => {
    const window = Array.from({ length: 19 }, (_, index) => ({
      id: `h-${index}`, direction: index % 2 ? 'inbound' as const : 'outbound' as const, text: `Message ${index}`, occurredAt: t(index + 20),
    }));
    const full = state({
      messages: [...window, { id: 'in', direction: 'inbound', text: 'Now', occurredAt: t(50) }],
      inboundIndex: 19,
      reportingDisclosure: { version: 'v1', shownAt: t(1) },
      pulseCapture: undefined,
    });
    const extracted = preconditionFromTrace(payload(full), META);
    expect(extracted.precondition.history).toHaveLength(20);
    expect(extracted.precondition.history[0]).toMatchObject({ role: 'bot', minutesBeforeStart: 49, metadata: { reportingDisclosureVersion: 'v1' } });
    expect(extracted.gaps.join('\n')).toContain('placeholder bot message');

    const partial = state({ messages: full.messages!.slice(15), inboundIndex: 4, pulseCapture: undefined });
    expect(preconditionFromTrace(payload(partial), META).gaps.join('\n')).toContain('outside this conversation');
  });

  it('leaves out a cycle that was never read, and closes one that was read as absent', () => {
    const unread = preconditionFromTrace(payload(state({ cycleProgress: undefined, nextProbe: undefined, pulseCapture: undefined })), META);
    expect(unread.precondition.pulseCycle).toBeUndefined();
    expect(unread.gaps.join('\n')).toContain('pulse cycle was not read');

    const closed = preconditionFromTrace(payload(state({ cycleProgress: null, nextProbe: null, pulseCapture: undefined })), META);
    expect(closed.precondition.pulseCycle).toEqual({ open: false, topics: [] });

    const probeOnly = preconditionFromTrace(payload(state({ cycleProgress: undefined, pulseCapture: undefined })), META);
    expect(probeOnly.precondition.pulseCycle?.topics).toEqual([
      { group: 'belonging', questions: [expect.objectContaining({ id: 'q-belonging', status: 'collecting' })], evidence: [] },
    ]);
    expect(probeOnly.gaps.join('\n')).toContain('Cycle progress was not read');
  });

  it('names the gaps of unread areas, late messages, queue delay and dropped evidence', () => {
    const late = state({
      messages: [
        { id: 'a', direction: 'outbound', text: 'After the inbound by clock skew', occurredAt: t(11) },
        { id: 'in', direction: 'inbound', text: 'Release slipped again', occurredAt: t(10) },
        { id: 'z', direction: 'inbound', text: 'A second message', occurredAt: t(10, 30) },
      ],
      inboundIndex: 1,
      reportingDisclosure: null,
      styleProfile: undefined,
      onboarding: undefined,
      cycleProgress: undefined,
      nextProbe: null,
    });
    const { precondition, gaps } = preconditionFromTrace(payload(late), { ...META, startedAt: t(30) });
    expect(precondition.history[0]!.minutesBeforeStart).toBeGreaterThan(0);
    expect(precondition.pulseCycle).toBeUndefined();
    const text = gaps.join('\n');
    for (const fragment of ['after the employee message were left out', 'timestamped after the employee message',
      'ran 20 min after', 'style profile was not read', 'Onboarding was not read', 'whether a cycle was open is unknown',
      'no open cycle holds it']) {
      expect(text).toContain(fragment);
    }
  });

  it('refuses a state section it cannot read instead of throwing', () => {
    const broken = state();
    (broken.messages![1] as unknown as Record<string, unknown>)['occurredAt'] = 'not a date';
    expect(() => preconditionFromTrace(payload(broken), META)).toThrow(expect.objectContaining({ code: 'trace_state_not_captured' }));
    const badIndex = state({ inboundIndex: 1.5 });
    expect(() => preconditionFromTrace(payload(badIndex), META)).toThrow(expect.objectContaining({ code: 'trace_state_not_captured' }));
    const badMemory = state({ memory: [{ category: 'work' } as never] });
    expect(() => preconditionFromTrace(payload(badMemory), META)).toThrow(expect.objectContaining({ code: 'trace_state_not_captured' }));
  });

  it('names files after the row id only', () => {
    expect(traceExtractionName('ABCDEF12-3456-4000-8000-000000000000')).toBe('trace-abcdef12');
    expect(traceExtractionName('../../etc')).toBe('trace-ec');
  });
});
