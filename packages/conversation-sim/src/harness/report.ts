import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, onTestFailed } from 'vitest';
import type { ScenarioResult } from '@langwatch/scenario';
import type { StyleDimensions } from '@entalent/application';
import { describeViolations, findViolations } from './assertions';
import { realNow } from './clock';
import { buildReportTurn, type ReportTurn, type TraceEvent } from '@entalent/conversation-trace';
import type { AgentTurnFailure, CoachHarness, QaRunSummary, ScenarioContext } from './coach-harness';

const RUNS_DIR = join(process.cwd(), 'runs');

export type JudgeResult = Pick<ScenarioResult, 'success' | 'metCriteria' | 'unmetCriteria' | 'reasoning'>;

/** Harnesses whose scenario already wrote its own report; the fallback finalizer skips them. */
const reportedHarnesses = new WeakSet<CoachHarness>();

export interface ScenarioRunReport {
  schemaVersion: 1;
  gateId: string | null;
  gateRunId: string | null;
  scenarioName: string;
  scenarioSlug: string;
  /** Vitest test that produced this run ("describe > test"), so a report can take its verdict from the test. */
  testName?: string | null;
  testFile?: string | null;
  runAt: string;
  gitSha: string | null;
  models: {
    coachBalanced: string | null;
    simulator: string | null;
    judge: string | null;
    azureTestingDeployment: string | null;
  };
  judge: {
    evaluated: boolean;
    passed: boolean;
    metCriteria: string[];
    unmetCriteria: string[];
    reasoning: string | null;
  };
  deterministic: {
    passed: boolean;
    violations: Array<{ turn: number; rule: string; detail: string }>;
  };
  /** What the conversation started from; absent in reports written before tracing existed. */
  context?: ScenarioContext;
  /** Employee message of every turn, including one that threw. */
  userMessages?: string[];
  /** Ordered model calls, writes, warnings and decisions per turn (see `harness/trace.ts`). */
  trace?: TraceEvent[];
  /** Exceptions that escaped the orchestrator; each is also an `agent-turn-error` violation. */
  agentTurnErrors?: AgentTurnFailure[];
  /** Present for a run of a QA test file: Jira, story, tags, expected results and hard checks with outcomes. */
  qa?: QaRunSummary;
  turns: ReportTurn[];
  memoryItems: Array<{
    category: string;
    content: string;
    importance: number;
    sensitivity: string;
  }>;
  styleProfile: {
    dimensions: StyleDimensions;
    adaptationWeight: number;
    conversationsAnalyzed: number;
  } | null;
}

/**
 * Records what the coach actually did. A judge verdict is only useful next to the
 * modes, lengths, memory and style the deterministic layer produced, so both land
 * in the console and in `runs/<scenario>.md` for reading after the fact.
 */
export async function reportRun(
  name: string,
  harness: CoachHarness,
  result: JudgeResult,
  judgeEvaluated = true,
): Promise<void> {
  reportedHarnesses.add(harness);
  const data = await buildReportData(name, harness, result, judgeEvaluated);
  writeScenarioRunReport(data);
}

export function writeScenarioRunReport(input: ScenarioRunReport): void {
  const data = structuredClone(input);
  const persist = persistReport(data);
  // Each report registers its own finalizer, including multiple reports in one test.
  // Paths belong to this attempt even if environment variables change afterward.
  onTestFailed(({ task }) => {
    appendTestFailure(data, task);
    persist();
  });
}

/**
 * Guarantees `runs/<scenario>.json` for a harness whose test fails before `reportRun` runs,
 * for example when the agent turn throws and `run()` rethrows. The report is named after the
 * Vitest test, carries whatever turns completed, every recorded `agent-turn-error`, and the
 * test error; the judge is marked not run. Outside a Vitest test nothing is registered.
 */
