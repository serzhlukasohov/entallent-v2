import type { ScenarioRunReport } from '../harness/report';

export type FailureKind = 'none' | 'product' | 'infrastructure';

export function classifyFailure(input: {
  exitCode: number | null;
  output: string;
  reportCount: number;
  reports?: ScenarioRunReport[];
}): FailureKind {
  if (hasDeterministicFailure(input.reports ?? [])) return 'product';
  if (input.exitCode === 0 && input.reportCount > 0) return 'none';
  if (input.reportCount > 0 || /\bAssertionError\b/.test(input.output)) return 'product';
  return looksLikeTransportFailure(input.output) ? 'infrastructure' : 'product';
}

function looksLikeTransportFailure(output: string): boolean {
  return /(?:\b(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b|fetch failed|network (?:error|failure)|request (?:timeout|timed out)|\bTimeoutError\b|rate limit|HTTP(?: status)?\s+(?:429|5\d\d)\b|429 Too Many Requests|Bad Gateway|Service Unavailable)/i.test(
    output,
  );
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
