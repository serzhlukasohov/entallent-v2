import { describe, expect, it } from 'vitest';
import type { SituationClassification } from '@entalent/contracts';
import type { MemoryItemRecord } from '../types/records';
import { buildReplyPlan } from './reply-plan';

const base = (overrides: Partial<SituationClassification>): SituationClassification => ({
  primaryIntent: 'casual_conversation',
  secondaryIntents: [],
  emotionalState: [],
  urgency: 'low',
  confidence: 0.9,
  requiresSafetyCheck: false,
  surveyAllowed: true,
  reasoningSummary: 'test',
  reminderRequest: null,
  dialogueAct: 'new_substance',
  latestUserSubstance: 'new fact',
  topicAnchor: null,
  ...overrides,
});

const memory = (
  items: Array<Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>>,
): Array<Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>> => items;

describe('buildReplyPlan', () => {
  it('maps social greetings to a typed greeting response move', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'greeting',
        latestUserSubstance: null,
        topicAnchor: null,
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('social_greeting');
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 1,
      reason: 'greeting_opens_conversation',
    });
    expect(brief.mayInferFromBrevity).toBe(false);
  });

  it('maps social check-ins to a typed social reply response move', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'social_checkin',
        latestUserSubstance: null,
        topicAnchor: null,
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('social_reply');
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 1,
      reason: 'social_checkin_returns_question',
    });
    expect(brief.forbiddenMoves).toContain('operational_status');
    expect(brief.mayInferFromBrevity).toBe(false);
  });

  it('turns acknowledgements into continue-existing-thread without brevity inference', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'acknowledgement',
        latestUserSubstance: null,
        topicAnchor: 'the release shipped over the weekend',
      }),
      memoryItems: memory([
        { category: 'achievement', content: 'shipped a release', importance: 0.9 },
        { category: 'commitment', content: 'will monitor the release over the weekend', importance: 0.8 },
      ]),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('continue_existing_thread');
    expect(brief.latestUserSubstance).toBeNull();
    expect(brief.topicAnchor).toBe('the release shipped over the weekend');
    expect(brief.memoryAnchors).toEqual([
      { category: 'commitment', content: 'will monitor the release over the weekend' },
    ]);
    expect(brief.mayInferFromBrevity).toBe(false);
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 1,
      reason: 'new_substance_allows_question',
    });
    expect(brief.forbiddenMoves).toContain('comment_on_brevity');
  });

  it('keeps substantive turns available to the generator', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am barely sleeping',
        topicAnchor: 'burnout after the release',
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('support_emotion');
    expect(brief.latestUserSubstance).toBe('I am barely sleeping');
    expect(brief.mayInferFromBrevity).toBe(true);
    expect(brief.forbiddenMoves).toContain('action_plan');
    expect(brief.forbiddenMoves).toContain('unsupported_interpretation');
  });

  it('carries resolved thread details without blocking a materially new question', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'continuation',
        latestUserSubstance: 'The live issue needed me; I am just venting about losing my place.',
        topicAnchor: 'interruptions while mapping a payment exception',
        resolvedDetails: [
          '  The difficulty was reconstructing the whole analysis flow.  ',
          '',
        ],
      } as Partial<SituationClassification> & { resolvedDetails: string[] }),
      includeFollowUpQuestion: true,
    });

    expect(brief).toMatchObject({
      resolvedDetails: ['The difficulty was reconstructing the whole analysis flow.'],
      questionPolicy: { maxQuestions: 1 },
    });
  });

  it('deduplicates resolved details before applying the five-item cap', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'continuation',
        resolvedDetails: [' one ', 'one', 'two', 'three', 'four', 'five'],
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.resolvedDetails).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('resets prior memory and questions when the employee corrects the frame', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'correction',
        latestUserSubstance: 'I wanted criteria for evaluating chatbot answers',
        topicAnchor: 'manager-facing pulse report',
      }),
      memoryItems: memory([
        { category: 'project_context', content: 'manager-facing pulse report', importance: 1 },
        { category: 'goal', content: 'pressure-test belonging', importance: 0.9 },
      ]),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('address_new_substance');
    expect(brief.memoryAnchors).toEqual([]);
    expect(brief.requiredGrounding).toEqual([]);
    expect(brief.forbiddenMoves).toContain('unsupported_interpretation');
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'strategy_disallows_questions',
    });
  });

  it('keeps rejected framing out during the correction carryover window', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'request',
        latestUserSubstance: 'Give me relevance criteria',
        topicAnchor: 'chatbot answer quality',
      }),
      memoryItems: memory([
        { category: 'project_context', content: 'manager-facing pulse report', importance: 1 },
      ]),
      includeFollowUpQuestion: true,
      correctionCarryover: true,
    });

    expect(brief.correctionCarryover).toBe(true);
    expect(brief.memoryAnchors).toEqual([]);
  });

  it('requires the best memory anchor for vague emotional check-ins', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am nervous',
        topicAnchor: null,
      }),
      memoryItems: memory([
        { category: 'milestone', content: 'defending the payments architecture on Friday', importance: 0.9 },
        { category: 'project_context', content: 'legacy billing has no tests', importance: 0.8 },
        { category: 'team_context', content: 'joined mobile reviews', importance: 1 },
      ]),
      includeFollowUpQuestion: true,
    });

    expect(brief.memoryAnchors).toEqual([
      { category: 'milestone', content: 'defending the payments architecture on Friday' },
      { category: 'project_context', content: 'legacy billing has no tests' },
    ]);
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 1,
      reason: 'new_substance_allows_question',
    });
    expect(brief.requiredGrounding).toEqual([
      {
        source: 'memory',
        category: 'milestone',
        content: 'defending the payments architecture on Friday',
        requirement: 'mention_explicitly',
      },
    ]);
  });

  it('does not require unrelated memory when the current emotional turn has a topic anchor', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am nervous',
        topicAnchor: 'payments architecture defense',
      }),
      memoryItems: memory([
        { category: 'milestone', content: 'defending the payments architecture on Friday', importance: 0.9 },
        { category: 'project_context', content: 'legacy billing has no tests', importance: 0.8 },
        { category: 'team_context', content: 'joined mobile reviews', importance: 1 },
      ]),
      includeFollowUpQuestion: false,
    });

    expect(brief.requiredGrounding).toEqual([]);
  });

  it('keeps anchored emotional memory optional even when a commitment outranks project context', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am nervous',
        topicAnchor: 'payments architecture defense',
      }),
      memoryItems: memory([
        { category: 'project_context', content: 'legacy billing has no tests', importance: 1 },
        { category: 'commitment', content: 'defending the payments architecture on Friday', importance: 0.7 },
      ]),
      includeFollowUpQuestion: false,
    });

    expect(brief.requiredGrounding).toEqual([]);
  });

  it('closes without reopening the conversation', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'closing',
        latestUserSubstance: null,
        topicAnchor: 'the release',
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.responseMove).toBe('close_or_pause');
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'strategy_disallows_questions',
    });
  });

  it('keeps acknowledgements question-free when the strategy disallows questions', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'acknowledgement',
        latestUserSubstance: 'inconsistent classifier output',
      }),
      includeFollowUpQuestion: false,
    });

    expect(brief.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'strategy_disallows_questions',
    });
  });

  it('lets safety support override a closing pause without adding a question', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'closing',
        latestUserSubstance: null,
        topicAnchor: 'immediate danger',
      }),
      includeFollowUpQuestion: false,
      sensitiveMode: true,
    });

    expect(brief.responseMove).toBe('support_emotion');
    expect(brief.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'strategy_disallows_questions',
    });
    expect(brief.requiredGrounding).toEqual([]);
  });

  it('keeps the next question available while a continuing topic remains open', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'continuation',
        latestUserSubstance: 'same blocker is still there',
        topicAnchor: 'recurring blocker',
      }),
      includeFollowUpQuestion: true,
    });

    expect(brief.questionPolicy).toEqual({
      maxQuestions: 1,
      reason: 'new_substance_allows_question',
    });
  });
});

