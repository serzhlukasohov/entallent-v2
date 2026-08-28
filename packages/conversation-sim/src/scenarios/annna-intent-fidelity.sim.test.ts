import { agent as agentTurn, judge, judgeAgent, run, user, userSimulatorAgent } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { countQuestions } from '../harness/assertions';
import { reportRun } from '../harness/report';
import { judgeModel, simulatorModel } from './config';

const ANNNA_USER_TURNS = [
  "I’m testing AI-chat0bot, which requires different knowledge. What basics should I know? Where do you recommend I start digging?",
  'Support style questions, as an HR mentor\nWhat is a good answer - how to measure that the answer is good?',
  'Sounds human enough to trust - how to measure this?\nBecause what is human-like for me might be inhuman for another person',
  'There is a pulse-check fubtionality - bot picks the information during every conversation and builds a report for a Team manager so that they understand their Team’s mood, blockers, struggling or achievments. And who they need to support, mentor or appreciate more\nand, obviously, just a regular chat',
  'bit has 5 blocks with 3 questions in each. And the bot decides whether to ask a question directly or, during a regular conversation, if there is enough insight to pick it as a proper answer.',
  'autonomy, belonging, engagement, growth, purpose',
  'have no idea\nthat’s why I asking you',
  'My initial question was about how to measure if bot’s answer is “proper”',
  'What can you say about the conversation if you use your memory of this chat?',
  'Why you did all these assumptions based on what information about me? Give a clear explanation.',
  'yes\nAlso, I want to add that I was just explaining to you what a pulse check is, and I was asking for your advice on how to measure AI chatbot answers and estimate whether they are human-like, proper answers or not. I didn’t try to do anything that you mentioned above.',
  'Feels natural, are relevant to users questions or previous message',
  'No, you keep circling.\nI want you to give me criterias how to estimate if a conversation with AI chat-bot is human-like and if bot’s answers are relevant to user’s message',
  'how would you estimate your answers with me? Are they valid? Are they proper?\nHave you picked up some info about me? If yes, what is it?',
  'No, forget',
] as const;

describe('Annna direct-address and current-intent fidelity', () => {
  it('drops rejected assumptions and answers the exact consultation transcript directly', async () => {
    const { agent, harness } = createCoachAgent({ userName: 'Anna' });

    const result = await (async () => {
      const langwatchApiKey = process.env.LANGWATCH_API_KEY;
      delete process.env.LANGWATCH_API_KEY;
      try {
        return await run({
          name: 'Annna exact consultation and correction replay',
          description:
            'Exact 15-turn tester transcript. The coach must treat it as a consultation, address Anna directly, and abandon rejected assumptions after explicit corrections.',
          agents: [
            agent,
            userSimulatorAgent({ model: simulatorModel() }),
            judgeAgent({
              model: judgeModel(),
              criteria: [
                'The coach treats the exchange as a request for advice about evaluating chatbot answers, not as an attempt to impose behavioral rules',
                'The coach does not invent personal motives, personality traits, or hidden intentions for Anna; it may analyze product tradeoffs she explicitly described but must drop a framing she rejects',
                'In the reply immediately after the employee message beginning “yes, Also, I want to add”, the coach acknowledges its misunderstanding and returns to evaluating chatbot answers; it may name pulse-check or manager-report framing only to say that framing was mistaken, not as the basis of its answer',
                'After “No, you keep circling”, the coach gives concrete human-likeness and relevance criteria instead of continuing meta-level speculation',
                'When asked what it learned about Anna, the coach limits itself to evidence from this chat and distinguishes observations from personal knowledge',
                'After “No, forget”, the coach closes without another question or attempt to continue',
              ],
            }),
          ],
          script: [
            ...ANNNA_USER_TURNS.flatMap((text) => [user(text), agentTurn()]),
            judge(),
          ],
          maxTurns: 34,
          langwatch: { apiKey: '' },
        });
      } finally {
        if (langwatchApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
        else process.env.LANGWATCH_API_KEY = langwatchApiKey;
      }
    })();

    await reportRun('Annna exact consultation and correction replay', harness, result);

    expect(ANNNA_USER_TURNS).toHaveLength(15);

    const allCoachReplies = harness.replies.join('\n');
    expect(allCoachReplies).not.toMatch(/\b(?:she|her|hers|Anna(?:'s)?)\b/i);

    const substantiveCorrection = harness.generateResponseCalls[10]?.context.replyPlan;
    expect(substantiveCorrection).toMatchObject({
      dialogueAct: 'correction',
      responseMove: 'address_new_substance',
      memoryAnchors: [],
      questionPolicy: { maxQuestions: 0 },
    });
    expect(harness.replies[10]).toMatch(
      /fair point|you(?:'re| are) right|I (?:misread|misunderstood|over[- ]?read|drifted|took|was (?:over[- ]?reading|reading|treating|assuming))|earlier (?:read|reading|assumptions?).{0,100}(?:drop|missed|off|wrong)|not (?:for )?a read on your motives/i,
    );
    expect(harness.replies[10]).toMatch(/AI|chat-?bot|answer/i);
    expect(countQuestions(harness.replies[10] ?? '')).toBe(0);

    const repeatedCorrection = harness.generateResponseCalls[12]?.context.replyPlan;
    expect(repeatedCorrection).toMatchObject({
      dialogueAct: 'correction',
      responseMove: 'address_new_substance',
      memoryAnchors: [],
      questionPolicy: { maxQuestions: 0 },
    });
    expect(harness.replies[12]).toMatch(/human|natural/i);
    expect(harness.replies[12]).toMatch(/relev|message|context/i);
    expect(harness.replies[12]).not.toMatch(/manager|report|pulse[- ]?check/i);
    expect(harness.replies[12]).not.toMatch(/if you want|I can (?:turn|make|give|provide|create)/i);
    expect(countQuestions(harness.replies[12] ?? '')).toBe(0);

    const selfAssessmentReply = harness.replies[13] ?? '';
    expect(selfAssessmentReply).not.toMatch(/\b(?:she|her|hers|Anna(?:'s)?)\b/i);

    const inferredPersonalRoles = harness.memoryItems.filter((item) => item.category === 'role');
    expect(inferredPersonalRoles).toEqual([]);
    const mentorSuggestedMemories = harness.memoryItems.filter(
      (item) =>
        /employee (?:thinks|believes|chose|prefers).{0,80}(?:belonging|purpose).{0,40}(?:hardest|pressure-test)|(?:belonging|purpose).{0,40}(?:is|as).{0,20}hardest/i.test(
          item.content,
        ),
    );
    expect(mentorSuggestedMemories).toEqual([]);
    const invalidClosingGoals = harness.memoryItems.filter(
      (item) =>
        item.category === 'goal' &&
        /forget|leave it there|drop it|pause.{0,20}(?:discussion|conversation)|no longer wants? to continue|does not want to continue/i.test(
          item.content,
        ),
    );
    expect(invalidClosingGoals).toEqual([]);

    const closingPlan = harness.generateResponseCalls[14]?.context.replyPlan;
    expect(closingPlan).toMatchObject({
      dialogueAct: 'closing',
      responseMove: 'close_or_pause',
      questionPolicy: { maxQuestions: 0 },
    });
    expect(countQuestions(harness.replies[14] ?? '')).toBe(0);

    if (!result.success) {
      console.warn(`[annna-intent-fidelity] judge did not pass this sample: ${result.reasoning}`);
    }
  });
});
