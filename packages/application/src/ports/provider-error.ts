import type { ModerationSignal } from '@entalent/contracts';

export type ProviderContentFilterDirection = 'input' | 'output';

/** A provider-confirmed policy rejection. Contains no prompt or completion text. */
export class ProviderContentFilterError extends Error {
  readonly code = 'content_filter' as const;

  /**
   * Bounded moderation categories the provider reported (never text), so a safety
   * tripwire can still raise severity after the error is normalized (ADR-013 R1).
   */
  constructor(
    readonly direction: ProviderContentFilterDirection,
    readonly categories: ReadonlyArray<ModerationSignal['categories'][number]> = [],
  ) {
    super(`Provider filtered ${direction}`);
    this.name = 'ProviderContentFilterError';
  }
}
