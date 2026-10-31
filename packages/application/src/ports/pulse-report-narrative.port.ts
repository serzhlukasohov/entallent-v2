import type { PulseNarrativeRequest, PulseLabels } from '@entalent/contracts';
/** Each method is exactly one transport request. The application owns the repair bound. */
export interface PulseReportNarrativePort {
  draft(input: PulseNarrativeRequest, corrections: readonly string[]): Promise<unknown>;
  review(input: PulseNarrativeRequest, draft: unknown): Promise<unknown>;
  localize(locale: string, meanings: PulseLabels, corrections: readonly string[]): Promise<unknown>;
  reviewLabels(locale: string, meanings: PulseLabels, draft: unknown): Promise<unknown>;
}
