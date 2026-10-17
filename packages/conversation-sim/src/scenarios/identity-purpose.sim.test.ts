import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

/**
 * GC round 3 CAP-7 (T8): asked who it is and what it does here, the coach names both of its
 * roles, private support and the confirmed, de-identified team pulse, instead of presenting
 * itself as a generic writing assistant.
 */
describe('CAP-7 identity and purpose', () => {
  it.each([
    'Who are you, and what do you do here in our workspace?',
    'Before I get into the retro points, a quick question: what exactly are you, and what is your purpose here? Why are you talking to me at all?',
  ])('names the support and team-pulse roles when asked: %s', async (question) => {
    const { agent, harness } = createCoachAgent({ userName: 'Olena' });
    const scenarioName = 'CAP-7 identity and purpose';

    const result = await run({
      name: scenarioName,
      description: 'An employee asks the coach who it is and why it is talking to them.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The coach says it is EnTalent or an AI work companion for talking through work privately',
            'The coach says it also collects a team pulse: a de-identified summary that only counts after the employee has seen and confirmed it',
            'The coach does not present itself as a generic writing, productivity, or chat assistant',
            'The coach answers the question directly and does not deflect or refuse',
          ],
        }),
      ],
      script: [user(question), agentTurn(), judge()],
      maxTurns: 3,
      setId: SET_ID,
    });

    await reportRun(scenarioName, harness, result);

    const reply = harness.replies[0] ?? '';
    expect(harness.turns[0]?.outcome, `reply was not generated: ${reply}`).toBeUndefined();
    expect(reply).toMatch(/pulse/i);
    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
