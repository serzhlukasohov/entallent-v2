import { fieldObserved, stateAtStep, type CaseRun, type StateQueryName } from '../schema';
import type { RuleOutcome } from './reply-selection';

/**
 * The value of `query` in the snapshot named by `at`, or the outcome that stops the rule:
 * NOT_OBSERVABLE `unobservable:state.<query>@<level>` when the run did not declare the
 * query, and `state-not-read:<query>@<at>` when the snapshot lacks the key.
 */
export function readState(
  run: CaseRun,
  query: StateQueryName,
  at: string,
): { kind: 'value'; value: unknown } | { kind: 'outcome'; outcome: RuleOutcome } {
  const field = `state.${query}` as const;
  if (!fieldObserved(field, run.observed)) {
    return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence: `unobservable:${field}@${run.level}` } };
  }
  const step = stateAtStep(at);
  const snapshot =
    at === 'before' ? run.state.before : at === 'after' ? run.state.after : step !== null ? run.state.afterStep[String(step)] : undefined;
  const value = snapshot?.[query];
  if (value === undefined) {
    return { kind: 'outcome', outcome: { status: 'NOT_OBSERVABLE', evidence: `state-not-read:${query}@${at}` } };
  }
  return { kind: 'value', value };
}

/** Deep equality for plain JSON state values; an array never equals an object. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  return (
    aKeys.length === Object.keys(bRecord).length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key) && sameValue(aRecord[key], bRecord[key]))
  );
}
