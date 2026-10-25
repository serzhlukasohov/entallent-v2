import type { ScenarioRunReport } from '../harness/report';

/**
 * Pure failure-kind predicates shared by the sim gate (`failure-classifier.ts`) and the
 * suite runner (architecture AD-12, item 4). No I/O and no Vitest.
 */

/** A message or output that names a transport failure (network, timeout, rate limit, 5xx). */
export function isTransportFailureMessage(output: string): boolean {
  return /(?:\b(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b|fetch failed|network (?:error|failure)|request (?:timeout|timed out)|\bTimeoutError\b|rate limit|HTTP(?: status)?\s+(?:429|5\d\d)\b|429 Too Many Requests|Bad Gateway|Service Unavailable)/i.test(
    output,
  );
}

/**
 * An `agent-turn-error` is a hard failure: the orchestrator threw, so the sample is evidence
 * about the product, not a flaky sample. The one exception is a turn whose recorded error is
 * itself a transport failure (the same classifier used for report-free output), with nothing
 * but the propagated Vitest `test-failure` beside it; that sample is retried as infrastructure.
 */
export function isTransportOnlyAgentFailure(reports: ScenarioRunReport[]): boolean {
  const failed = reports.filter(
    (report) => !report.deterministic.passed || report.deterministic.violations.length > 0,
  );
  return failed.every((report) => {
    const agentErrors = report.deterministic.violations.filter((violation) => violation.rule === 'agent-turn-error');
    if (agentErrors.length === 0) return false;
    return report.deterministic.violations.every(
      (violation) =>
        (violation.rule === 'agent-turn-error' && isTransportFailureMessage(violation.detail)) ||
        violation.rule === 'test-failure',
    );
  });
}

export function hasDeterministicFailure(reports: ScenarioRunReport[]): boolean {
  return reports.some((report) => !report.deterministic.passed || report.deterministic.violations.length > 0);
}
