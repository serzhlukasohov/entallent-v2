import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { approveCandidate } from './approve';

// usage: pnpm sim:approve <candidate folder | precondition.json> [--by <name>] [--allow-scripted] [--preconditions <dir>]
// Paths resolve against the folder pnpm was started from, so the same command works from the repo root.

const USAGE = 'usage: pnpm sim:approve <candidate folder | precondition.json> [--by <name>] [--allow-scripted] [--preconditions <dir>]';

function main(argv: string[]): number {
  const args = argv.filter((arg) => arg !== '--');
  const positional: string[] = [];
  let by: string | undefined;
  let preconditionsDir: string | undefined;
  let allowScripted = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--by' || arg === '--preconditions') {
      const value = args[++index];
      if (!value || value.startsWith('--')) return fail(`${arg} needs a value\n${USAGE}`);
      if (arg === '--by') by = value;
      else preconditionsDir = value;
    }
    else if (arg === '--allow-scripted') allowScripted = true;
    else if (arg.startsWith('--')) return fail(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) return fail(USAGE);
  const base = process.env.INIT_CWD ?? process.cwd();
  const approvedBy = by ?? gitUserName();
  if (!approvedBy) return fail('no approver: pass --by <name> or set git config user.name');
  try {
    const result = approveCandidate({
      candidate: resolve(base, positional[0]!),
      approvedBy,
      allowScripted,
      ...(preconditionsDir ? { preconditionsDir: resolve(base, preconditionsDir) } : {}),
    });
    console.log(`approved: ${result.target}\nuse it in a QA test as "precondition": "${result.reference}"`);
    return 0;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function gitUserName(): string | undefined {
  const git = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() || undefined : undefined;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
