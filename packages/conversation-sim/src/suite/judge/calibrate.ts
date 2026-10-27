import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSafeId, stableJson } from '../baseline';
import {
  AgreementFileSchema,
  LabelSchema,
  LabelsFileSchema,
  FrameworkLayerSchema,
  QaSessionExportSchema,
  parseEvaluatedAt,
  type AgreementFile,
  type AgreementStats,
  type JudgeUsage,
  type Label,
  type LabelStatus,
  type LabelsFile,
  type LabelTranscript,
  type Layer,
  type LoadedSuite,
  type QaSessionExport,
  type SuiteConfig,
} from '../schema';
import { addJudgeUsage, emptyJudgeUsage, type CriterionJudge, type JudgeInput } from './criterion-judge';
import { decideMeaning, type MeaningDecision } from './decide-meaning';
import { computeJudgeFingerprint, sha256 } from './fingerprint';
import { fixtureContext } from './judge-input';

/**
 * Judge calibration (architecture AD-8, Story 13.2): human labels, the QA-export import
 * adapter, label context resolution, agreement math and the only writer of the agreement
 * file. Labels are judged through the same input shape and meaning decision `evaluate`
 * uses. Label statuses are never rewritten after import.
 */

// ---------------------------------------------------------------------------
// Paths and file I/O
// ---------------------------------------------------------------------------

const LABELS_FILE = 'labels.json';
const AGREEMENT_FILE = 'agreement.json';

export function calibrationDir(packageDir: string, suiteId: string): string {
  if (!isSafeId(suiteId)) throw new Error(`[suite] calibrate: unsafe suite id ${suiteId}`);
  return join(packageDir, 'calibration', suiteId);
}

export function labelsPath(packageDir: string, suiteId: string): string {
  return join(calibrationDir(packageDir, suiteId), LABELS_FILE);
}

export function agreementPath(packageDir: string, suiteId: string): string {
  return join(calibrationDir(packageDir, suiteId), AGREEMENT_FILE);
}

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`[suite] calibrate: ${what} is not readable JSON (${(error as Error).message})`);
  }
}

function firstIssue(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  const issue = error.issues[0];
  return `${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`;
}

/** The suite's labels; an absent file is zero labels. Throws `[suite]` on an invalid file. */
export function readLabelsFile(packageDir: string, suiteId: string): LabelsFile {
  const path = labelsPath(packageDir, suiteId);
  if (!existsSync(path)) return { schemaVersion: 1, labels: [] };
  const parsed = LabelsFileSchema.safeParse(readJson(path, `${suiteId} labels`));
  if (!parsed.success) throw new Error(`[suite] calibrate: ${suiteId} labels are invalid at ${firstIssue(parsed.error)}`);
  return parsed.data;
}

export function writeLabelsFile(packageDir: string, suiteId: string, file: LabelsFile): string {
  const path = labelsPath(packageDir, suiteId);
  const valid = LabelsFileSchema.parse(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(valid, null, 2)}\n`);
  return path;
}

/** The suite's agreement file, or null when absent (read by judge trust, 13.3). */
export function readAgreementFile(packageDir: string, suiteId: string): AgreementFile | null {
  const path = agreementPath(packageDir, suiteId);
  if (!existsSync(path)) return null;
  const parsed = AgreementFileSchema.safeParse(readJson(path, `${suiteId} agreement`));
  if (!parsed.success) throw new Error(`[suite] calibrate: ${suiteId} agreement is invalid at ${firstIssue(parsed.error)}`);
  return parsed.data;
}

/** The only writer of the agreement file; returns its path. */
export function writeAgreementFile(packageDir: string, suiteId: string, file: AgreementFile): string {
  const path = agreementPath(packageDir, suiteId);
  const valid = AgreementFileSchema.parse(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(valid, null, 2)}\n`);
  return path;
}

// ---------------------------------------------------------------------------
// Hashes
// ---------------------------------------------------------------------------

export function transcriptSha256(transcript: LabelTranscript): string {
  return sha256(stableJson(transcript));
}

/** sha256 over the parsed labels array; judge trust (13.3) compares it with the agreement file. */
export function labelsSha256(labels: readonly Label[]): string {
  return sha256(stableJson(labels));
}

// ---------------------------------------------------------------------------
// Label context resolution
// ---------------------------------------------------------------------------

export type LabelScope = 'reply' | 'conversation';

/** Everything the judge needs for a label besides its transcript. */
export interface LabelContext {
  criterionId: string;
  layer: Layer;
  passCondition: string;
  expectedBehavior: string;
  judgeGuidance: string | null;
  fixtureContext: unknown | null;
  scope: LabelScope;
}

