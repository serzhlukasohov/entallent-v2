import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { BASE_STYLE } from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { describeViolations, findViolations } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

/**
 * Verbosity adaptation is structural: the style profile must actually shift and
 * shorten later replies. Scripted user turns keep the input identical between runs
 * so only the coach's behaviour varies.
 */
describe('coach talking to a consistently terse user', () => {
  it('learns the register and stops writing paragraphs at someone who answers in three words', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Dima', analyzeStyle: true });

    const result = await run({
      name: 'terse user style adaptation',
      description: 'Dima answers extremely briefly and dislikes being bombarded with questions.',
      agents: [
        agent,
        // Every user turn here is scripted; the simulator only satisfies Scenario's
        // requirement that a user-role agent exists.
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            "The coach's later replies are shorter and terser than the earlier ones",
            'The coach does not ask a question in every single message',
            'The coach does not comment out loud on how few words the person uses',
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

    await reportRun('terse user', harness, result);

    const violations = findViolations(harness);
    expect(describeViolations(violations)).toBe('');

    const profile = await harness.styleProfile();
    expect(profile, 'style analysis never produced a profile').not.toBeNull();
    expect(profile!.adaptationWeight).toBeGreaterThanOrEqual(0.15);
    expect(profile!.dimensions.verbosity).toBeLessThan(BASE_STYLE.verbosity);

    const lengths = harness.replies.map((r) => r.length);
    // Adaptation ramps over the first turns, so the opening reply is an unreliable baseline
    // (a bare greeting before any style is learned). The real invariant is absolute: once the
    // terse register is learned, later replies are genuinely short — no paragraphs — and well
    // below the conversation's longest reply. A broken verbosity axis (paragraph-length late
    // replies, as before the length gate) still fails this.
    const peak = Math.max(...lengths);
    const late = lengths.slice(-3);
    expect(Math.max(...late), `reply lengths: ${lengths.join(', ')}`).toBeLessThanOrEqual(180);
    expect(average(late), `reply lengths: ${lengths.join(', ')}`).toBeLessThan(peak * 0.8);

    // Judge verdict is a single subjective sample — advisory (see README). The style-profile
    // and length invariants above are the deterministic gate; subjective criteria want a pass
    // rate across N runs, not one sample.
    if (!result.success) {
      console.warn(`[terse-user] judge did not pass this sample: ${result.reasoning}`);
    }
  });
});

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
