import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Simulations talk to the same OpenAI account as local development. Vitest workers
// don't inherit env mutations from this file, so the parsed values are injected.
const rootEnv = config({ path: new URL('../../.env', import.meta.url) }).parsed ?? {};

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    env: rootEnv,
    include: ['src/scenarios/**/*.sim.test.ts', 'src/gate/**/*.test.ts'],
    // Simulations are long chains of live LLM calls, not unit tests.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // Each scenario drives an independent conversation, so they can overlap.
    fileParallelism: true,
  },
});
