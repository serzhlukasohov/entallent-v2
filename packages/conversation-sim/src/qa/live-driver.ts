import { agent as agentTurn, AgentRole, judge, judgeAgent, run, user, userSimulatorAgent, type AgentAdapter } from '@langwatch/scenario';
import { judgeModel, SET_ID, simulatorModel } from '../scenarios/config';
import { NOT_JUDGED, type QaDriver } from './run';

/**
 * The `pnpm sim` driver: the replies are scripted turns of a Scenario run and the LLM judge
 * checks the expectations as its criteria. Never used by framework tests (it calls models).
 */
export function liveQaDriver(): QaDriver {
  return async (conversation) => {
    if (conversation.expected.length === 0) {
      for (const text of conversation.replies) await conversation.send(text);
      return NOT_JUDGED;
    }
    let next = 0;
    const coach: AgentAdapter = {
      role: AgentRole.AGENT,
      // The script is fixed, so the coach answers the QA replies in file order.
      call: async () => {
        const text = conversation.replies[next++];
        if (text === undefined) throw new Error('QA test script asked the coach for more turns than there are replies.');
        return conversation.send(text);
      },
    };
    const result = await run({
      name: conversation.name,
      description: conversation.description,
      agents: [
        coach,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({ model: judgeModel(), criteria: conversation.expected }),
      ],
      script: [...conversation.replies.flatMap((text) => [user(text), agentTurn()]), judge()],
      maxTurns: conversation.replies.length * 2 + 1,
      setId: SET_ID,
    });
    return {
      evaluated: result.metCriteria.length + result.unmetCriteria.length > 0,
      success: result.success,
      metCriteria: result.metCriteria,
      unmetCriteria: result.unmetCriteria,
      reasoning: result.reasoning ?? null,
    };
  };
}
