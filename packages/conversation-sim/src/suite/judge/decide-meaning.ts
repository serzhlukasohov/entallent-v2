import type { JudgeUsage } from '../schema';
import {
  addJudgeUsage,
  emptyJudgeUsage,
  evidenceMatches,
  type CriterionJudge,
  type JudgeErrorReason,
  type JudgeInput,
  type MeaningOutcome,
} from './criterion-judge';

/**
 * The meaning decision for one judge input (architecture AD-7), shared by `evaluate` and
 * `suite:calibrate` so labels are judged exactly as runs are: one call, a single re-ask
 * when a PASS carries no verbatim fragment of `replyTexts`, then ERROR
 * `judge-invalid-output`; a rejecting judge is ERROR `judge-transport`. FAIL evidence is
 * kept only when it is a verbatim fragment, so an invented quote is never recorded.
 * Callers handle the no-reply case (empty `replyTexts`) before calling.
 */
export type MeaningDecision =
  | { status: 'PASS' | 'FAIL'; reason: string; evidence: string | null; usage: JudgeUsage }
  | { status: 'ERROR'; reason: JudgeErrorReason; message: string; usage: JudgeUsage };

const INVALID_EVIDENCE = 'PASS evidence is missing or is not a verbatim fragment of the evaluated reply';

export async function decideMeaning(judge: CriterionJudge, input: JudgeInput, replyTexts: readonly string[]): Promise<MeaningDecision> {
  let outcome = await callJudge(judge, input, false);
  let usage = outcome.usage;
  if (outcome.status === 'PASS' && !evidenceMatches(outcome.evidence, replyTexts)) {
    outcome = await callJudge(judge, input, true);
    usage = addJudgeUsage(usage, outcome.usage);
    if (outcome.status === 'PASS' && !evidenceMatches(outcome.evidence, replyTexts)) {
      outcome = { status: 'ERROR', reason: 'judge-invalid-output', message: INVALID_EVIDENCE, usage };
    }
  }

  if (outcome.status === 'ERROR') {
    return { status: 'ERROR', reason: outcome.reason, message: outcome.message, usage };
  }
  const verified = outcome.status === 'PASS' || evidenceMatches(outcome.evidence, replyTexts);
  return { status: outcome.status, reason: outcome.reason, evidence: verified ? outcome.evidence : null, usage };
}

/** A rejecting `CriterionJudge` is a transport failure of that criterion only. */
async function callJudge(judge: CriterionJudge, input: JudgeInput, reask: boolean): Promise<MeaningOutcome> {
  try {
    return await judge(input, reask ? { reask: true } : undefined);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { status: 'ERROR', reason: 'judge-transport', message, usage: emptyJudgeUsage() };
  }
}