export function registerFallbackReport(harness: CoachHarness): void {
  try {
    onTestFailed(async ({ task }) => {
      if (reportedHarnesses.has(harness)) return;
      reportedHarnesses.add(harness);
      const ordinal = (fallbackReportsByTask.get(task) ?? 0) + 1;
      fallbackReportsByTask.set(task, ordinal);
      const name = ordinal === 1 ? fullTaskName(task) : `${fullTaskName(task)} harness ${ordinal}`;
      const data = await buildReportData(
        name,
        harness,
        { success: false, metCriteria: [], unmetCriteria: [], reasoning: 'Scenario aborted before reportRun.' },
        false,
      );
      appendTestFailure(data, task);
      persistReport(data)();
    });
  } catch {
    // Not inside a Vitest test (for example a script): there is no test failure to finalize on.
  }
}

interface TaskLike {
  name: string;
  suite?: TaskLike;
  result?: { errors?: Array<{ message: string }> };
}

const fallbackReportsByTask = new WeakMap<TaskLike, number>();

function fullTaskName(task: TaskLike): string {
  const names: string[] = [];
  for (let current: TaskLike | undefined = task; current; current = current.suite) {
    if (current.name) names.unshift(current.name);
  }
  return names.join(' ');
}

function appendTestFailure(data: ScenarioRunReport, task: TaskLike): void {
  data.deterministic.passed = false;
  data.deterministic.violations.push({
    turn: 0,
    rule: 'test-failure',
    detail: (task.result?.errors ?? []).map((error) => error.message).join('; ') || 'Vitest test failed',
  });
}

/** Prints the report and writes both files; the returned function re-persists the same paths. */
function persistReport(data: ScenarioRunReport): () => void {
  console.log(`\n${buildMarkdownReport(data)}`);

  const runsDir = process.env.SIM_GATE_REPORT_DIR ?? RUNS_DIR;
  mkdirSync(runsDir, { recursive: true });
  const fileStem = ownFileStem(runsDir, buildFileStem(data.scenarioSlug), data.testName ?? null);
  const markdownPath = join(runsDir, `${fileStem}.md`);
  const jsonPath = join(runsDir, `${fileStem}.json`);
  const persist = () => {
    writeFileSync(markdownPath, buildMarkdownReport(data), 'utf8');
    writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  };
  persist();
  return persist;
}

async function buildReportData(
  name: string,
  harness: CoachHarness,
  result: JudgeResult,
  judgeEvaluated: boolean,
): Promise<ScenarioRunReport> {
  const violations = [
    ...harness.failures.map((failure) => ({
      turn: failure.turn,
      rule: 'agent-turn-error',
      detail: `${failure.name}: ${failure.message}`,
    })),
    ...findViolations(harness),
  ];
  const profile = await harness.styleProfile();

  return {
    schemaVersion: 1,
    gateId: process.env.SIM_GATE_ID ?? null,
    gateRunId: process.env.SIM_GATE_RUN_ID ?? null,
    scenarioName: name,
    scenarioSlug: slugify(name),
    ...currentTest(),
    // Real time even under a precondition's shifted clock: the suite report selects runs by it.
    runAt: new Date(realNow()).toISOString(),
    gitSha: process.env.SIM_GATE_GIT_SHA ?? null,
    models: {
      coachBalanced: process.env.OPENAI_MODEL_BALANCED ?? null,
      simulator: process.env.SIM_SIMULATOR_MODEL ?? 'gpt-4o-mini',
      judge: process.env.SIM_JUDGE_MODEL ?? 'gpt-4o',
      azureTestingDeployment: process.env.AZURE_OPENAI_TESTING_DEPLOYMENT ?? null,
    },
    judge: {
      evaluated: judgeEvaluated,
      passed: result.success,
      metCriteria: result.metCriteria,
      unmetCriteria: result.unmetCriteria,
      reasoning: result.reasoning || null,
    },
    deterministic: {
      passed: violations.length === 0,
      violations,
    },
    context: harness.context,
    userMessages: [...harness.userMessages],
    trace: [...harness.trace.events],
    ...(harness.failures.length > 0 ? { agentTurnErrors: [...harness.failures] } : {}),
    ...(harness.qa ? { qa: harness.qa } : {}),
    turns: harness.turns.map((turn, index) => buildReportTurn(
      index + 1,
      turn,
      harness.responseCallsByTurn[index]?.context,
      harness.turnEffects[index] ?? null,
    )),
    memoryItems: harness.memoryItems.map((item) => ({
      category: item.category,
      content: item.content,
      importance: item.importance,
      sensitivity: item.sensitivity,
    })),
    styleProfile: profile
      ? {
          dimensions: profile.dimensions,
          adaptationWeight: profile.adaptationWeight,
          conversationsAnalyzed: profile.conversationsAnalyzed,
        }
      : null,
  };
}

