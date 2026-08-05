import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from '@langwatch/scenario';
import type { StyleDimensions } from '@entalent/application';
import { describeViolations, findViolations } from './assertions';
import type { CoachHarness, GenerateResponseCall } from './coach-harness';

const RUNS_DIR = join(process.cwd(), 'runs');

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
  const data = await buildReportData(name, harness, result, judgeEvaluated);
  writeScenarioRunReport(data);
}

export function writeScenarioRunReport(data: ScenarioRunReport): void {
  const report = buildMarkdownReport(data);
  console.log(`\n${report}`);

  const runsDir = process.env.SIM_GATE_REPORT_DIR ?? RUNS_DIR;
  const fileStem = buildFileStem(data.scenarioSlug);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${fileStem}.md`), report, 'utf8');
  writeFileSync(join(runsDir, `${fileStem}.json`), JSON.stringify(data, null, 2), 'utf8');
}

async function buildReportData(
  name: string,
  harness: CoachHarness,
  result: ScenarioResult,
  judgeEvaluated: boolean,
): Promise<ScenarioRunReport> {
  const violations = findViolations(harness);
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
      replyPlan: harness.generateResponseCalls[index]?.context.replyPlan ?? null,
      replyBrief: harness.generateResponseCalls[index]?.context.replyBrief ?? null,
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
    data.deterministic.violations.length === 0
      ? 'all clear'
      : describeViolations(data.deterministic.violations),
    '',
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

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildFileStem(scenarioSlug: string): string {
  const runId = process.env.SIM_GATE_RUN_ID;
  return runId ? `${scenarioSlug}-${slugify(runId)}` : scenarioSlug;
}
