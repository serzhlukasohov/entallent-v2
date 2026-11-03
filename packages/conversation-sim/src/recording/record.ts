import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { AiProviderPort } from '@entalent/application';
import type { CoachHarness } from '../harness/coach-harness';
import { seedHarness } from '../preconditions/load';
import type { PreconditionInput } from '../preconditions/schema';
import { exportPrecondition } from './export';
import { CANDIDATE_FILE, CANDIDATES_DIR, PACKAGE_ROOT, type Recording } from './load';

export interface RecordOptions {
  /** `scripted` needs `aiProvider`; `live` must not pass one, so the harness wires the real model. */
  provider: 'live' | 'scripted';
  aiProvider?: AiProviderPort;
}

export interface RecordResult {
  harness: CoachHarness;
  candidate: PreconditionInput;
}

/**
 * Runs the recording's replies once from its base precondition and exports the state after the
 * last reply as a candidate. A turn error propagates and nothing is exported: a half-run state is
 * not a precondition anyone reviewed.
 */
export async function recordPrecondition(recording: Recording, options: RecordOptions): Promise<RecordResult> {
  if (options.provider === 'scripted' && !options.aiProvider) {
    throw new Error('recordPrecondition: a scripted recording needs the scripted aiProvider');
  }
  if (options.provider === 'live' && options.aiProvider) {
    throw new Error('recordPrecondition: a live recording uses the harness model; do not pass aiProvider');
  }
  const seeded = await seedHarness(recording.basePrecondition, options.aiProvider ? { aiProvider: options.aiProvider } : {});
  for (const reply of recording.replies) await seeded.harness.send(reply);
  const candidate = await exportPrecondition(seeded, {
    name: recording.name,
    ...(recording.description ? { description: recording.description } : {}),
    recordedFrom: displayPath(recording.source),
    provider: options.provider,
  });
  return { harness: seeded.harness, candidate };
}

/** Writes `<candidatesDir>/<name>/precondition.json` and returns its path. */
export function writeCandidate(candidate: PreconditionInput, candidatesDir: string = CANDIDATES_DIR): string {
  const dir = join(candidatesDir, candidate.name!);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CANDIDATE_FILE);
  writeFileSync(path, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
  return path;
}

/** Package- or repo-relative, never an absolute machine path: it is committed with the approved file. */
function displayPath(path: string): string {
  const fromPackage = relative(PACKAGE_ROOT, path);
  if (!fromPackage.startsWith('..')) return fromPackage;
  const fromRepo = relative(join(PACKAGE_ROOT, '..', '..'), path);
  return fromRepo.startsWith('..') ? basename(path) : fromRepo;
}
