import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

/**
 * GC round 3 CAP-7 (T10): a request that needs a capability the coach lacks (fetching links)
 * is declined upfront, in the first sentence, not after "I can, but I need one detail first".
 */
describe('CAP-7 capability limits', () => {
  it('declines a link-fetching request in the first sentence and offers what it can do', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Olena' });
    const scenarioName = 'CAP-7 link request declined upfront';

    const result = await run({
      name: scenarioName,
      description: 'An employee asks the coach to find a Udemy course link.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The first sentence of the reply says the coach cannot find, fetch, or open links',
            'The coach never claims it can find the link, and it does not ask for a detail before admitting it cannot; a follow-up question after the admission is fine',
            'The coach offers something it can actually do from this conversation, such as helping choose what to look for',
            'The reply contains no invented URL',
          ],
        }),
      ],
      script: [
        user('Can you find me a link to a good Udemy course on giving feedback to a senior colleague?'),
        agentTurn(),
        judge(),
      ],
      maxTurns: 3,
      setId: SET_ID,
    });

    await reportRun(scenarioName, harness, result);

    const reply = harness.replies[0] ?? '';
    expect(harness.turns[0]?.outcome, `reply was not generated: ${reply}`).toBeUndefined();
    expect(reply).not.toMatch(/https?:\/\//i);
    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
