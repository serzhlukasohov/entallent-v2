import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';
import { CHANGED_ADVICE_FIXTURE as FIXTURE } from './fidelity-fixtures';

/**
 * GC round 3 CAP-10 (T12): when the employee's new facts invalidate the coach's suggestion, the
 * revised suggestion names that it changed and why, instead of presenting it as the advice all along.
 */
describe('CAP-10 changed advice is named', () => {
  it('names the change of suggestion and the facts behind it', async () => {
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
    expect(countQuestions(harness.replies[1] ?? '')).toBeLessThanOrEqual(1);

    const finalPlan = harness.responseCallsByTurn[1]?.context.replyPlan;
    expect(finalPlan, 'final turn bypassed reply planning').toBeDefined();

    // Whether the change is named is semantic; the judge rubric owns it.
    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
