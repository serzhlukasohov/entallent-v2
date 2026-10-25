import { TEST_RULES } from '../../__fixtures__/suite';
import { validateSuite } from '../../loader';
import type { Label, LabelTurn, LoadedSuite } from '../../schema';
import type { CriterionJudge, JudgeInput, MeaningOutcome } from '../criterion-judge';

/** Synthetic calibration suites, labels, QA exports and fake judges (no model, no network). */

export const UNCOVERED = [{ topic: 'workload', canonicalQuestions: ['How is your workload?'] }];

export const REPLY = 'Which deadline is first?';

export type ContextConflict = 'guidance' | 'fixture' | 'scope';

/**
 * `Y-01.A1` (atomic, L1, `pulseCycle` fixture): C1 (P) at reply:1, C2 (D) at reply:1 with
 * guidance, C3 (S) at conversation, C4 (C) NOT TESTABLE, C5 (P) rule-only, C6 (C) at
 * after-step:1. `conflict` adds `Y-01.J`, judging C2 with only that one field different.
 */
export function calibrationSuite(options: { id?: string; conflict?: ContextConflict } = {}): LoadedSuite {
  const sources = [
    {
      id: 'Y-01',
      requirement: ['REQ-1'],
      kind: 'conversation',
      expectedBehavior: 'The coach asks one focused question.',
      criteria: [
        { id: 'Y-01.C1', layer: 'P', passCondition: 'The reply asks one question.' },
        { id: 'Y-01.C2', layer: 'D', passCondition: 'The question is about priorities.' },
        { id: 'Y-01.C3', layer: 'S', passCondition: 'The coach never repeats itself.' },
        { id: 'Y-01.C4', layer: 'C', passCondition: 'The opening feels natural.', notTestableReason: 'subjective opening' },
        { id: 'Y-01.C5', layer: 'P', passCondition: 'The coach replies.' },
        { id: 'Y-01.C6', layer: 'C', passCondition: 'After the turn the coach has asked about the week.' },
      ],
    },
  ];
  const tests: Array<Record<string, unknown>> = [
    {
      id: 'Y-01.A1',
      sourceCase: 'Y-01',
      requirement: ['REQ-1'],
      kind: 'atomic',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [{ name: 'pulseCycle', params: { uncoveredTopics: UNCOVERED } }],
      seed: {
        history: [
          { role: 'coach', text: 'Morning. How is the week going?', atOffsetMs: 120_000 },
          { role: 'user', text: 'Busy.', atOffsetMs: 60_000 },
        ],
      },
      preconditions: [],
      steps: [{ text: 'Two releases this week.' }],
      criteria: [
        { id: 'Y-01.C1', evaluatedAt: 'reply:1', checks: [{ type: 'meaning' }] },
        { id: 'Y-01.C2', evaluatedAt: 'reply:1', checks: [{ type: 'meaning' }], judgeGuidance: 'Deadlines count as priorities.' },
        { id: 'Y-01.C3', evaluatedAt: 'conversation', checks: [{ type: 'meaning' }] },
        { id: 'Y-01.C5', evaluatedAt: 'reply:1', checks: [{ type: 'rule', rule: 'reply-present' }] },
        { id: 'Y-01.C6', evaluatedAt: 'after-step:1', checks: [{ type: 'meaning' }] },
      ],
    },
  ];
  if (options.conflict) {
    const conflict = options.conflict;
    tests.push({
      id: 'Y-01.J',
      sourceCase: 'Y-01',
      requirement: ['REQ-1'],
      kind: 'journey',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: conflict === 'fixture' ? [] : [{ name: 'pulseCycle', params: { uncoveredTopics: UNCOVERED } }],
      preconditions: [],
      steps: [{ text: 'Hi.' }],
      criteria: [
        {
          id: 'Y-01.C2',
          evaluatedAt: conflict === 'scope' ? 'conversation' : 'reply:1',
          checks: [{ type: 'meaning' }],
          judgeGuidance: conflict === 'guidance' ? 'Other guidance.' : 'Deadlines count as priorities.',
        },
      ],
    });
  }
  return validateSuite(options.id ?? 'y-suite', { sources, tests }, TEST_RULES);
}

export const DIALOGUE: LabelTurn[] = [
  { role: 'coach', text: 'Morning. How is the week going?' },
  { role: 'user', text: 'Busy.' },
  { role: 'user', text: 'Two releases this week.' },
  { role: 'coach', text: REPLY },
  { role: 'user', text: 'The API one.' },
  { role: 'coach', text: 'Good. What would make it easier?' },
];

export function label(overrides: Partial<Label> & Pick<Label, 'criterionId' | 'status'>): Label {
  return {
    transcript: { turns: DIALOGUE.slice(0, 4), evaluatedReplyIndex: 3 },
    source: { kind: 'qa-session', ref: 'qa-1' },
    labeler: 'qa-anna',
    labeledAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

export interface ExportStatus {
  criterionId: string;
  status: 'PASS' | 'FAIL';
  replyIndex: number | null;
}

export function qaExport(sessions: Array<{ ref: string; dialogue?: LabelTurn[]; statuses: ExportStatus[] }>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    sessions: sessions.map((session) => ({
      ref: session.ref,
      labeler: 'qa-anna',
      labeledAt: '2026-10-20T09:00:00.000Z',
      dialogue: session.dialogue ?? DIALOGUE,
      statuses: session.statuses,
    })),
  };
}

export interface FakeJudge {
  judge: CriterionJudge;
  inputs: JudgeInput[];
}

const USAGE = { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/**
 * A judge that answers by `decide(input)`: a status with evidence copied from the evaluated
 * reply (or the first coach turn for conversation inputs), or `'reject'` to throw.
 */
export function fakeJudge(decide: (input: JudgeInput) => 'PASS' | 'FAIL' | 'reject'): FakeJudge {
  const inputs: JudgeInput[] = [];
  const judge: CriterionJudge = async (input) => {
    inputs.push(input);
    const status = decide(input);
    if (status === 'reject') throw new Error('socket hang up');
    const { turns, evaluatedReplyIndex } = input.transcript;
    const reply = evaluatedReplyIndex === null ? turns.find((turn) => turn.role === 'coach')!.text : turns[evaluatedReplyIndex]!.text;
    const outcome: MeaningOutcome = { status, reason: `judged ${status}`, evidence: reply, usage: USAGE };
    return outcome;
  };
  return { judge, inputs };
}
