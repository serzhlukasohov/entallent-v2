import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { ZodError } from 'zod';
import { expandPreset, mergeBodies } from './presets';
import {
  PRECONDITION_SCHEMA_VERSION,
  PRESET_NAMES,
  preconditionBodySchema,
  preconditionSchema,
  type Precondition,
  type PreconditionBody,
  type PreconditionState,
  type Preset,
} from './schema';

// Parsing lives apart from `load.ts`, which imports Vitest: the approve CLI runs outside Vitest.

export const MINUTE_MS = 60_000;
/** Gap between the last history message and the start time when the precondition sets none. */
export const DEFAULT_ELAPSED_MINUTES = 1;
/** Fields that describe the file rather than the state; presets never set them. */
const FILE_ONLY_KEYS = new Set(['schemaVersion', 'name', 'description', 'origin', 'presets']);

/** A validated precondition with its presets applied and explicit fields over them. */
export interface ResolvedPrecondition {
  name: string;
  /** File it came from; null when built in code. */
  source: string | null;
  origin: Precondition['origin'];
  presets: Preset[];
  state: PreconditionState;
}

export interface ParseOptions {
  /**
   * Accept a recorded precondition that is not approved yet. Only the approve command reads
   * candidates; tests and QA files never pass this.
   */
  allowCandidate?: boolean;
}

export class PreconditionError extends Error {
  override name = 'PreconditionError';
}

/** Reads and validates a precondition file. Errors name the file and the field path. */
export function loadPrecondition(path: string, options: ParseOptions = {}): ResolvedPrecondition {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new PreconditionError(`${path}: cannot read precondition JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsePrecondition(raw, path, options);
}

/**
 * Validates a precondition object and resolves it: presets apply in order, then the explicit
 * fields override them (`mergeBodies`), then defaults are filled in.
 */
export function parsePrecondition(raw: unknown, source: string | null = null, options: ParseOptions = {}): ResolvedPrecondition {
  const label = source ?? 'precondition';
  const version = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).schemaVersion : undefined;
  if (version !== PRECONDITION_SCHEMA_VERSION) {
    throw new PreconditionError(
      `${label}: schemaVersion: unsupported precondition version ${JSON.stringify(version)}; `
      + `this harness reads version ${PRECONDITION_SCHEMA_VERSION}`,
    );
  }
  const parsed = preconditionSchema.safeParse(raw);
  if (!parsed.success) throw new PreconditionError(formatIssues(label, parsed.error));
  const precondition = parsed.data;
  checkApproval(label, precondition.origin, options);

  const explicit = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => !FILE_ONLY_KEYS.has(key)));
  const body = precondition.presets
    .map(expandPreset)
    .reduce<PreconditionBody>((merged, part) => mergeBodies(merged, part), {});
  const resolved = preconditionBodySchema.safeParse(mergeBodies(body, explicit as PreconditionBody));
  if (!resolved.success) throw new PreconditionError(formatIssues(label, resolved.error));
  checkReferences(label, resolved.data);

  return {
    name: precondition.name ?? (source ? basename(source).replace(/\.json$/, '') : 'inline precondition'),
    source,
    origin: precondition.origin,
    presets: precondition.presets,
    state: resolved.data,
  };
}

/** A recorded precondition is test state only once someone approved it, by command or in a PR. */
function checkApproval(label: string, origin: Precondition['origin'], options: ParseOptions): void {
  if (origin.kind !== 'recorded') return;
  if (!origin.approved) {
    if (options.allowCandidate) return;
    throw new PreconditionError(
      `${label}: origin.approved: candidate precondition (recorded, not approved); `
      + 'review its report and approve it with `pnpm sim:approve <candidate>` before a test uses it',
    );
  }
  const missing = (['approvedBy', 'approvedAt'] as const).filter((key) => !origin[key]?.trim());
  if (missing.length > 0) {
    throw new PreconditionError(`${label}: origin.${missing[0]}: an approved recording names who approved it and when (${missing.join(', ')} missing)`);
  }
}

/** How long before the start each history message was sent, oldest first. */
export function historyOffsets(state: PreconditionState): number[] {
  const history = state.history ?? [];
  const last = history.length - 1;
  const offsets = history.map((entry, index) =>
    entry.minutesBeforeStart !== undefined
      ? entry.minutesBeforeStart * MINUTE_MS
      : (last - index + DEFAULT_ELAPSED_MINUTES) * MINUTE_MS);
  // `elapsedMinutes` moves the whole history so its last message sits that long before the start.
  const shift = state.elapsedMinutes !== undefined && history.length > 0
    ? state.elapsedMinutes * MINUTE_MS - offsets[last]!
    : 0;
  return offsets.map((offset) => offset + shift);
}

/** Cross-field references zod cannot see: history indexes and the next probe question. */
function checkReferences(label: string, state: PreconditionState): void {
  const problems: string[] = [];
  const historyLength = state.history?.length ?? 0;
  // Resolved times must run oldest first and stay before the start time.
  historyOffsets(state).forEach((offset, index, offsets) => {
    if (offset <= 0) {
      problems.push(`history.${index}: resolves to ${offset / MINUTE_MS} min before the start; history must end before startTime`);
    } else if (index > 0 && offset >= offsets[index - 1]!) {
      problems.push(`history.${index}: resolves to ${offset / MINUTE_MS} min before the start, not after history.${index - 1} `
        + `(${offsets[index - 1]! / MINUTE_MS} min); history must be oldest first`);
    }
  });
  const topics = state.pulseCycle?.topics ?? [];
  topics.forEach((topic, topicIndex) => topic.evidence.forEach((item, evidenceIndex) => {
    item.sourceHistoryIndexes.forEach((historyIndex, position) => {
      if (historyIndex >= historyLength) {
        problems.push(`pulseCycle.topics.${topicIndex}.evidence.${evidenceIndex}.sourceHistoryIndexes.${position}: `
          + `history has ${historyLength} message(s), index ${historyIndex} does not exist`);
      }
    });
  }));
  const probe = state.pulseCycle?.nextProbe;
  if (probe && !topics.some((topic) => topic.questions.some((question) => question.id === probe.questionId))) {
    problems.push(`pulseCycle.nextProbe.questionId: question ${probe.questionId} is not in pulseCycle.topics`);
  }
  if (problems.length > 0) throw new PreconditionError(`${label}: invalid precondition\n  ${problems.join('\n  ')}`);
}

function formatIssues(label: string, error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    const presetHint = issue.path[0] === 'presets'
      ? ` (known presets: ${PRESET_NAMES.join(', ')})`
      : '';
    return `${path}: ${issue.message}${presetHint}`;
  });
  return `${label}: invalid precondition\n  ${lines.join('\n  ')}`;
}
