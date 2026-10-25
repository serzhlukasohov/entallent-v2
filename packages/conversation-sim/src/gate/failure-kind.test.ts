import { describe, expect, it } from 'vitest';
import type { ScenarioRunReport } from '../harness/report';
import * as classifier from './failure-classifier';
import { hasDeterministicFailure, isTransportFailureMessage, isTransportOnlyAgentFailure } from './failure-kind';

function report(violations: Array<{ rule: string; detail: string }>): ScenarioRunReport {
  return {
    deterministic: { passed: violations.length === 0, violations: violations.map((violation) => ({ turn: 1, ...violation })) },
  } as ScenarioRunReport;
}

describe('isTransportFailureMessage', () => {
  it.each([
    'Error: read ECONNRESET',
    'getaddrinfo ENOTFOUND api.openai.com',
    'TypeError: fetch failed',
    'request timed out after 30s',
    'TimeoutError: aborted',
    'HTTP status 503',
    '429 Too Many Requests',
    'Bad Gateway',
  ])('treats %j as transport', (message) => {
    expect(isTransportFailureMessage(message)).toBe(true);
  });

  it.each(['TypeError: cannot read properties of undefined', 'scripted-output-missing:1', ''])('treats %j as product', (message) => {
    expect(isTransportFailureMessage(message)).toBe(false);
  });
});

describe('isTransportOnlyAgentFailure and hasDeterministicFailure', () => {
  it('is true only when every failed report has transport agent errors beside test-failure', () => {
    const transport = report([
      { rule: 'agent-turn-error', detail: 'Error: read ECONNRESET' },
      { rule: 'test-failure', detail: 'x' },
    ]);
    expect(isTransportOnlyAgentFailure([transport, report([])])).toBe(true);
    expect(isTransportOnlyAgentFailure([report([{ rule: 'agent-turn-error', detail: 'TypeError: x' }])])).toBe(false);
    expect(isTransportOnlyAgentFailure([report([{ rule: 'too-many-questions', detail: '3' }])])).toBe(false);
    expect(hasDeterministicFailure([report([])])).toBe(false);
    expect(hasDeterministicFailure([report([]), transport])).toBe(true);
  });

  it('stays importable from failure-classifier', () => {
    expect(classifier.hasDeterministicFailure).toBe(hasDeterministicFailure);
  });
});
