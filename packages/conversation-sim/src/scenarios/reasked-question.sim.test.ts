import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions } from '../harness/assertions';
import { findReaskedQuestions } from '../harness/fidelity-checks';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';
import { REASKED_QUESTION_FIXTURE as FIXTURE } from './fidelity-fixtures';

/**
 * GC round 3 CAP-8 (T9): the employee states where the blocker sits and what they already did;
 * the coach must not ask the same thing again in other words.
 */
describe('CAP-8 answered question is not re-asked', () => {
  it('does not ask again where the blocker sits or whether the employee already escalated', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Olena' });

    const result = await run({
      name: FIXTURE.name,
      description: FIXTURE.description,
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({ model: judgeModel(), criteria: [...FIXTURE.judgeCriteria] }),
      ],
      script: [...FIXTURE.employeeTurns.flatMap((text) => [user(text), agentTurn()]), judge()],
      maxTurns: 6,
      setId: SET_ID,
    });

    await reportRun(FIXTURE.name, harness, result);

    expect(harness.replies).toHaveLength(FIXTURE.employeeTurns.length);
    harness.turns.forEach((turn, index) => {
      expect(turn.outcome, `turn ${index + 1} reply was not generated: ${turn.responseText}`).toBeUndefined();
    });

    // Deterministic: no question anywhere in the conversation asks for an answered detail.
    const reasked = findReaskedQuestions(harness.replies, FIXTURE.answeredDetails);
    expect(reasked, JSON.stringify(reasked, null, 2)).toEqual([]);
    expect(countQuestions(harness.replies[1] ?? '')).toBeLessThanOrEqual(1);

    // The resolved-details contract is the runtime path a repeated failure would be fixed through;
    // record what the classifier carried for the final turn so a miss can be placed in a layer.
    const finalPlan = harness.responseCallsByTurn[1]?.context.replyPlan;
    expect(finalPlan, 'final turn bypassed reply planning').toBeDefined();
    expect(finalPlan?.forbiddenMoves).toContain('unsupported_interpretation');

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
