import { afterAll, beforeAll } from 'vitest';

/** The variables Scenario's tracing and event bus read from `process.env` when `run()` is called. */
export const LANGWATCH_ENV_KEYS = ['LANGWATCH_API_KEY', 'LANGWATCH_ENDPOINT'] as const;

/**
 * Keeps offline tests that drive the L1 executor from streaming to LangWatch when a developer
 * shell has a key set: removes the variables before the suite's first Scenario `run()` (Scenario
 * reads them at call time, not at import) and restores them afterwards.
 */
export function withoutLangwatchEnv(): void {
  const saved: Partial<Record<(typeof LANGWATCH_ENV_KEYS)[number], string>> = {};
  beforeAll(() => {
    for (const key of LANGWATCH_ENV_KEYS) {
      if (process.env[key] !== undefined) saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterAll(() => {
    for (const key of LANGWATCH_ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });
}