function currentTest(): { testName: string | null; testFile: string | null } {
  try {
    const state = expect.getState();
    return { testName: state.currentTestName ?? null, testFile: state.testPath ?? null };
  } catch {
    return { testName: null, testFile: null };
  }
}

const RULE = '-'.repeat(60);

/**
 * Reads top to bottom like the conversation: the starting context, earlier turns as plain
 * dialogue, then the last turn with its full chain of events, then the verdict. Earlier turns
 * keep their chains in collapsed sections.
 */
export function buildMarkdownReport(data: ScenarioRunReport): string {
  const judgeVerdict = data.judge.evaluated ? (data.judge.passed ? 'PASS' : 'FAIL') : 'NOT RUN';
  const judgeCount = data.judge.evaluated
    ? ` (${data.judge.metCriteria.length}/${data.judge.metCriteria.length + data.judge.unmetCriteria.length} criteria met)`
    : '';
  const qaFailed = data.qa
    ? data.qa.hardChecks.some((check) => !check.met) || data.qa.expectations.some((e) => e.met !== true)
    : false;
  const passed = data.deterministic.passed && (!data.judge.evaluated || data.judge.passed) && !qaFailed;
  const userMessages = data.userMessages ?? [];
  const turnCount = Math.max(data.turns.length, userMessages.length);
  const lastTurn = turnCount;
  const sections = [
    `# ${data.scenarioName}`,
    '',
    `**Result: ${passed ? 'PASS' : 'FAIL'}** | judge: ${judgeVerdict}${judgeCount} | deterministic checks: `
      + `${data.deterministic.violations.length === 0 ? 'clear' : `${data.deterministic.violations.length} violation(s)`}`
      + (data.qa?.hardChecks.length
        ? ` | hard checks: ${data.qa.hardChecks.filter((check) => check.met).length}/${data.qa.hardChecks.length} met`
        : ''),
    `${data.runAt} | ${turnCount} turn(s) | coach ${data.models.coachBalanced ?? 'default'} | judge ${data.models.judge ?? 'n/a'}`
      + (data.gateId ? ` | gate ${data.gateId} sample ${data.gateRunId ?? 'unknown'}` : ''),
    '',
    '## Context',
    ...renderContext(data),
    '',
    RULE,
    ...(turnCount > 1
      ? Array.from({ length: turnCount - 1 }, (_, index) => renderDialogue(data, index + 1)).flat()
      : ['(no earlier messages)']),
    RULE,
    '',
    ...(turnCount > 0 ? [`## Turn ${lastTurn}`, '', ...renderTurn(data, lastTurn)] : ['No turn ran.']),
    '',
    '## Verdict',
    ...renderVerdict(data),
    ...(turnCount > 1
      ? [
          '',
          '## Earlier turns, step by step',
          ...Array.from({ length: turnCount - 1 }, (_, index) => [
            '',
            `<details><summary>Turn ${index + 1}</summary>`,
            '',
            ...renderTurn(data, index + 1),
            '',
            '</details>',
          ]).flat(),
        ]
      : []),
    '',
    '## After the run',
    `- Memory: ${data.memoryItems.length === 0 ? 'none' : ''}`,
    ...data.memoryItems.map((item) => `  - [${item.category}] ${item.content}`),
    ...renderScheduledActions(data),
    `- Style profile: ${data.styleProfile
      ? `${JSON.stringify(data.styleProfile.dimensions)}, weight ${data.styleProfile.adaptationWeight}`
      : 'not analysed'}`,
  ];
  return sections.join('\n');
}

