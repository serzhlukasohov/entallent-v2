import { resolve } from 'node:path';
import { promoteDraft } from './promote';

// usage: pnpm sim:qa:promote <draft.json> [--qa-tests <dir>]
// Validates a finished QA test draft (no model call) and moves it into qa-tests/, where the next `pnpm sim` runs it.
// Paths resolve against the folder pnpm was started from, so the same command works from the repo root.

const USAGE = 'usage: pnpm sim:qa:promote <draft.json> [--qa-tests <dir>]';

function main(argv: string[]): number {
  const args = argv.filter((arg) => arg !== '--');
  const positional: string[] = [];
  let qaTestsDir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--qa-tests') {
      const value = args[++index];
      if (!value || value.startsWith('--')) return fail(`${arg} needs a value\n${USAGE}`);
      qaTestsDir = value;
    } else if (arg.startsWith('--')) return fail(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) return fail(USAGE);
  const base = process.env.INIT_CWD ?? process.cwd();
  try {
    const result = promoteDraft({
      draft: resolve(base, positional[0]!),
      ...(qaTestsDir ? { qaTestsDir: resolve(base, qaTestsDir) } : {}),
    });
    console.log(`promoted: ${result.target}`);
    console.log(`run it (calls the model): pnpm --filter @entalent/conversation-sim sim -- src/scenarios/qa-tests.sim.test.ts -t "${result.id}"`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
