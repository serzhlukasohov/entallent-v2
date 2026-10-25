import { describe, expect, it } from 'vitest';
import { noInternalTerms } from './no-internal-terms';
import { syntheticRun } from './synthetic-run';
import { INTERNAL_TERMS } from './terms/internal-terms';

const at = (evaluatedAt: string) => ({ id: 'X-01.C1', evaluatedAt });
const check = (text: string) => noInternalTerms.run(syntheticRun('X-01.A1', [text]), at('reply:1'));

describe('no-internal-terms', () => {
  it('is frozen data', () => {
    expect(Object.isFrozen(INTERNAL_TERMS)).toBe(true);
  });

  it('PASSes a reply without internal vocabulary, including words that only contain a term', () => {
    expect(check('Your bicycle commute and the indexed docs are fine. What else?')).toEqual({ status: 'PASS' });
    expect(check('Let us talk about the pulsed laser topical cream.')).toEqual({ status: 'PASS' });
  });

  it.each([
    ['Next TOPIC: workload.', 'topic'],
    ['Two topics left.', 'topics'],
    ['Your engagement index dropped.', 'index'],
    ['Both indexes moved.', 'indexes'],
    ['This pulse closes Friday.', 'pulse'],
    ['Pulses run weekly.', 'pulses'],
    ['This cycle ends soon.', 'cycle'],
    ['Over two cycles you improved.', 'cycles'],
  ])('FAILs on "%s" naming %s', (text, term) => {
    expect(check(text)).toEqual({ status: 'FAIL', evidence: `turn 1 — internal terms: ${term}` });
  });

  it.each([
    ["Next 'topic': workload.", 'topic'],
    ['Next "topic": workload.', 'topic'],
    ['The \u2018pulse\u2019 closes Friday.', 'pulse'],
    ['The \u201ccycle\u201d ends soon.', 'cycle'],
  ])('FAILs on a quoted term in "%s"', (text, term) => {
    expect(check(text)).toEqual({ status: 'FAIL', evidence: `turn 1 — internal terms: ${term}` });
  });

  it('does not match a term glued to a word by an apostrophe', () => {
    expect(check("Rock'n'pulse night was fun.")).toEqual({ status: 'PASS' });
  });

  it('lists every term found', () => {
    expect(check('The pulse cycle has three topics.')).toEqual({
      status: 'FAIL',
      evidence: 'turn 1 — internal terms: topics, pulse, cycle',
    });
  });

  it('is NOT_OBSERVABLE for a state criterion', () => {
    expect(noInternalTerms.run(syntheticRun('X-01.A1', ['topic']), at('state')).status).toBe('NOT_OBSERVABLE');
  });
});