export type LabelContextFailure = 'unknown-criterion' | 'not-testable' | 'not-judgeable' | 'ambiguous-context';

export type LabelContextResult = { ok: true; context: LabelContext } | { ok: false; reason: LabelContextFailure; message: string };

/**
 * The criterion's judged context: every test where it has a meaning check at `reply:<n>`,
 * `after-step:<n>` or `conversation` must agree on guidance, fixture context and scope.
 * Ambiguity is refused rather than guessed, so a label never calibrates a prompt the
 * suite does not run.
 */
export function resolveLabelContext(suite: Pick<LoadedSuite, 'sources' | 'tests'>, criterionId: string): LabelContextResult {
  const source = suite.sources.find((candidate) => candidate.criteria.some((criterion) => criterion.id === criterionId));
  const manifest = source?.criteria.find((criterion) => criterion.id === criterionId);
  if (!source || !manifest) {
    return { ok: false, reason: 'unknown-criterion', message: `${criterionId} is not in the suite manifest` };
  }
  if (manifest.notTestableReason !== undefined) {
    return { ok: false, reason: 'not-testable', message: `${criterionId} is NOT TESTABLE (${manifest.notTestableReason})` };
  }

  const contexts: Array<{ testId: string; key: string; guidance: string | null; fixture: unknown | null; scope: LabelScope }> = [];
  for (const test of suite.tests) {
    for (const criterion of test.criteria) {
      if (criterion.id !== criterionId || !criterion.checks.some((check) => check.type === 'meaning')) continue;
      const at = parseEvaluatedAt(criterion.evaluatedAt);
      if (at.kind !== 'reply' && at.kind !== 'after-step' && at.kind !== 'conversation') continue;
      const guidance = criterion.judgeGuidance ?? null;
      const fixture = fixtureContext(test);
      const scope: LabelScope = at.kind === 'conversation' ? 'conversation' : 'reply';
      contexts.push({ testId: test.id, key: stableJson({ guidance, fixture, scope }), guidance, fixture, scope });
    }
  }
  if (contexts.length === 0) {
    return { ok: false, reason: 'not-judgeable', message: `${criterionId} has no meaning check at reply, after-step or conversation in any test` };
  }
  const first = contexts[0]!;
  const other = contexts.find((context) => context.key !== first.key);
  if (other) {
    const field = other.guidance !== first.guidance ? 'judgeGuidance' : other.scope !== first.scope ? 'scope' : 'fixture context';
    return {
      ok: false,
      reason: 'ambiguous-context',
      message: `${criterionId} is judged with a different ${field} in ${first.testId} and ${other.testId}; make the suite consistent`,
    };
  }
  return {
    ok: true,
    context: {
      criterionId,
      layer: manifest.layer,
      passCondition: manifest.passCondition,
      expectedBehavior: source.expectedBehavior,
      judgeGuidance: first.guidance,
      fixtureContext: first.fixture,
      scope: first.scope,
    },
  };
}

/** Null when the label's scope matches the context (`conversation` iff a null reply index). */
function scopeMismatch(context: LabelContext, evaluatedReplyIndex: number | null): string | null {
  const labelScope: LabelScope = evaluatedReplyIndex === null ? 'conversation' : 'reply';
  if (labelScope === context.scope) return null;
  return context.scope === 'conversation'
    ? `${context.criterionId} is a conversation criterion; the label must name no reply (null index)`
    : `${context.criterionId} is judged on one reply; the label must name a coach reply`;
}

// ---------------------------------------------------------------------------
// QA export import
// ---------------------------------------------------------------------------

/**
 * The single QA-export converter (the export format is an assumption until QA confirms
 * it): one label per status, the transcript cut after `replyIndex` (whole dialogue when
 * null), `source.ref` from the session as provenance only.
 */
export function qaExportToLabels(exported: QaSessionExport): Label[] {
  return exported.sessions.flatMap((session) =>
    session.statuses.map((status) => ({
      criterionId: status.criterionId,
      status: status.status,
      transcript: {
        turns: (status.replyIndex === null ? session.dialogue : session.dialogue.slice(0, status.replyIndex + 1)).map((turn) => ({
          role: turn.role,
          text: turn.text,
        })),
        evaluatedReplyIndex: status.replyIndex,
      },
      source: { kind: 'qa-session' as const, ref: session.ref },
      labeler: session.labeler,
      labeledAt: session.labeledAt,
    })),
  );
}

export type ImportResult =
  | { ok: true; file: LabelsFile; added: Label[]; warnings: string[] }
  | { ok: false; errors: string[] };

