import { z } from 'zod';
import { parseEvaluatedAt, type CaseRun, type LoadedCriterion, type LoadedTest } from '../schema';
import { initiations } from '../rules/proactive';
import type { JudgeInput, JudgeTurn } from './criterion-judge';

/**
 * Builds the judge input for one meaning check (architecture AD-7), shared with 13.2
 * calibration so labels and runs see the same transcript shape.
 *
 * Transcript: the seed history in order, then per step the user text and, when the step
 * replied, `reply.text`. `reply:<n>` / `after-step:<n>` cover steps 1..n and evaluate step
 * n's reply; `conversation` covers every run step with `evaluatedReplyIndex: null`;
 * `observation-window` covers the window's bot-initiated messages (`windowScope`).
 */
export interface BuiltJudgeInput {
  input: JudgeInput;
  /**
   * Coach reply texts a PASS fragment must come from: step n's reply, or every run coach
   * reply for `conversation` (never seed turns). Empty means there is no reply to judge.
   */
  replyTexts: string[];
}

const UncoveredTopicsSchema = z.array(
  z.object({ topic: z.string(), canonicalQuestions: z.array(z.string()) }),
);

export function buildJudgeInput(test: LoadedTest, run: CaseRun, criterion: LoadedCriterion): BuiltJudgeInput {
  if (test.expectedBehavior === undefined) {
    throw new Error(`[suite] judge input: ${test.id} has no expectedBehavior (load the suite through loadSuite)`);
  }
  const at = parseEvaluatedAt(criterion.evaluatedAt);
  if (at.kind === 'observation-window') return windowJudgeInput(test, run, criterion, test.expectedBehavior);
  if (at.kind !== 'reply' && at.kind !== 'after-step' && at.kind !== 'conversation') {
    throw new Error(`[suite] judge input: ${test.id}/${criterion.id} is evaluated at ${criterion.evaluatedAt}, which the judge does not support`);
  }
  const lastStep = at.kind === 'conversation' ? run.steps.length : at.step;

  const turns: JudgeTurn[] = (test.seed?.history ?? []).map((turn) => ({ role: turn.role, text: turn.text }));
  const replyTexts: string[] = [];
  let evaluatedReplyIndex: number | null = null;
  for (const step of run.steps.slice(0, lastStep)) {
    turns.push({ role: 'user', text: step.userText });
    if (step.reply === null) continue;
    turns.push({ role: 'coach', text: step.reply.text });
    if (at.kind === 'conversation') replyTexts.push(step.reply.text);
    else if (step.index === lastStep) {
      evaluatedReplyIndex = turns.length - 1;
      replyTexts.push(step.reply.text);
    }
  }

  return {
    input: {
      transcript: { turns, evaluatedReplyIndex },
      expectedBehavior: test.expectedBehavior,
      passCondition: criterion.passCondition,
      judgeGuidance: criterion.judgeGuidance ?? null,
      layer: criterion.layer,
      fixtureContext: fixtureContext(test),
    },
    replyTexts,
  };
}

/**
 * An observation window: the seed history (the earlier conversation), then the window's
 * bot-initiated messages oldest first. `first` stops after the first one and evaluates it;
 * `all` evaluates every one (`evaluatedReplyIndex: null`, like `conversation`).
 */
function windowJudgeInput(test: LoadedTest, run: CaseRun, criterion: LoadedCriterion, expectedBehavior: string): BuiltJudgeInput {
  const turns: JudgeTurn[] = (test.seed?.history ?? []).map((turn) => ({ role: turn.role, text: turn.text }));
  const found = initiations(run);
  const sent = found.kind === 'initiations' ? found.messages : [];
  const scope = criterion.windowScope ?? 'all';
  const judged = scope === 'first' ? sent.slice(0, 1) : sent;
  for (const message of judged) turns.push({ role: 'coach', text: message.text });
  return {
    input: {
      transcript: { turns, evaluatedReplyIndex: scope === 'first' && judged.length > 0 ? turns.length - 1 : null },
      expectedBehavior,
      passCondition: criterion.passCondition,
      judgeGuidance: criterion.judgeGuidance ?? null,
      layer: criterion.layer,
      fixtureContext: fixtureContext(test),
    },
    replyTexts: judged.map((message) => message.text),
  };
}

/** `{ pulseCycle: { uncoveredTopics } }` when the `pulseCycle` fixture's params carry them, else null. */
export function fixtureContext(test: Pick<LoadedTest, 'setup'>): unknown | null {
  const pulse = test.setup.find((fixture) => fixture.name === 'pulseCycle');
  const parsed = UncoveredTopicsSchema.safeParse(pulse?.params?.uncoveredTopics);
  return parsed.success ? { pulseCycle: { uncoveredTopics: parsed.data } } : null;
}
