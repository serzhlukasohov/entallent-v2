import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { BASE_STYLE } from '@entalent/application';
import { buildRespondSystemPrompt } from '@entalent/ai-openai';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions, describeViolations, findViolations } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

const STYLE_WEIGHT_CAP = 0.4;

/**
 * Style mirroring is cross-conversation. The first conversation verifies that the
 * profile learns a terse style; a fresh follow-up conversation verifies that the
 * learned profile is available to reply generation. This does not assert that the
 * agent must shorten inside the same conversation.
 */
describe('coach talking to a consistently terse user', () => {
  it('learns a bounded terse style profile and applies it on the next conversation', async () => {
    const { agent: learningAgent, harness: learningHarness } = createCoachAgent({
      userName: 'Dima',
      analyzeStyle: true,
    });

    const learningResult = await run({
      name: 'terse user style learning',
      description: 'Dima answers extremely briefly. This run should teach a bounded style profile.',
      agents: [
        learningAgent,
        // Every user turn here is scripted; the simulator only satisfies Scenario's
        // requirement that a user-role agent exists.
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The coach treats short answers as normal and does not comment on their brevity',
            'The coach asks no more than one question per message',
          ],
        }),
      ],
      script: [
        user('hey'),
        agentTurn(),
        user('fine'),
        agentTurn(),
        user('shipped the release'),
        agentTurn(),
        user('yeah'),
        agentTurn(),
        user('tired'),
        agentTurn(),
        user('a bit'),
        agentTurn(),
        user('over the weekend'),
        agentTurn(),
        user('ok'),
        agentTurn(),
        judge(),
      ],
      maxTurns: 20,
      setId: SET_ID,
    });

    await reportRun('terse user learning', learningHarness, learningResult);

    const learningViolations = findViolations(learningHarness);
    expect(describeViolations(learningViolations)).toBe('');

    const learnedProfile = await learningHarness.styleProfile();
    expect(learnedProfile, 'style analysis never produced a profile').not.toBeNull();
    expect(learnedProfile!.conversationsAnalyzed).toBeGreaterThan(0);
    expect(learnedProfile!.adaptationWeight).toBeGreaterThan(0);
    expect(learnedProfile!.adaptationWeight).toBeLessThanOrEqual(STYLE_WEIGHT_CAP);
    expect(1 - learnedProfile!.adaptationWeight).toBeGreaterThanOrEqual(0.6);
    expect(learnedProfile!.dimensions.verbosity).toBeLessThan(BASE_STYLE.verbosity);

    const effectiveVerbosity =
      BASE_STYLE.verbosity * (1 - learnedProfile!.adaptationWeight) +
      learnedProfile!.dimensions.verbosity * learnedProfile!.adaptationWeight;
    expect(effectiveVerbosity).toBeLessThan(BASE_STYLE.verbosity);

    const noSubstanceLearningCalls = learningHarness.generateResponseCalls.filter(
      (call) => call.context.replyPlan?.latestUserSubstance === null,
    );
    expect(
      noSubstanceLearningCalls.length,
      `reply plans: ${learningHarness.generateResponseCalls.map((call) => JSON.stringify(call.context.replyPlan)).join('\n')}`,
    ).toBeGreaterThan(0);
    expect(noSubstanceLearningCalls.every((call) => call.context.replyPlan?.mayInferFromBrevity === false)).toBe(true);
    expect(noSubstanceLearningCalls.every((call) => call.context.replyPlan?.questionPolicy.maxQuestions === 0)).toBe(true);

    if (!learningResult.success) {
      console.warn(`[terse-user:learning] judge did not pass this sample: ${learningResult.reasoning}`);
    }

    const { agent: followupAgent, harness: followupHarness } = createCoachAgent({
      userName: 'Dima',
      seedStyleProfile: learnedProfile!,
    });

    const followupResult = await run({
      name: 'terse user next conversation',
      description: 'A later conversation starts with the previously learned terse profile.',
      agents: [
        followupAgent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The coach keeps a normal colleague tone rather than mimicking one-word answers',
            'At least one coach message is a statement with no question',
            'The coach does not comment out loud on how few words the person uses',
          ],
        }),
      ],
      script: [
        user('back'),
        agentTurn(),
        user('same issue'),
        agentTurn(),
        user('blocked again'),
        agentTurn(),
        user('ok'),
        agentTurn(),
        judge(),
      ],
      maxTurns: 12,
      setId: SET_ID,
    });

    await reportRun('terse user next conversation', followupHarness, followupResult);

    const violations = findViolations(followupHarness);
    expect(describeViolations(violations)).toBe('');

    const firstGeneration = followupHarness.generateResponseCalls[0];
    expect(firstGeneration.context.styleAdaptation).toMatchObject({
      dimensions: { verbosity: learnedProfile!.dimensions.verbosity },
      weight: learnedProfile!.adaptationWeight,
    });

    const prompt = buildRespondSystemPrompt(firstGeneration.strategy, firstGeneration.context);
    expect(prompt).toContain('Style adaptation');
    expect(prompt).toContain('base persona stays PRIMARY');
    expect(prompt).toContain('bounded (≤40%)');
    expect(prompt).toMatch(/shorter|short and clipped/i);

    const noSubstanceFollowupCalls = followupHarness.generateResponseCalls.filter(
      (call) => call.context.replyPlan?.latestUserSubstance === null,
    );
    expect(
      noSubstanceFollowupCalls.length,
      `reply plans: ${followupHarness.generateResponseCalls.map((call) => JSON.stringify(call.context.replyPlan)).join('\n')}`,
    ).toBeGreaterThan(0);
    expect(noSubstanceFollowupCalls.every((call) => call.context.replyPlan?.questionPolicy.maxQuestions === 0)).toBe(true);
    const noSubstancePrompt = buildRespondSystemPrompt(
      noSubstanceFollowupCalls[0].strategy,
      noSubstanceFollowupCalls[0].context,
    );
    expect(noSubstancePrompt).toContain('Latest employee substance: omitted because the typed pause act controls this turn');
    expect(noSubstancePrompt).toContain('Question policy (hard contract): ask zero questions this turn');
    expect(noSubstancePrompt).toMatch(/Do not infer mood, impatience, depth, personality, or unstated meaning/i);

    const questionCounts = followupHarness.replies.map(countQuestions);
    expect(
      questionCounts.some((count) => count === 0),
      `question counts: ${questionCounts.join(', ')}`,
    ).toBe(true);

    if (!followupResult.success) {
      console.warn(`[terse-user:next] judge did not pass this sample: ${followupResult.reasoning}`);
    }
  });
});
