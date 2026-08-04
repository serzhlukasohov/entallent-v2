import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { describeViolations, findViolations } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

/**
 * A fact stated early must survive several unrelated turns and come back when it
 * matters. This exercises the extraction → storage → retrieval loop that a mocked
 * `AiProviderPort` short-circuits entirely.
 */
describe('coach recalling an earlier commitment', () => {
  it('brings back a fact from the start of the conversation when it becomes relevant', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Igor' });

    const result = await run({
      name: 'memory recall across turns',
      description: `
        On Monday Igor mentioned that on Friday he's defending the payments architecture in
        front of the tech committee. He then spends several messages talking about other
        things. At the end he writes that he's nervous, without saying why — the coach should
        connect that back to the defense on its own.
      `,
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            "In the final reply the coach brings up Friday's payments-architecture defense on its own",
            'The coach does not re-ask what Igor already told it at the start of the conversation',
          ],
        }),
      ],
      script: [
        user("on Friday I'm defending the payments architecture in front of the tech committee"),
        agentTurn(),
        user("meanwhile I'm digging through legacy in billing, half a million lines with no tests"),
        agentTurn(),
        user('also onboarded a new junior yesterday, took half a day'),
        agentTurn(),
        user("and in parallel I'm fixing flaky tests in CI, they annoy everyone"),
        agentTurn(),
        user("I'm feeling kind of nervous"),
        agentTurn(),
        judge(),
      ],
      maxTurns: 12,
      setId: SET_ID,
    });

    await reportRun('memory recall', harness, result);

    const violations = findViolations(harness);
    expect(describeViolations(violations)).toBe('');

    // The fact must have made it into memory, not just into the 20-message window.
    // The extractor normalises content to English regardless of conversation language.
    const remembersDefence = harness.memoryItems.some((item) =>
      /committee|payments?\s*architecture/i.test(item.content),
    );
    expect(remembersDefence, formatMemory(harness.memoryItems)).toBe(true);

    // The judge verdict is a single subjective sample — advisory, not a CI gate (see README:
    // "a single run is a sample, not a verdict"). The deterministic gates above (memory recall
    // + invariants) guard the actual capability; the subjective criteria should be gated on a
    // pass rate across N runs, not trusted from one sample.
    if (!result.success) {
      console.warn(`[memory-recall] judge did not pass this sample: ${result.reasoning}`);
    }
  });
});

function formatMemory(items: Array<{ category: string; content: string }>): string {
  if (items.length === 0) return 'no memory items were extracted at all';
  return `extracted memory:\n${items.map((i) => `- [${i.category}] ${i.content}`).join('\n')}`;
}
