import { ScriptedAiProvider } from '../../../fakes/scripted-ai';
import { L1OrchestratorExecutor } from '../l1-orchestrator-executor';

/**
 * Plain-Node probe for `import-graph.test.ts`: runs one scripted atomic L1 case through the real
 * executor and Scenario `run()` offline, prints the recorded steps as JSON and exits explicitly
 * (Scenario leaves a drain timer referenced). Never imports Vitest.
 */
async function main(): Promise<number> {
  const executor = new L1OrchestratorExecutor({ createAiProvider: () => new ScriptedAiProvider(), coachModel: 'probe', langwatch: { apiKey: '' } });
  const run = await executor.run(
    {
      id: 'PROBE.A1',
      sourceCase: 'PROBE',
      requirement: [],
      kind: 'atomic',
      levels: ['L1'],
      runProfile: 'isolated',
      setup: [],
      seed: { history: [] },
      preconditions: [],
      steps: [{ text: 'Hello.' }],
      criteria: [],
    },
    { attempt: 1, interMessageGapMs: 60_000, suiteId: 'probe' },
  );
  process.stdout.write(`${JSON.stringify({ steps: run.steps.length, reply: run.steps[0]?.reply !== null, errors: run.errors })}\n`);
  return run.errors.length === 0 && run.steps.length === 1 ? 0 : 1;
}

void main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(2);
  },
);
