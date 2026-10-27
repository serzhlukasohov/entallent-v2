import { describe, expect, it } from 'vitest';
import { atomic, criterion, journey, runFor } from '../__fixtures__/evaluation';
import { buildJudgeInput, fixtureContext } from './judge-input';

const MEANING = [{ type: 'meaning' as const }];

describe('buildJudgeInput', () => {
  it('builds an atomic transcript from the seed history plus the single turn', () => {
    const c1 = criterion({ id: 'X-01.C1', checks: MEANING, judgeGuidance: 'Guidance.', layer: 'C', passCondition: 'Verbatim.' });
    const test = atomic([c1], {
      expectedBehavior: 'Expected.',
      seed: {
        history: [
          { role: 'user', text: 'Seeded user.', atOffsetMs: 120_000 },
          { role: 'coach', text: 'Seeded coach.', atOffsetMs: 60_000 },
        ],
      },
    });
    const built = buildJudgeInput(test, runFor(test, ['The reply.']), c1);
    expect(built).toEqual({
      input: {
        transcript: {
          turns: [
            { role: 'user', text: 'Seeded user.' },
            { role: 'coach', text: 'Seeded coach.' },
            { role: 'user', text: 'user message 1' },
            { role: 'coach', text: 'The reply.' },
          ],
          evaluatedReplyIndex: 3,
        },
        expectedBehavior: 'Expected.',
        passCondition: 'Verbatim.',
        judgeGuidance: 'Guidance.',
        layer: 'C',
        fixtureContext: null,
      },
      replyTexts: ['The reply.'],
    });
  });

  it('covers steps 1..n of a journey for reply:<n> and after-step:<n>, skipping silent steps', () => {
    const atReply = criterion({ id: 'X-01.C1', evaluatedAt: 'reply:3', checks: MEANING });
    const afterStep = criterion({ id: 'X-01.C2', evaluatedAt: 'after-step:2', checks: MEANING });
    const test = journey(4, [atReply, afterStep], { expectedBehavior: 'E.' });
    const run = runFor(test, ['one', null, 'three', 'four']);

    const reply3 = buildJudgeInput(test, run, atReply);
    expect(reply3.input.transcript).toEqual({
      turns: [
        { role: 'user', text: 'user message 1' },
        { role: 'coach', text: 'one' },
        { role: 'user', text: 'user message 2' },
        { role: 'user', text: 'user message 3' },
        { role: 'coach', text: 'three' },
      ],
      evaluatedReplyIndex: 4,
    });
    expect(reply3.replyTexts).toEqual(['three']);
    expect(reply3.input.judgeGuidance).toBeNull();

    const step2 = buildJudgeInput(test, run, afterStep);
    expect(step2.input.transcript.turns).toHaveLength(3);
    expect(step2.input.transcript.evaluatedReplyIndex).toBeNull();
    expect(step2.replyTexts).toEqual([]);
  });

  it('passes the whole transcript for conversation criteria and offers every run coach reply, not seed turns', () => {
    const c1 = criterion({ id: 'X-01.C1', evaluatedAt: 'conversation', checks: MEANING });
    const test = journey(3, [c1], { expectedBehavior: 'E.' });
    const built = buildJudgeInput(test, runFor(test, ['a', null, 'c']), c1);
    expect(built.input.transcript.evaluatedReplyIndex).toBeNull();
    expect(built.input.transcript.turns.map((turn) => turn.text)).toEqual(['user message 1', 'a', 'user message 2', 'user message 3', 'c']);
    expect(built.replyTexts).toEqual(['a', 'c']);

    const seeded = atomic([c1], { expectedBehavior: 'E.', seed: { history: [{ role: 'coach', text: 'Seeded.', atOffsetMs: 0 }] } });
    expect(buildJudgeInput(seeded, runFor(seeded, ['r']), c1).replyTexts).toEqual(['r']);
  });

  it('throws without expectedBehavior and for state or observation-window criteria', () => {
    const c1 = criterion({ id: 'X-01.C1', checks: MEANING });
    const test = atomic([c1]);
    expect(() => buildJudgeInput(test, runFor(test, ['r']), c1)).toThrow(/\[suite\].*expectedBehavior/);
    const state = criterion({ id: 'X-01.C2', evaluatedAt: 'state', checks: MEANING });
    expect(() => buildJudgeInput({ ...test, expectedBehavior: 'E.' }, runFor(test, ['r']), state)).toThrow(/does not support/);
  });
});

describe('fixtureContext', () => {
  const topics = [{ topic: 'workload', canonicalQuestions: ['How is your workload?', 'What takes most time?'] }];

  it('carries the pulseCycle uncovered topics and ignores other params', () => {
    const context = fixtureContext({ setup: [{ name: 'pulseCycle', params: { uncoveredTopics: topics, cycleId: 'c-1' } }] });
    expect(context).toEqual({ pulseCycle: { uncoveredTopics: topics } });
  });

  it('is null without a pulseCycle fixture or when uncoveredTopics does not parse', () => {
    expect(fixtureContext({ setup: [{ name: 'clock' }] })).toBeNull();
    expect(fixtureContext({ setup: [{ name: 'pulseCycle' }] })).toBeNull();
    expect(fixtureContext({ setup: [{ name: 'pulseCycle', params: { uncoveredTopics: [{ topic: 1 }] } }] })).toBeNull();
  });

  it('reaches the judge input', () => {
    const c1 = criterion({ id: 'X-01.C1', checks: MEANING });
    const test = atomic([c1], { expectedBehavior: 'E.', setup: [{ name: 'pulseCycle', params: { uncoveredTopics: topics } }] });
    expect(buildJudgeInput(test, runFor(test, ['r']), c1).input.fixtureContext).toEqual({ pulseCycle: { uncoveredTopics: topics } });
  });
});
