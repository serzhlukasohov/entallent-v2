import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parsePrecondition } from '../preconditions/parse';
import { CANDIDATE_FILE, PRECONDITIONS_DIR, RECORDED_SUBDIR } from './load';
import { RECORDING_NAME } from './schema';

// Runs outside Vitest (the approve CLI), so it imports only Vitest-free modules.

export interface ApproveOptions {
  /** A candidate folder or its `precondition.json`. */
  candidate: string;
  approvedBy: string;
  /** Approval time; defaults to now. */
  now?: Date;
  /** Approve a recording whose bot replies came from a scripted provider (framework tests only). */
  allowScripted?: boolean;
  preconditionsDir?: string;
}

export interface ApproveResult {
  /** Approved file, `<preconditionsDir>/recorded/<name>.json`. */
  target: string;
  /** Path QA test files use: `recorded/<name>.json`. */
  reference: string;
}

export class ApproveError extends Error {
  override name = 'ApproveError';
}

/**
 * Marks a reviewed candidate approved (who and when, next to how it was recorded) and moves it
 * into the tracked preconditions folder. Reports stay in the candidate folder. Nothing is written
 * when any check fails.
 */
export function approveCandidate(options: ApproveOptions): ApproveResult {
  const source = existsSync(options.candidate) && statSync(options.candidate).isDirectory()
    ? join(options.candidate, CANDIDATE_FILE)
    : options.candidate;
  if (!existsSync(source)) throw new ApproveError(`${source}: candidate not found`);
  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) throw new ApproveError('approver is empty: pass --by <name> or set git config user.name');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(source, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new ApproveError(`${source}: cannot read candidate JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const resolved = parsePrecondition(raw, source, { allowCandidate: true });
  const origin = resolved.origin;
  if (origin.kind !== 'recorded') throw new ApproveError(`${source}: origin.kind is ${origin.kind}; only recorded candidates are approved`);
  if (origin.approved) throw new ApproveError(`${source}: already approved by ${origin.approvedBy ?? '?'}`);
  if (origin.provider !== 'live' && !options.allowScripted) {
    throw new ApproveError(`${source}: recorded with a ${origin.provider ?? 'unknown'} provider, so its bot replies may not be the real model's; `
      + 'record it with --live, or pass --allow-scripted for a framework test');
  }
  const name = typeof raw.name === 'string' ? raw.name : basename(join(source, '..'));
  if (!RECORDING_NAME.test(name)) throw new ApproveError(`${source}: name ${JSON.stringify(name)} is not a safe file name`);

  const dir = join(options.preconditionsDir ?? PRECONDITIONS_DIR, RECORDED_SUBDIR);
  const target = join(dir, `${name}.json`);
  if (existsSync(target)) throw new ApproveError(`${target} already exists; rename the recording or remove the old file first`);

  const approved = {
    ...raw,
    origin: { ...origin, approved: true, approvedBy, approvedAt: (options.now ?? new Date()).toISOString() },
  };
  // The approved file must load the way a test loads it, before anything is written.
  parsePrecondition(approved, target);
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, `${JSON.stringify(approved, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  rmSync(source);
  return { target, reference: `${RECORDED_SUBDIR}/${name}.json` };
}
