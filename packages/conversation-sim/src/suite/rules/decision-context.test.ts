import { describe, expect, it } from 'vitest';
import { RULES } from './registry';

const at = { id: 'X-01.E1', evaluatedAt: 'after-step:1' };

describe('turn-decision', () => {
  const rule = RULES['turn-decision'];
  const { pass } = rule.fixtures;

  it('treats an unassessed risk as survey-blocked and never as safe', () => {
    const run = {
      ...pass,
      steps: pass.steps.map((step) => ({
        ...step,
        turn: { ...step.turn!, risk: { assessed: false, severity: 'unknown', riskType: null, immediateResponseRequired: false, tripwireRaised: false, unassessedReason: 'assessment_failed' } },
      })),
    };
    expect(rule.run(run, at, { step: 1, expect: [{ field: 'risk.surveyBlocked', in: [false] }] })).toMatchObject({
      status: 'FAIL',
      evidence: 'turn 1: risk.surveyBlocked=true (expected false)',
    });
    expect(rule.run(run, at, { step: 1, expect: [{ field: 'risk.severity', in: ['none', 'low'] }] }).status).toBe('FAIL');
  });

  it('reads a survey question from the reply metadata and escalation from the risk', () => {
    const run = {
      ...pass,
      steps: pass.steps.map((step) => ({
        ...step,
        reply: { ...step.reply!, messages: step.reply!.messages.map((message) => ({ ...message, metadata: { containsSurveyProbe: true } })) },
      })),
    };
    expect(rule.run(run, at, { step: 1, expect: [{ field: 'reply.surveyQuestion', in: [true] }, { field: 'risk.escalates', in: [false] }] })).toEqual({ status: 'PASS' });
  });

  it('is NOT_OBSERVABLE when the decision was not recorded or the step was not reached', () => {
    const bare = { ...pass, steps: pass.steps.map((step) => ({ ...step, turn: { mode: 'normal' } })) };
    expect(rule.run(bare, at, { step: 1, expect: [{ field: 'risk.severity', in: ['none'] }] })).toEqual({
      status: 'NOT_OBSERVABLE',
      evidence: 'decision-not-recorded:risk.severity@1',
    });
    expect(rule.run(pass, at, { step: 2, expect: [{ field: 'mode', in: ['normal'] }] })).toEqual({ status: 'NOT_OBSERVABLE', evidence: 'step-not-reached:2' });
  });

  it('rejects an expectation with both or neither of in and notIn', () => {
    expect(rule.params!.safeParse({ step: 1, expect: [{ field: 'mode', in: ['a'], notIn: ['b'] }] }).success).toBe(false);
    expect(rule.params!.safeParse({ step: 1, expect: [{ field: 'mode' }] }).success).toBe(false);
  });
});

describe('model-context', () => {
  const rule = RULES['model-context'];
  const { pass } = rule.fixtures;

  it('checks counts, roles, categories, time, survey question and sections, listing every miss', () => {
    const outcome = rule.run(pass, at, {
      step: 1,
      expect: {
        historyTurns: { min: 4 },
        lastRole: 'assistant',
        memoryCategories: ['goal'],
        localTimeIncludes: '22:30',
        surveyQuestion: true,
        sectionsInclude: ['trailingBundle'],
      },
    });
    expect(outcome.status).toBe('FAIL');
    expect(outcome.evidence).toBe(
      'context@1 (last): history=3 (expected >= 4); history.lastRole=user (expected assistant); memory.categories lacks goal; localTime=unset (expected 22:30); surveyQuestion=none (expected present); sections lacks trailingBundle',
    );
  });

  it('picks the first or last reply-model call of the step', () => {
    const [event] = pass.events;
    const run = { ...pass, events: [event!, { ...event!, seq: 1, context: { ...event!.context!, history: { ...event!.context!.history, turns: 7 } } }] };
    expect(rule.run(run, at, { step: 1, call: 'first', expect: { historyTurns: 3 } })).toEqual({ status: 'PASS' });
    expect(rule.run(run, at, { step: 1, expect: { historyTurns: 7 } })).toEqual({ status: 'PASS' });
  });

  it('FAILs a reached step that made no reply-model call', () => {
    expect(rule.run({ ...pass, events: [] }, at, { step: 1, expect: { historyTurns: 1 } })).toEqual({
      status: 'FAIL',
      evidence: 'no reply-model call@1',
    });
  });
});
