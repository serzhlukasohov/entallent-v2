import type { ScenarioRunReport } from '../harness/report';

export type FailureKind = 'none' | 'product' | 'infrastructure';

export function classifyFailure(input: {
  exitCode: number | null;
  output: string;
  reportCount: number;
  reports?: ScenarioRunReport[];
}): FailureKind {
  const reports = input.reports ?? [];
  if (hasDeterministicFailure(reports)) {
    return isTransportOnlyAgentFailure(reports) ? 'infrastructure' : 'product';
  }
  if (input.exitCode === 0 && input.reportCount > 0) return 'none';
  if (input.reportCount > 0 || /\bAssertionError\b/.test(input.output)) return 'product';
  return looksLikeTransportFailure(input.output) ? 'infrastructure' : 'product';
}

function looksLikeTransportFailure(output: string): boolean {
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
function isTransportOnlyAgentFailure(reports: ScenarioRunReport[]): boolean {
  const failed = reports.filter(
    (report) => !report.deterministic.passed || report.deterministic.violations.length > 0,
  );
  return failed.every((report) => {
    const agentErrors = report.deterministic.violations.filter((violation) => violation.rule === 'agent-turn-error');
    if (agentErrors.length === 0) return false;
    return report.deterministic.violations.every(
      (violation) =>
        (violation.rule === 'agent-turn-error' && looksLikeTransportFailure(violation.detail)) ||
        violation.rule === 'test-failure',
    );
  });
}

export function hasDeterministicFailure(reports: ScenarioRunReport[]): boolean {
  return reports.some((report) => !report.deterministic.passed || report.deterministic.violations.length > 0);
}

export function buildFailureReason(
  exitCode: number | null,
  output: string,
  reports: ScenarioRunReport[],
): string | null {
  if (hasDeterministicFailure(reports)) {
    return reports.filter((report) => !report.deterministic.passed || report.deterministic.violations.length > 0)
      .map((report) => `${report.scenarioName}: deterministic checks failed${report.deterministic.violations.length > 0
        ? ` (${report.deterministic.violations.map((violation) => `turn ${violation.turn} ${violation.rule}: ${violation.detail}`).join('; ')})` : ''}`)
      .join('; ');
  }
  if (exitCode === 0 && reports.length > 0) return null;
  if (reports.length === 0) {
    return 'Vitest produced no scenario JSON report. See the sample log for the subprocess output.';
  }
  const assertionLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('AssertionError'));
  if (assertionLine) return assertionLine;

  const failLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes('FAIL  src/'));
  return failLine ?? `Vitest exited with code ${exitCode ?? 'unknown'}.`;
}