function renderContext(data: ScenarioRunReport): string[] {
  if (!data.context) return ['(not recorded)'];
  const p = data.context.precondition;
  return [
    ...(p
      ? [
          `- Precondition: ${p.name} (${p.origin}${p.source ? `, ${p.source}` : ''})`,
          `  - presets: ${p.presets.length ? p.presets.join(', ') : 'none'}`,
          ...(p.onboarding ? [`  - onboarding: ${p.onboarding}`] : []),
          ...p.goals.map((goal) => `  - goal: ${goal}`),
          ...(p.cycle ? [`  - pulse cycle: ${p.cycle.open ? `${p.cycle.topicsClosed}/${p.cycle.topicsTotal} topics closed; ${p.cycle.topics.join('; ')}` : 'not open'}`] : []),
          ...p.evidence.map((item) => `  - evidence: ${item}`),
          ...p.scheduledActions.map((action) => `  - scheduled: ${action}`),
        ]
      : []),
    ...data.context.setup.map((fact) => `- ${fact}`),
    `- Seeded memory: ${data.context.memory.length === 0 ? 'none' : ''}`,
    ...data.context.memory.map((item) => `  - [${item.category}] ${item.content}`),
    ...(data.context.messages.length > 0
      ? ['- Seeded history:', ...data.context.messages.map((message) => `  - ${message.direction}: ${message.text}`)]
      : []),
  ];
}

function renderDialogue(data: ScenarioRunReport, turn: number): string[] {
  const reply = data.turns[turn - 1]?.responseText;
  return [
    `**User:** ${data.userMessages?.[turn - 1] ?? '(not recorded)'}`,
    `**Bot:** ${reply ?? '(no reply: the turn failed)'}`,
    '',
  ];
}

const EVENT_LABEL: Record<TraceEvent['kind'], string> = {
  inbound: 'IN',
  llm: 'LLM',
  write: 'DB',
  queue: 'QUEUE',
  warning: 'WARN',
  error: 'ERROR',
  decision: 'DECISION',
};

function renderTurn(data: ScenarioRunReport, turn: number): string[] {
  const events = (data.trace ?? []).filter((event) => event.turn === turn);
  const writes = events.filter((event) => event.kind === 'write');
  const reply = data.turns[turn - 1]?.responseText;
  const violations = data.deterministic.violations.filter((violation) => violation.turn === turn);
  return [
    `**User:** ${data.userMessages?.[turn - 1] ?? '(not recorded)'}`,
    '',
    ...(events.length === 0
      ? ['(no events recorded)']
      : events.map((event, index) =>
          `${index + 1}. **${EVENT_LABEL[event.kind]}** \`${event.name}\`${event.summary ? ` -> ${event.summary}` : ''}`)),
    '',
    renderReplyPlan(data, turn),
    '',
    `**Bot:** ${reply ?? '(no reply: the turn failed)'}`,
    '',
    `Written to storage: ${describeCounts(writes)}`,
    `Queued jobs: ${describeCounts(events.filter((event) => event.kind === 'queue'))}`,
    `Checks: ${violations.length === 0 ? 'clear' : violations.map((violation) => `${violation.rule}: ${violation.detail}`).join('; ')}`,
  ];
}