/** Names the session ref and criterion an export schema issue points at, when it can. */
function describeExportIssue(raw: unknown, path: Array<string | number>): string {
  const sessions = (raw as { sessions?: unknown } | null)?.sessions;
  if (path[0] !== 'sessions' || typeof path[1] !== 'number' || !Array.isArray(sessions)) return '';
  const session = sessions[path[1]] as { ref?: unknown; statuses?: unknown } | undefined;
  const ref = typeof session?.ref === 'string' ? `session ${session.ref}` : `session #${path[1]}`;
  if (path[2] !== 'statuses' || typeof path[3] !== 'number' || !Array.isArray(session?.statuses)) return `${ref}: `;
  const criterionId = (session.statuses[path[3]] as { criterionId?: unknown } | undefined)?.criterionId;
  return `${ref}, ${typeof criterionId === 'string' ? criterionId : `status #${path[3]}`}: `;
}

/**
 * Validates a QA export against the suite and appends its labels to `existing`, deduplicated
 * on `(criterionId, transcriptSha256)` against existing labels and within the import (the
 * first label wins). Any invalid entry rejects the whole import.
 */
export function importQaExport(suite: Pick<LoadedSuite, 'sources' | 'tests'>, existing: LabelsFile, raw: unknown): ImportResult {
  const parsed = QaSessionExportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `[suite] import: ${describeExportIssue(raw, issue.path)}${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }

  const labels = qaExportToLabels(parsed.data);
  const errors: string[] = [];
  for (const label of labels) {
    const valid = LabelSchema.safeParse(label);
    if (!valid.success) {
      for (const issue of valid.error.issues) {
        errors.push(`[suite] import: session ${label.source.ref}, ${label.criterionId}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
      continue;
    }
    const resolved = resolveLabelContext(suite, label.criterionId);
    const problem = resolved.ok ? scopeMismatch(resolved.context, label.transcript.evaluatedReplyIndex) : `${resolved.reason}: ${resolved.message}`;
    if (problem !== null) errors.push(`[suite] import: session ${label.source.ref}, ${label.criterionId}: ${problem}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const seen = new Map<string, Label>();
  for (const label of existing.labels) {
    const key = `${label.criterionId}|${transcriptSha256(label.transcript)}`;
    if (!seen.has(key)) seen.set(key, label);
  }
  const added: Label[] = [];
  const warnings: string[] = [];
  for (const label of labels) {
    const hash = transcriptSha256(label.transcript);
    const key = `${label.criterionId}|${hash}`;
    const kept = seen.get(key);
    if (kept) {
      const conflict =
        kept.status !== label.status ? `; the export says ${label.status}, the kept label says ${kept.status}` : '';
      warnings.push(
        `[suite] warning: skipped duplicate label ${label.criterionId} from session ${label.source.ref} (transcript ${hash.slice(0, 12)})${conflict}`,
      );
      continue;
    }
    seen.set(key, label);
    added.push(label);
  }
  return { ok: true, file: { schemaVersion: 1, labels: [...existing.labels, ...added] }, added, warnings };
}

// ---------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------

export type JudgedStatus = 'PASS' | 'FAIL' | 'ERROR';

export interface AgreementPair {
  layer: Layer;
  label: LabelStatus;
  judge: JudgedStatus;
}

const CATEGORIES: readonly JudgedStatus[] = ['PASS', 'FAIL', 'ERROR'];

/** Overall agreement and Cohen's kappa over PASS/FAIL/ERROR (ERROR always disagrees). */
export function agreementStats(pairs: readonly AgreementPair[]): AgreementStats {
  const n = pairs.length;
  if (n === 0) return { n: 0, overall: null, kappa: null };
  const agreeing = pairs.filter((pair) => pair.label === pair.judge).length;
  const po = agreeing / n;
  const pe = CATEGORIES.reduce((sum, category) => {
    const human = pairs.filter((pair) => pair.label === category).length / n;
    const judge = pairs.filter((pair) => pair.judge === category).length / n;
    return sum + human * judge;
  }, 0);
  return { n, overall: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

export function computeAgreement(pairs: readonly AgreementPair[]): Pick<AgreementFile, 'n' | 'overall' | 'kappa' | 'perLayer'> {
  const all = agreementStats(pairs);
  const layer = (name: Layer) => agreementStats(pairs.filter((pair) => pair.layer === name));
  const perLayer: AgreementFile['perLayer'] = { P: layer('P'), D: layer('D'), C: layer('C'), S: layer('S') };
  return { n: all.n, overall: all.overall, kappa: all.kappa, perLayer };
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface LabelOutcome {
  /** Position in the labels file. */
  index: number;
  label: Label;
  layer: Layer;
  decision: MeaningDecision;
  agrees: boolean;
}

export interface CalibrationResult {
  agreement: AgreementFile;
  outcomes: LabelOutcome[];
  usage: JudgeUsage;
  /** Labels whose judge call ended in ERROR (counted as disagreements). */
  judgeErrors: number;
}

export interface CalibrateOptions {
  suite: LoadedSuite;
  labels: LabelsFile;
  judge: CriterionJudge;
  judgeConfig: SuiteConfig['judge'];
  now: () => Date;
}

/** The judge input and evidence reply texts for one label, built as `buildJudgeInput` builds them for a run. */
export function labelJudgeInput(label: Label, context: LabelContext): { input: JudgeInput; replyTexts: string[] } {
  const turns = label.transcript.turns.map((turn) => ({ role: turn.role, text: turn.text }));
  const index = label.transcript.evaluatedReplyIndex;
  const replyTexts = index === null ? turns.filter((turn) => turn.role === 'coach').map((turn) => turn.text) : [turns[index]!.text];
  return {
    input: {
      transcript: { turns, evaluatedReplyIndex: index },
      expectedBehavior: context.expectedBehavior,
      passCondition: context.passCondition,
      judgeGuidance: context.judgeGuidance,
      layer: context.layer,
      fixtureContext: context.fixtureContext,
    },
    replyTexts,
  };
}

/**
 * Resolves every label first (any unresolvable label throws before a judge call), then
 * judges each label in file order and computes the agreement record. Writes nothing.
 */
export async function calibrate(options: CalibrateOptions): Promise<CalibrationResult> {
  const { suite, labels } = options;
  const problems: string[] = [];
  const contexts = labels.labels.map((label, index) => {
    const resolved = resolveLabelContext(suite, label.criterionId);
    const problem = resolved.ok ? scopeMismatch(resolved.context, label.transcript.evaluatedReplyIndex) : `${resolved.reason}: ${resolved.message}`;
    if (problem !== null) problems.push(`[suite] calibrate: label #${index} ${label.criterionId} (${label.source.ref}): ${problem}`);
    return resolved.ok ? resolved.context : null;
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));

  const outcomes: LabelOutcome[] = [];
  let usage = emptyJudgeUsage();
  for (const [index, label] of labels.labels.entries()) {
    const context = contexts[index]!;
    const { input, replyTexts } = labelJudgeInput(label, context);
    // Sequential, in file order, so judge calls are deterministic.
    const decision = await decideMeaning(options.judge, input, replyTexts);
    usage = addJudgeUsage(usage, decision.usage);
    outcomes.push({ index, label, layer: context.layer, decision, agrees: decision.status === label.status });
  }

  const agreement: AgreementFile = {
    schemaVersion: 1,
    fingerprint: computeJudgeFingerprint(options.judgeConfig, suite),
    labelsSha256: labelsSha256(labels.labels),
    ...computeAgreement(outcomes.map((outcome) => ({ layer: outcome.layer, label: outcome.label.status, judge: outcome.decision.status }))),
    computedAt: options.now().toISOString(),
  };
  return {
    agreement,
    outcomes,
    usage,
    judgeErrors: outcomes.filter((outcome) => outcome.decision.status === 'ERROR').length,
  };
}

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

