import { describe, expect, it } from 'vitest';
import type { SeedTurn } from '../schema';
import { noTwoRepliesWithoutCauseQuestion as rule } from './no-two-replies-without-cause-question';
import { syntheticRun } from './synthetic-run';

const at = (evaluatedAt: string) => ({ id: 'P-08.C1', evaluatedAt });
const seed = (...turns: Array<[SeedTurn['role'], string]>): { seedHistory: SeedTurn[] } => ({
  seedHistory: turns.map(([role, text], position) => ({ role, text, atOffsetMs: (turns.length - position) * 60_000 })),
});

describe('no-two-replies-without-cause-question', () => {
  const atomic = syntheticRun('P-08.A1', ['That sounds exhausting, keep going.']);

  it('FAILs at turn 1 when the seeded coach reply and the new reply both lack a question (P-08 atomic)', () => {
    const context = seed(['user', 'Work is crushing me.'], ['coach', 'That sounds really hard.'], ['user', 'It is.']);
    expect(rule.run(atomic, at('reply:1'), undefined, context)).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — no question in this reply or the previous one (seeded coach turn 1)',
    });
  });

  it('PASSes when the seeded coach reply asked a question', () => {
    const context = seed(['coach', 'What is making it so hard?'], ['user', 'Deadlines.']);
    expect(rule.run(atomic, at('reply:1'), undefined, context)).toEqual({ status: 'PASS' });
  });

  it('PASSes when the new reply asks a question', () => {
    const run = syntheticRun('P-08.A1', ['That sounds exhausting. What drains you most?']);
    expect(rule.run(run, at('reply:1'), undefined, seed(['coach', 'That sounds really hard.']))).toEqual({ status: 'PASS' });
  });

  it('is NOT_OBSERVABLE fewer-than-two-replies without context', () => {
    expect(rule.run(atomic, at('reply:1'))).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'fewer-than-two-replies' });
  });

  it('is NOT_OBSERVABLE fewer-than-two-replies when the seed has only user turns', () => {
    expect(rule.run(atomic, at('reply:1'), undefined, seed(['user', 'Hello.']))).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'fewer-than-two-replies',
    });
  });

  it('reports the first failing pair in conversation scope and skips observed silence', () => {
    const run = syntheticRun('P-08.J', ['What happened?', 'I see.', null, 'Noted.', 'Okay.']);
    expect(rule.run(run, at('conversation'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 4 — no question in this reply or the previous one (turn 2)',
    });
  });

  it('judges only the pair that ends on the selected reply', () => {
    const run = syntheticRun('P-08.J', ['I see.', 'Noted.', 'What happened next?']);
    expect(rule.run(run, at('reply:2'))).toEqual({
      status: 'FAIL',
      evidence: 'turn 2 — no question in this reply or the previous one (turn 1)',
    });
    expect(rule.run(run, at('reply:3'))).toEqual({ status: 'PASS' });
  });
});