describe('buildReplyPlan offers and format requests (GC round 3 CAP-6/CAP-9)', () => {
  it('turns an accepted offer into a delivery request even when the act is an acknowledgement', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'acknowledgement',
        latestUserSubstance: null,
        topicAnchor: 'feedback for the senior colleague',
        priorAssistantOffer: true,
        acceptsPriorOffer: true,
      }),
      memoryItems: memory([
        { category: 'commitment', content: 'will talk to the senior colleague on Monday', importance: 0.9 },
      ]),
      includeFollowUpQuestion: true,
    });

    expect(plan.responseMove).toBe('answer_request');
    expect(plan.requiredGrounding).toEqual([
      { source: 'prior_offer', category: 'offer', content: 'the item offered in the previous assistant turn', requirement: 'deliver_now' },
    ]);
    expect(plan.forbiddenMoves).toContain('offer_again');
    expect(plan.forbiddenMoves).toContain('new_offer');
    expect(plan.questionPolicy).toEqual({ maxQuestions: 0, reason: 'offer_delivery' });
    expect(plan.memoryAnchors).toEqual([]);
    expect(plan.mayInferFromBrevity).toBe(false);
  });

  it('forbids a new offer while the previous offer is still unanswered', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'new_substance',
        latestUserSubstance: 'the retro went fine in the end',
        priorAssistantOffer: true,
        acceptsPriorOffer: false,
      }),
      includeFollowUpQuestion: true,
    });

    expect(plan.responseMove).toBe('address_new_substance');
    expect(plan.forbiddenMoves).toContain('new_offer');
    expect(plan.forbiddenMoves).not.toContain('offer_again');
    expect(plan.requiredGrounding).toEqual([]);
  });

  it('forbids offering instead of delivering when the employee asked for something', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'request',
        latestUserSubstance: 'give me an outline with timings for the 1:1',
      }),
      includeFollowUpQuestion: true,
    });

    expect(plan.responseMove).toBe('answer_request');
    expect(plan.forbiddenMoves).toContain('new_offer');
    expect(plan.forbiddenMoves).not.toContain('offer_again');
  });

  it('carries an explicit format request into the plan', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'request',
        latestUserSubstance: 'give me an outline with timings, a list with time slots please',
        formatRequest: 'outline',
      }),
      includeFollowUpQuestion: false,
    });

    expect(plan.formatRequest).toBe('outline');
    expect(plan.questionPolicy).toEqual({ maxQuestions: 0, reason: 'format_request' });
  });

  it('leaves ordinary turns free of offer limits and format requests', () => {
    const plan = buildReplyPlan({
      classification: base({ dialogueAct: 'new_substance', latestUserSubstance: 'new fact' }),
      includeFollowUpQuestion: true,
    });

    expect(plan.formatRequest).toBeNull();
    expect(plan.forbiddenMoves).not.toContain('new_offer');
    expect(plan.forbiddenMoves).not.toContain('offer_again');
  });

  it('keeps safety support in charge even when an offer was accepted', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'acknowledgement',
        latestUserSubstance: null,
        topicAnchor: 'immediate danger',
        priorAssistantOffer: true,
        acceptsPriorOffer: true,
      }),
      includeFollowUpQuestion: false,
      sensitiveMode: true,
    });

    expect(plan.responseMove).toBe('support_emotion');
    expect(plan.requiredGrounding).toEqual([]);
  });

  it('drops an explicit format request where the typed move cannot honour it', () => {
    const sensitive = buildReplyPlan({
      classification: base({ dialogueAct: 'request', latestUserSubstance: 'just give me the steps', formatRequest: 'steps' }),
      includeFollowUpQuestion: false,
      sensitiveMode: true,
    });
    const emotional = buildReplyPlan({
      classification: base({ dialogueAct: 'emotional_disclosure', latestUserSubstance: 'I am drained', formatRequest: 'list' }),
      includeFollowUpQuestion: true,
    });
    const acknowledgement = buildReplyPlan({
      classification: base({ dialogueAct: 'acknowledgement', latestUserSubstance: null, topicAnchor: 'the retro', formatRequest: 'list' }),
      includeFollowUpQuestion: true,
    });
    const closing = buildReplyPlan({
      classification: base({ dialogueAct: 'closing', latestUserSubstance: null, formatRequest: 'outline' }),
      includeFollowUpQuestion: true,
    });

    expect(sensitive.formatRequest).toBeNull();
    expect(emotional.formatRequest).toBeNull();
    expect(acknowledgement.formatRequest).toBeNull();
    expect(closing.formatRequest).toBeNull();
  });

  it('keeps a format request on substantive turns', () => {
    const plan = buildReplyPlan({
      classification: base({ dialogueAct: 'continuation', latestUserSubstance: 'and the plan for the 1:1?', formatRequest: 'outline' }),
      includeFollowUpQuestion: true,
    });

    expect(plan.formatRequest).toBe('outline');
  });

  it.each(['emotional_disclosure', 'closing', 'correction'] as const)(
    'lets the %s act win over an accepted offer',
    (dialogueAct) => {
      const plan = buildReplyPlan({
        classification: base({
          dialogueAct,
          latestUserSubstance: 'yes but honestly this is keeping me up at night',
          priorAssistantOffer: true,
          acceptsPriorOffer: true,
        }),
        includeFollowUpQuestion: true,
      });

      expect(plan.responseMove).not.toBe('answer_request');
      expect(plan.requiredGrounding).toEqual([]);
      expect(plan.forbiddenMoves).not.toContain('offer_again');
      expect(plan.questionPolicy.reason).not.toBe('offer_delivery');
    },
  );

  it('leaves offer limits to the safety contract in sensitive mode', () => {
    const plan = buildReplyPlan({
      classification: base({
        dialogueAct: 'request',
        latestUserSubstance: 'give me the phrases',
        priorAssistantOffer: true,
        acceptsPriorOffer: true,
      }),
      includeFollowUpQuestion: false,
      sensitiveMode: true,
    });

    expect(plan.forbiddenMoves).not.toContain('new_offer');
    expect(plan.forbiddenMoves).not.toContain('offer_again');
    expect(plan.requiredGrounding).toEqual([]);
  });
});
