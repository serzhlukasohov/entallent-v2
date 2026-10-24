import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { findUnstatedEmotionWords } from '../harness/fidelity-checks';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';
import { SENTIMENT_AMPLIFICATION_FIXTURE as FIXTURE } from './fidelity-fixtures';

/**
 * GC round 3 CAP-8 (T13): a neutral report of a rejected proposal must not come back with
 * emotional weight the employee did not state ("particularly unfair" in the tester's transcript).
 */
describe('CAP-8 sentiment is not amplified', () => {
  it('does not add emotional weight to a neutral report of a rejected proposal', async () => {
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

    // Deterministic: emotional-weight words that do not appear in the employee's own messages.
    const added = findUnstatedEmotionWords(harness.replies, FIXTURE.employeeTurns);
    expect(added, JSON.stringify(added, null, 2)).toEqual([]);

    // The evidence boundary is the runtime contract a repeated failure would be fixed through.
    harness.responseCallsByTurn.forEach((call, index) => {
      expect(call?.context.replyPlan?.forbiddenMoves, `turn ${index + 1} plan`).toContain('unsupported_interpretation');
    });

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
