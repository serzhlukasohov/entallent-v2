export type FailureKind = 'none' | 'product' | 'infrastructure';

export function classifyFailure(input: {
  exitCode: number | null;
  output: string;
  reportCount: number;
}): FailureKind {
  if (input.exitCode === 0 && input.reportCount > 0) return 'none';
  if (input.reportCount > 0 || /\bAssertionError\b/.test(input.output)) return 'product';
  return looksLikeTransportFailure(input.output) ? 'infrastructure' : 'product';
}

function looksLikeTransportFailure(output: string): boolean {
  return /(?:\b(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)\b|fetch failed|network (?:error|failure)|request (?:timeout|timed out)|\bTimeoutError\b|rate limit|HTTP(?: status)?\s+(?:429|5\d\d)\b|429 Too Many Requests|Bad Gateway|Service Unavailable)/i.test(
    output,
  );
}