function percent(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`;
}

function kappaText(kappa: number | null): string {
  return kappa === null ? 'n/a' : kappa.toFixed(3);
}

/** Per-layer table, one line per disagreement, judge usage and the minLabels warning. */
export function calibrationLines(result: CalibrationResult, minLabels: number): string[] {
  const { agreement } = result;
  const row = (label: string, stats: AgreementStats) =>
    `[suite] ${label.padEnd(5)}  ${String(stats.n).padStart(4)}  ${percent(stats.overall).padStart(6)}  ${kappaText(stats.kappa).padStart(6)}`;
  const lines = [`[suite] ${'layer'.padEnd(5)}  ${'n'.padStart(4)}  ${'agree'.padStart(6)}  ${'kappa'.padStart(6)}`];
  for (const layer of FrameworkLayerSchema.options) lines.push(row(layer, agreement.perLayer[layer]));
  lines.push(row('all', agreement));
  for (const outcome of result.outcomes) {
    if (outcome.agrees) continue;
    const { label, decision } = outcome;
    const why = decision.status === 'ERROR' ? `${decision.reason}: ${decision.message}` : decision.reason;
    lines.push(
      `[suite] disagreement: ${label.criterionId} label ${label.status} judge ${decision.status} ref ${label.source.ref} labeledAt ${label.labeledAt}: ${why}`,
    );
  }
  const { usage } = result;
  lines.push(
    `[suite] judge usage: ${usage.calls} calls, ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens, ${usage.totalTokens} total tokens`,
  );
  if (agreement.n < minLabels) lines.push(`[suite] warning: ${agreement.n} labels is below minLabels ${minLabels}`);
  return lines;
}
