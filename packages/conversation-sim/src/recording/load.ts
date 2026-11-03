import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ZodError } from 'zod';
import { loadPrecondition, parsePrecondition, type ResolvedPrecondition } from '../preconditions/parse';
import { RECORDING_SCHEMA_VERSION, recordingSchema, type RecordingFile } from './schema';

// The package compiles as CommonJS, where `import.meta` does not typecheck; `__dirname` is the same anchor.
export const PACKAGE_ROOT = join(__dirname, '..', '..');
/** Approved preconditions; QA test paths resolve against this folder. */
export const PRECONDITIONS_DIR = join(PACKAGE_ROOT, 'preconditions');
/** Approved recordings land here, one `<name>.json` each. */
export const RECORDED_SUBDIR = 'recorded';
/** Candidates wait here for review: `<name>/precondition.json` plus reports under `<name>/runs/`. */
export const CANDIDATES_DIR = join(PACKAGE_ROOT, 'precondition-candidates');
export const CANDIDATE_FILE = 'precondition.json';

/** A validated recording file with its base precondition resolved. */
export interface Recording extends RecordingFile {
  /** File it was loaded from. */
  source: string;
  basePrecondition: ResolvedPrecondition;
}

export class RecordingError extends Error {
  override name = 'RecordingError';
}

/** Reads and validates a recording file and its base. Errors name the file and the field path. */
export function loadRecording(path: string, preconditionsDir: string = PRECONDITIONS_DIR): Recording {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new RecordingError(`${path}: cannot read recording JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const version = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).schemaVersion : undefined;
  if (version !== RECORDING_SCHEMA_VERSION) {
    throw new RecordingError(
      `${path}: schemaVersion: unsupported recording version ${JSON.stringify(version)}; this harness reads version ${RECORDING_SCHEMA_VERSION}`,
    );
  }
  const parsed = recordingSchema.safeParse(raw);
  if (!parsed.success) throw new RecordingError(formatIssues(path, parsed.error));
  return { ...parsed.data, source: path, basePrecondition: resolveBase(path, parsed.data.base, preconditionsDir) };
}

function resolveBase(path: string, base: RecordingFile['base'], preconditionsDir: string): ResolvedPrecondition {
  try {
    if (base === undefined) return parsePrecondition({ schemaVersion: 1, name: 'empty' });
    if (typeof base !== 'string') return parsePrecondition({ name: 'inline base', ...base }, null);
    const basePath = resolve(preconditionsDir, base);
    if (isAbsolute(base) || relative(preconditionsDir, basePath).startsWith('..')) {
      throw new RecordingError(`must be a path inside ${preconditionsDir}, got ${base}`);
    }
    if (!existsSync(basePath)) throw new RecordingError(`file not found: ${basePath} (paths are relative to ${preconditionsDir})`);
    return loadPrecondition(basePath);
  } catch (error) {
    throw new RecordingError(`${path}: base: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatIssues(label: string, error: ZodError): string {
  const lines = error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return `${label}: invalid recording\n  ${lines.join('\n  ')}`;
}
