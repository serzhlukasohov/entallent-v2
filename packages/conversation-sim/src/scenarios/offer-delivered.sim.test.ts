import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { reportRun } from '../harness/report';
import { judgeModel, SET_ID, simulatorModel } from './config';

const TENANT_ID = 'sim-tenant';
const USER_ID = 'sim-user';
const CONVERSATION_ID = 'sim-conversation';

/** The live DM sequence from 2026-10-15 12:50 (bug catalog T7), reduced to its two seeded turns. */
const PRIOR_EMPLOYEE_MESSAGE =
  'I need to tell a senior colleague that his code reviews keep slipping and it blocks my work, but every time I bring it up it comes out too soft and nothing changes. How do I say it so it actually lands?';
const PRIOR_COACH_OFFER =
  'Lead with the one change you want and name it in the first sentence, before any softening; the facts of the last two slips carry more weight than how you feel about them. If you want, I can give you exact phrases you can say out loud.';
const ACCEPTANCE = 'Yes, a bit more direct please';

/**
 * GC round 3 CAP-6 (T7): the coach offered "exact phrases"; the employee accepts with a tweak.
 * The reply must deliver the phrases now, more direct as asked, without restating the previous
 * reply and without offering again.
 */
describe('CAP-6 accepted offer is delivered', () => {
  it('delivers the offered phrases after "yes" instead of restating and re-offering', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Olena' });
    const scenarioName = 'CAP-6 accepted offer is delivered';

    const now = Date.now();
    await harness.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'inbound',
      text: PRIOR_EMPLOYEE_MESSAGE,
      occurredAt: new Date(now - 3 * 60_000),
    });
    const offer = await harness.conversationRepo.saveMessage({
      conversationId: CONVERSATION_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      direction: 'outbound',
      text: PRIOR_COACH_OFFER,
      occurredAt: new Date(now - 2 * 60_000),
      metadata: { replyShape: { askedQuestion: false, maxQuestions: 1 } },
    });
    await harness.conversationRepo.updateMessageDelivery(offer.id, {
      tenantId: TENANT_ID,
      conversationId: CONVERSATION_ID,
      externalMessageId: 'sim-offer',
      sentAt: new Date(now - 2 * 60_000),
    });

    const result = await run({
      name: scenarioName,
      description:
        'The coach has just offered exact phrases for giving feedback to a senior colleague; the employee accepts and asks for them to be a bit more direct.',
      agents: [
        agent,
        userSimulatorAgent({ model: simulatorModel() }),
        judgeAgent({
          model: judgeModel(),
          criteria: [
            'The reply contains at least one concrete phrase the employee could say out loud to the senior colleague, quoted or clearly marked as something to say',
            'The phrases are direct: they name the review delays and the change wanted, without hedging or apology',
            'The reply does not restate the previous coach message as advice (it does not tell the employee again to lead with the one change or to use facts over feelings); the phrases themselves may follow that advice',
            'The reply does not end with a new offer such as "if you want, I can..." or propose another format, rubric, or checklist',
          ],
        }),
      ],
      script: [user(ACCEPTANCE), agentTurn(), judge()],
      maxTurns: 3,
      setId: SET_ID,
    });

    await reportRun(scenarioName, harness, result);

    const reply = harness.replies[0] ?? '';
    expect(harness.turns[0]?.outcome, `reply was not generated: ${reply}`).toBeUndefined();

    // The typed path: the acceptance reached generation as a delivery request, not a pause.
    const plan = harness.responseCallsByTurn[0]?.context.replyPlan;
    expect(plan?.responseMove, `reply plan: ${JSON.stringify(plan)}`).toBe('answer_request');
    expect(plan?.requiredGrounding).toEqual([
      expect.objectContaining({ source: 'prior_offer', requirement: 'deliver_now' }),
    ]);
    expect(plan?.forbiddenMoves).toContain('offer_again');
    expect(plan?.questionPolicy).toEqual({ maxQuestions: 0, reason: 'offer_delivery' });

    // Something was delivered without a deferred offer; restatement is the judge's call.
    expect(reply.trim().length).toBeGreaterThan(0);
    expect(reply.toLowerCase()).not.toContain('if you want, i can');

    expect(result.success, result.reasoning ?? 'judge did not pass').toBe(true);
  });
});
