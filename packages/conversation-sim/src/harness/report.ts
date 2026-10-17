import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onTestFailed } from 'vitest';
import type { ScenarioResult } from '@langwatch/scenario';
import type { StyleDimensions } from '@entalent/application';
import { describeViolations, findViolations } from './assertions';
import type { AgentTurnFailure, CoachHarness, GenerateResponseCall } from './coach-harness';

const RUNS_DIR = join(process.cwd(), 'runs');

type JudgeResult = Pick<ScenarioResult, 'success' | 'metCriteria' | 'unmetCriteria' | 'reasoning'>;

/** Harnesses whose scenario already wrote its own report; the fallback finalizer skips them. */
const reportedHarnesses = new WeakSet<CoachHarness>();

export interface ScenarioRunReport {
  schemaVersion: 1;
  gateId: string | null;
  gateRunId: string | null;
  scenarioName: string;
  scenarioSlug: string;
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
  /** Exceptions that escaped the orchestrator; each is also an `agent-turn-error` violation. */
  agentTurnErrors?: AgentTurnFailure[];
  turns: Array<{
    index: number;
    mode: string;
    primaryIntent: string;
    requiresSafetyCheck: boolean;
    risk: { severity: string; type: string | null };
    responseLength: number;
    responseText: string;
    replyPlan: GenerateResponseCall['context']['replyPlan'] | null;
    replyBrief: GenerateResponseCall['context']['replyBrief'] | null;
  }>;
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
  result: ScenarioResult,
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
  const fileStem = buildFileStem(data.scenarioSlug);
  mkdirSync(runsDir, { recursive: true });
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
    runAt: new Date().toISOString(),
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
    ...(harness.failures.length > 0 ? { agentTurnErrors: [...harness.failures] } : {}),
    turns: harness.turns.map((turn, index) => ({
      index: index + 1,
      mode: turn.mode,
      primaryIntent: turn.classification.primaryIntent,
      requiresSafetyCheck: turn.classification.requiresSafetyCheck,
      risk: {
        severity: turn.risk.severity,
        type: turn.risk.riskType,
      },
      responseLength: turn.responseText.length,
      responseText: turn.responseText,
      replyPlan: harness.responseCallsByTurn[index]?.context.replyPlan ?? null,
      replyBrief: harness.responseCallsByTurn[index]?.context.replyBrief ?? null,
    })),
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

function buildMarkdownReport(data: ScenarioRunReport): string {
  const lengths = data.turns.map((turn) => turn.responseLength);
  const gateLine = data.gateId ? `Gate ${data.gateId} · sample ${data.gateRunId ?? 'unknown'}` : '';
  const judgeVerdict = data.judge.evaluated ? (data.judge.passed ? 'PASS' : 'FAIL') : 'NOT RUN';
  const sections = [
    `# ${data.scenarioName}`,
    `Run at ${data.runAt} · ${data.turns.length} turns · judge verdict: ${judgeVerdict}`,
    ...(gateLine ? [gateLine] : []),
    '',
    '## Judge',
    ...(data.judge.evaluated ? data.judge.metCriteria.map((c) => `- met: ${c}`) : ['not run']),
    ...data.judge.unmetCriteria.map((c) => `- UNMET: ${c}`),
    data.judge.reasoning ? `\n${data.judge.reasoning}` : '',
    '',
    '## Deterministic checks',
    data.deterministic.passed && data.deterministic.violations.length === 0
      ? 'all clear'
      : describeViolations(data.deterministic.violations) || 'deterministic checks failed',
    '',
    ...(data.agentTurnErrors?.length
      ? [
          '## Agent turn errors',
          ...data.agentTurnErrors.flatMap((failure) => [
            `turn ${failure.turn} — ${failure.name}: ${failure.message} (${failure.generationCalls} generation calls before the throw)`,
            ...(failure.stack ? [trimStack(failure.stack)] : []),
          ]),
          '',
        ]
      : []),
    '## Turns',
    `reply lengths: ${lengths.join(', ')}`,
    '',
    ...data.turns.flatMap((turn) => {
      const risk = turn.risk.severity === 'none' ? '' : ` risk=${turn.risk.severity}`;
      const plan = turn.replyPlan ?? turn.replyBrief;
      const memoryAnchors = plan?.memoryAnchors.map((item) => item.content).join(' | ') || 'none';
      const requiredGrounding = plan?.requiredGrounding.map((item) => item.content).join(' | ') || 'none';
      const planLine = plan
        ? `replyPlan=${plan.dialogueAct}/${plan.responseMove} substance=${plan.latestUserSubstance ?? 'none'} anchor=${plan.topicAnchor ?? 'none'} memoryAnchors=${memoryAnchors} requiredGrounding=${requiredGrounding} questions=${plan.questionPolicy.maxQuestions} inferFromBrevity=${plan.mayInferFromBrevity}`
        : 'replyPlan=none';
      return [
        `**${turn.index}. [${turn.mode} / ${turn.primaryIntent}${risk}] ${turn.responseLength} chars**`,
        planLine,
        turn.responseText,
        '',
      ];
    }),
    '## Memory extracted',
    data.memoryItems.length === 0
      ? 'none'
      : data.memoryItems.map((item) => `- [${item.category}] ${item.content}`).join('\n'),
    '',
    '## Style profile',
    data.styleProfile
      ? `${JSON.stringify(data.styleProfile.dimensions)} · weight ${data.styleProfile.adaptationWeight}`
      : 'not analysed (analyzeStyle is off for this scenario)',
  ];

  return sections.join('\n');
}

function trimStack(stack: string): string {
  return stack.split('\n').slice(0, 8).map((line) => `    ${line.trim()}`).join('\n');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildFileStem(scenarioSlug: string): string {
  const runId = process.env.SIM_GATE_RUN_ID;
  return runId ? `${scenarioSlug}-${slugify(runId)}` : scenarioSlug;
}
