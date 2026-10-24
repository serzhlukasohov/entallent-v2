import { hasReflectiveOpener } from '@entalent/ai-openai';
import { describe, expect, it } from 'vitest';
import { CaseRunSchema } from '../schema';
import { RULES, RULE_NAMES, RuleNameSchema } from './registry';
import { syntheticRun } from './synthetic-run';

const lastReply = (steps: number): string => `reply:${steps}`;

describe('rule registry', () => {
  it('names the three wrapped legacy rules', () => {
    expect([...RULE_NAMES].sort()).toEqual(['reflective-opener', 'repeated-question', 'too-many-questions']);
    expect(RuleNameSchema.safeParse('too-many-questions').success).toBe(true);
    expect(RuleNameSchema.safeParse('single-question').success).toBe(false);
  });

  describe.each(RULE_NAMES.map((name) => [name, RULES[name]] as const))('%s', (name, entry) => {
    it('ships schema-valid pass and fail fixtures', () => {
      expect(CaseRunSchema.safeParse(entry.fixtures.pass).success).toBe(true);
      expect(CaseRunSchema.safeParse(entry.fixtures.fail).success).toBe(true);
    });

    it.each(['conversation', 'last-reply'])('FAILs on its fail fixture and PASSes on its pass fixture (%s)', (scope) => {
      const at = (steps: number) => (scope === 'conversation' ? 'conversation' : lastReply(steps));
      const { pass, fail } = entry.fixtures;
      const failed = entry.run(fail, { id: 'X-01.C1', evaluatedAt: at(fail.steps.length) });
      expect(failed.status).toBe('FAIL');
      expect(failed.evidence).toMatch(new RegExp(`^turn ${fail.steps.length} — `));
      expect(entry.run(pass, { id: 'X-01.C1', evaluatedAt: at(pass.steps.length) })).toEqual({ status: 'PASS' });
    });

    it('is NOT_OBSERVABLE when reply.text is not declared', () => {
      const run = { ...entry.fixtures.fail, observed: ['events' as const] };
      expect(entry.run(run, { id: 'X-01.C1', evaluatedAt: 'conversation' })).toEqual({
        status: 'NOT_OBSERVABLE',
        evidence: 'unobservable:reply.text@L0',
      });
    });

    it.each(['state', 'observation-window'])('is NOT_OBSERVABLE for a %s criterion', (evaluatedAt) => {
      expect(entry.run(entry.fixtures.fail, { id: 'X-01.C1', evaluatedAt }).status).toBe('NOT_OBSERVABLE');
    });

    it('FAILs a null reply at reply:<n>', () => {
      const run = syntheticRun(`${name}-silent`, ['Fine.', null]);
      expect(entry.run(run, { id: 'X-01.C1', evaluatedAt: 'reply:2' })).toEqual({
        status: 'FAIL',
        evidence: 'no-reply (turn 2)',
      });
    });

    it.each([
      ['all silent', [null, null]],
      ['zero steps', []],
    ] as const)('is NOT_OBSERVABLE no-replies in conversation scope when %s', (_label, replies) => {
      const run = syntheticRun(`${name}-no-replies`, replies);
      expect(entry.run(run, { id: 'X-01.C1', evaluatedAt: 'conversation' })).toEqual({
        status: 'NOT_OBSERVABLE',
        evidence: 'no-replies',
      });
    });

    it('is NOT_OBSERVABLE for a step that was not reached', () => {
      const run = syntheticRun(`${name}-short`, ['Fine.']);
      expect(entry.run(run, { id: 'X-01.C1', evaluatedAt: 'reply:3' })).toEqual({
        status: 'NOT_OBSERVABLE',
        evidence: 'step-not-reached:3',
      });
    });
  });

  it('checks every reply in conversation scope and skips observed silence', () => {
    const run = syntheticRun('X-01.J', [
      'One question?',
      null,
      'First? Second?',
      'Sounds like a lot. Where to start?',
    ]);
    expect(RULES['too-many-questions'].run(run, { id: 'X-01.C1', evaluatedAt: 'conversation' })).toEqual({
      status: 'FAIL',
      evidence: 'turn 3 — First? / Second?',
    });
    expect(RULES['reflective-opener'].run(run, { id: 'X-01.C1', evaluatedAt: 'conversation' })).toEqual({
      status: 'FAIL',
      evidence: 'turn 4 — Sounds like a lot.',
    });
    expect(RULES['too-many-questions'].run(run, { id: 'X-01.C1', evaluatedAt: 'reply:1' }).status).toBe('PASS');
  });

  it('flags a repeated question only on the selected reply', () => {
    const run = syntheticRun('X-01.J', [
      'What is taking most of your time right now?',
      'What is taking most of your time right now?',
      'Which deadline comes first this week?',
    ]);
    const rule = RULES['repeated-question'];
    expect(rule.run(run, { id: 'X-01.C1', evaluatedAt: 'reply:2' })).toEqual({
      status: 'FAIL',
      evidence: 'turn 2 — What is taking most of your time right now? (already asked on turn 1)',
    });
    expect(rule.run(run, { id: 'X-01.C1', evaluatedAt: 'reply:3' })).toEqual({ status: 'PASS' });
    expect(rule.run(run, { id: 'X-01.C1', evaluatedAt: 'after-step:1' })).toEqual({ status: 'PASS' });
  });

  it('keeps repeated-question turn numbers aligned across silent steps', () => {
    const q = 'What is taking most of your time right now?';
    const run = syntheticRun('X-01.J', [q, null, q]);
    const expected = { status: 'FAIL', evidence: `turn 3 — ${q} (already asked on turn 1)` };
    expect(RULES['repeated-question'].run(run, { id: 'X-01.C1', evaluatedAt: 'conversation' })).toEqual(expected);
    expect(RULES['repeated-question'].run(run, { id: 'X-01.C1', evaluatedAt: 'reply:3' })).toEqual(expected);
  });

  it('delegates reflective-opener to the product-shared definition', () => {
    const text = RULES['reflective-opener'].fixtures.fail.steps[0]!.reply!.text;
    expect(hasReflectiveOpener(text)).toBe(true);
  });
});