/** The plan the reply was generated from; `none` when the reply bypassed the model. */
function renderReplyPlan(data: ScenarioRunReport, turn: number): string {
  const report = data.turns[turn - 1];
  if (!report) return `Reply plan [turn ${turn}]: none (the turn failed)`;
  const plan = report.replyPlan ?? report.replyBrief;
  const label = `Reply plan [turn ${turn}, ${report.primaryIntent}]`;
  if (!plan) return `${label}: none`;
  const memoryAnchors = plan.memoryAnchors.map((item) => item.content).join(' | ') || 'none';
  const requiredGrounding = plan.requiredGrounding.map((item) => item.content).join(' | ') || 'none';
  return `${label}: ${plan.dialogueAct}/${plan.responseMove}, substance=${plan.latestUserSubstance ?? 'none'}, `
    + `anchor=${plan.topicAnchor ?? 'none'}, memoryAnchors=${memoryAnchors}, requiredGrounding=${requiredGrounding}, `
    + `questions=${plan.questionPolicy.maxQuestions}, inferFromBrevity=${plan.mayInferFromBrevity}`;
}

/** Reminders and other scheduled actions, read from the trace so older reports still render. */
function renderScheduledActions(data: ScenarioRunReport): string[] {
  if (!data.trace) return [];
  const saved = data.trace.filter((event) => event.name === 'scheduledActions.save');
  return [
    `- Scheduled actions: ${saved.length === 0 ? 'none' : ''}`,
    ...saved.map((event) => `  - turn ${event.turn}: ${event.summary}`),
  ];
}

function renderVerdict(data: ScenarioRunReport): string[] {
  const judge = data.judge.evaluated
    ? [
        ...data.judge.metCriteria.map((criterion) => `- [met] ${criterion}`),
        ...data.judge.unmetCriteria.map((criterion) => `- [UNMET] ${criterion}`),
        ...(data.judge.reasoning ? ['', `Judge reasoning: ${data.judge.reasoning}`] : []),
      ]
    : ['- judge not run'];
  const deterministic = data.deterministic.violations.length === 0
    ? ['- deterministic checks: clear']
    : [`- deterministic checks:\n${describeViolations(data.deterministic.violations) || 'failed'}`];
  const errors = (data.agentTurnErrors ?? []).flatMap((failure) => [
    `- turn ${failure.turn} threw ${failure.name}: ${failure.message} (${failure.generationCalls} generation calls before the throw)`,
    ...(failure.stack ? [trimStack(failure.stack)] : []),
  ]);
  const qa = data.qa
    ? [
        '',
        `QA test ${data.qa.id}${data.qa.jira ? ` (${data.qa.jira})` : ''}:`,
        ...data.qa.expectations.map((e) => `- [${e.met === true ? 'met' : e.met === false ? 'UNMET' : 'NOT JUDGED'}] ${e.text}`),
        ...data.qa.hardChecks.map((c) => `- [${c.met ? 'met' : 'UNMET'}] hard check: ${c.label} -> ${c.actual}`),
      ]
    : [];
  return [...judge, '', ...deterministic, ...errors, ...qa];
}

function describeCounts(events: TraceEvent[]): string {
  if (events.length === 0) return 'nothing';
  return Object.entries(countBy(events.map((event) => event.name))).map(([name, count]) => `${name} x${count}`).join(', ');
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function trimStack(stack: string): string {
  return stack.split('\n').slice(0, 8).map((line) => `    ${line.trim()}`).join('\n');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Several tests can share one scenario name (an `it.each` over prompts, say). The report file of a
 * different test is never overwritten: the second test's file gets its test name appended.
 */
function ownFileStem(runsDir: string, stem: string, testName: string | null): string {
  const path = join(runsDir, `${stem}.json`);
  if (!testName || !existsSync(path)) return stem;
  try {
    const owner = (JSON.parse(readFileSync(path, 'utf8')) as Partial<ScenarioRunReport>).testName;
    return !owner || owner === testName ? stem : `${stem}--${slugify(testName).slice(0, 80)}`;
  } catch {
    return stem;
  }
}

function buildFileStem(scenarioSlug: string): string {
  const runId = process.env.SIM_GATE_RUN_ID;
  return runId ? `${scenarioSlug}-${slugify(runId)}` : scenarioSlug;
}
