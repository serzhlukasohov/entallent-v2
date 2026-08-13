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
      maxQuestions: 0,
      reason: 'greeting_no_question',
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
      maxQuestions: 0,
      reason: 'acknowledgement_no_new_substance',
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
  });

  it('selects concrete memory anchors for emotional turns', () => {
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
    expect(brief.requiredGrounding).toEqual([
      {
        source: 'memory',
        category: 'milestone',
        content: 'defending the payments architecture on Friday',
        requirement: 'mention_explicitly',
      },
    ]);
  });

  it('grounds vague emotional turns in commitments or milestones before generic project context', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am nervous',
        topicAnchor: null,
      }),
      memoryItems: memory([
        { category: 'project_context', content: 'legacy billing has no tests', importance: 1 },
        { category: 'commitment', content: 'defending the payments architecture on Friday', importance: 0.7 },
      ]),
      includeFollowUpQuestion: true,
    });

    expect(brief.requiredGrounding).toEqual([
      {
        source: 'memory',
        category: 'commitment',
        content: 'defending the payments architecture on Friday',
        requirement: 'mention_explicitly',
      },
    ]);
  });

  it('removes questions after a recent question on non-new-substance turns', () => {
    const brief = buildReplyPlan({
      classification: base({
        dialogueAct: 'continuation',
        latestUserSubstance: 'same blocker is still there',
        topicAnchor: 'recurring blocker',
      }),
      includeFollowUpQuestion: true,
      lastReplyAskedQuestion: true,
    });

    expect(brief.questionPolicy).toEqual({
      maxQuestions: 0,
      reason: 'asked_recently',
    });
  });
});
