import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

const OUTLINE_REQUEST =
  'I have a 30-minute 1:1 with my lead tomorrow to raise the code-review delays that keep blocking me. Give me an outline with timings, a list with time slots please.';

/**
 * GC round 3 CAP-9 (T11): an explicit request for an outline with time slots is answered in
 * that shape, one item per line with its slot, instead of one prose paragraph followed by an
 * offer to produce the outline.
 */
describe('CAP-9 explicit format request is honored', () => {
  it('answers an outline-with-timings request as separated items with time slots', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Olena' });
    const scenarioName = 'CAP-9 outline with time slots';

    const result = await run({
      name: scenarioName,
      description:
        'An employee asks for an outline with timings, as a list with time slots, for a 30-minute 1:1 about code-review delays.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The reply is laid out as separate items, one per line, not as a single prose paragraph',
            'Each item carries a time slot or a duration (for example "0-5 min" or "10 min") that together fit a 30-minute meeting',
            'The items are about raising the code-review delays with the lead, not generic meeting advice',
            'The reply does not offer to produce the outline or another format afterwards; it simply gives the outline',
          ],
        }),
      ],
      script: [user(OUTLINE_REQUEST), agentTurn(), judge()],
      maxTurns: 3,
      setId: SET_ID,
    });

    await reportRun(scenarioName, harness, result);

    const reply = harness.replies[0] ?? '';
    expect(harness.turns[0]?.outcome, `reply was not generated: ${reply}`).toBeUndefined();

    // The typed path: the classifier reported the format request and the plan carried it.
    const plan = harness.responseCallsByTurn[0]?.context.replyPlan;
    expect(plan?.formatRequest, `reply plan: ${JSON.stringify(plan)}`).not.toBeNull();
    expect(plan?.formatRequest).toBeDefined();
    expect(plan?.responseMove).toBe('answer_request');

    // Structural shape: at least three separated lines; whether each is a slotted item is the judge's call.
    const lines = reply.split('\n').map((line) => line.trim()).filter(Boolean);
    expect(lines.length, `reply lines:\n${reply}`).toBeGreaterThanOrEqual(3);

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
