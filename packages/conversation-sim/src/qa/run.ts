import { relative } from 'node:path';
import type { AiProviderPort } from '@entalent/application';
import { expect } from 'vitest';
import { expectJudgeVerdict } from '../harness/judge-verdict';
import type { CoachHarness, QaRunSummary } from '../harness/coach-harness';
import { reportRun } from '../harness/report';
import { harnessFromPrecondition } from '../preconditions/load';
import { evaluateHardChecks, runViewOf, type HardCheckResult } from './hard-checks';
import type { QaTest } from './load';

/** What a driver gets: the replies to send through the harness and the expectations to judge. */
export interface QaConversation {
  name: string;
  /** Test title, precondition name and the last seeded messages, so the judge knows the context. */
  description: string;
  replies: string[];
  expected: string[];
  send(text: string): Promise<string>;
}

export interface QaVerdict {
  /** False when no judge ran (no expectations, scripted without a verdict, or the run broke first). */
  evaluated: boolean;
  success: boolean;
  metCriteria: string[];
  unmetCriteria: string[];
  reasoning: string | null;
}

/** Sends every reply in order through `send`, then judges the expectations. */
export type QaDriver = (conversation: QaConversation) => Promise<QaVerdict>;

export const NOT_JUDGED: QaVerdict = { evaluated: false, success: false, metCriteria: [], unmetCriteria: [], reasoning: null };

/**
 * Driver for framework tests: sends the replies itself and asks `judge` (code, not a model) for the
 * verdict. Without `judge` the expectations stay unjudged.
 */
export function scriptedQaDriver(
  judge?: (replies: string[], expected: string[]) => { met: string[]; unmet: string[]; reasoning?: string },
): QaDriver {
  return async (conversation) => {
    const replies: string[] = [];
    for (const text of conversation.replies) replies.push(await conversation.send(text));
    if (!judge || conversation.expected.length === 0) return NOT_JUDGED;
    const verdict = judge(replies, conversation.expected);
    return {
      evaluated: true,
      success: verdict.unmet.length === 0,
      metCriteria: verdict.met,
      unmetCriteria: verdict.unmet,
      reasoning: verdict.reasoning ?? null,
    };
  };
}

export interface QaRunResult {
  harness: CoachHarness;
  verdict: QaVerdict;
  summary: QaRunSummary;
  hardChecks: HardCheckResult[];
}

/**
 * Runs one QA test: builds the harness from its precondition, lets the driver send the replies and
 * judge the expectations, evaluates the hard checks, and writes the run report before anything is
 * asserted, so a failing test's report still shows every expectation and check. A turn error is
 * rethrown after the report is written.
 */
export async function runQaTest(
  test: QaTest,
  options: { driver: QaDriver; aiProvider?: AiProviderPort },
): Promise<QaRunResult> {
  const harness = await harnessFromPrecondition(test.resolvedPrecondition, options.aiProvider ? { aiProvider: options.aiProvider } : {});
  const summary: QaRunSummary = {
    file: displayPath(test.source),
    id: test.id,
    title: test.title,
    jira: test.jira ?? null,
    story: test.story ?? null,
    tags: [...test.tags],
    precondition: test.precondition,
    expectations: test.expected.map((text) => ({ text, met: null })),
    hardChecks: [],
  };
  // Set before driving so a report written on an early failure still names the test.
  harness.qa = summary;

  let verdict = NOT_JUDGED;
  let error: unknown = null;
  try {
    verdict = await options.driver({
      name: `QA ${test.id}`,
      description: judgeDescription(test, harness),
      replies: test.replies,
      expected: test.expected,
      send: (text) => harness.send(text),
    });
  } catch (caught) {
    error = caught;
  }

  const hardChecks = evaluateHardChecks(test.hardChecks, runViewOf(harness));
  summary.expectations = test.expected.map((text) => ({ text, met: verdict.evaluated ? verdictFor(text, verdict) : null }));
  summary.hardChecks = hardChecks;
  await reportRun(`QA ${test.id}`, harness, { ...verdict, reasoning: verdict.reasoning ?? undefined }, verdict.evaluated);

  if (error !== null) throw error;
  return { harness, verdict, summary, hardChecks };
}

const normalize = (text: string) => text.trim().toLowerCase().replace(/[.\s]+$/, '');

/**
 * The judge echoes each criterion. A line it did not echo counts as met when the judge passed the
 * run (a pass means every criterion held) and stays unjudged (null) otherwise.
 */
function verdictFor(text: string, verdict: QaVerdict): boolean | null {
  const key = normalize(text);
  if (verdict.metCriteria.some((c) => normalize(c) === key)) return true;
  if (verdict.unmetCriteria.some((c) => normalize(c) === key)) return false;
  return verdict.success ? true : null;
}

/**
 * What fails a QA test, asserted after the report is written: a failed turn, any failed hard check,
 * and (when the file has expectations) the judge verdict. Hard-check failures are asserted together
 * so the Vitest message lists every one.
 */
export function assertQaRun(test: QaTest, result: QaRunResult): void {
  expect(result.harness.failures.map((failure) => `${failure.name}: ${failure.message}`), 'every turn completes').toEqual([]);
  const failed = result.hardChecks.filter((check) => !check.met).map((check) => `${check.label}: ${check.actual}`);
  expect(failed, 'hard checks').toEqual([]);
  if (test.expected.length > 0) {
    expectJudgeVerdict({ ...result.verdict, reasoning: result.verdict.reasoning ?? undefined }, `QA ${test.id}`);
  }
}

function judgeDescription(test: QaTest, harness: CoachHarness): string {
  const history = harness.context.messages
    .slice(-6)
    .map((message) => `${message.direction === 'inbound' ? 'employee' : 'bot'}: ${message.text}`);
  const p = harness.context.precondition;
  const memory = harness.context.memory.map((item) => item.content);
  return [
    `QA test: ${test.title}.`,
    `Starting state: precondition ${test.resolvedPrecondition.name}.`,
    p?.onboarding ? `Onboarding: ${p.onboarding}.` : null,
    p?.cycle ? (p.cycle.open
      ? `Pulse check-in cycle open: ${p.cycle.topicsClosed} of ${p.cycle.topicsTotal} topics closed; open topics: ${p.cycle.openTopics.join(', ') || 'none'}.`
      : 'No pulse check-in cycle is open.') : null,
    memory.length ? `Known about the employee: ${memory.join('; ')}.` : null,
    p?.goals.length ? `Goals: ${p.goals.join('; ')}.` : null,
    p?.scheduledActions.length ? `Pending: ${p.scheduledActions.join('; ')}.` : null,
    history.length ? `Earlier in this conversation (before the test): ${history.join(' | ')}` : null,
  ].filter(Boolean).join(' ');
}

function displayPath(path: string): string {
  const fromPackage = relative(`${__dirname}/../..`, path);
  return fromPackage.startsWith('..') ? path : fromPackage;
}
