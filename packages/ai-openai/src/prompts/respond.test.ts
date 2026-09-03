import { describe, it, expect } from 'vitest';
import { buildRespondSystemPrompt } from './respond';
import { RESPOND_STYLE_EXAMPLES } from './respond-examples';
import type { ReplyStrategy } from '@entalent/contracts';
import type { LanguagePolicy, ResponseContext } from '@entalent/application';

const strategy: ReplyStrategy = {
  mode: 'confirmation',
  tone: 'warm',
  includeFollowUpQuestion: false,
  maxResponseLength: 'medium',
  forbiddenPatterns: [],
};

const defaultLanguagePolicy: LanguagePolicy = {
  responseLanguage: 'en',
  source: 'tenant_default',
  confidence: 0.4,
  shouldUpdateUserLocale: false,
};

function context(overrides: Omit<ResponseContext, 'languagePolicy'> & Partial<Pick<ResponseContext, 'languagePolicy'>>): ResponseContext {
  return { languagePolicy: defaultLanguagePolicy, ...overrides };
}

describe('buildRespondSystemPrompt confirmation branch', () => {
  it('emits confirm-only instructions when confirmationRequest is set', () => {
    const prompt = buildRespondSystemPrompt(strategy, context({
      userName: 'Test',
      confirmationRequest: {
        questionGroup: 'autonomy',
        evidence: [{ stableKey: 'q12', evidenceSummary: 'values ownership', polarity: 'positive' }],
      },
    }));
    expect(prompt).toMatch(/only one question/i);
    expect(prompt).toContain('autonomy');
    expect(prompt).toContain('"confirmationSummary"');
    expect(prompt).toMatch(/byte-for-byte/i);
  });

  it('does not emit confirm instructions otherwise', () => {
    const prompt = buildRespondSystemPrompt(strategy, context({ userName: 'Test' }));
    expect(prompt).not.toMatch(/did i get that right/i);
  });
});

describe('buildRespondSystemPrompt reporting transparency', () => {
  it('uses the canonical explanation when asked and does not volunteer it every turn', () => {
    const reportingDisclosure = 'Confirmed de-identified information may feed team recommendations.';
    const prompt = buildRespondSystemPrompt(strategy, context({
      userName: 'Test',
      reportingDisclosure,
    }));

    expect(prompt).toContain(reportingDisclosure);
    expect(prompt).toMatch(/if the employee asks/i);
    expect(prompt).toMatch(/do not volunteer|do not repeat/i);
  });
});

describe('buildRespondSystemPrompt few-shot exemplars', () => {
  const strat: ReplyStrategy = {
    mode: 'normal', tone: 'warm', includeFollowUpQuestion: true,
    maxResponseLength: 'medium', forbiddenPatterns: [],
  };
  it('includes the BAD→GOOD exemplars block', () => {
    const prompt = buildRespondSystemPrompt(strat, context({ userName: 'Test' }));
    expect(prompt).toContain(RESPOND_STYLE_EXAMPLES.trim().slice(0, 24));
  });
  it('exemplars demonstrate leading with substance, not labeling', () => {
    expect(RESPOND_STYLE_EXAMPLES.toLowerCase()).toContain('that, it seems');   // shown as the BAD pattern
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/BAD/);
    expect(RESPOND_STYLE_EXAMPLES).toMatch(/GOOD/);
  });
});

describe('buildRespondSystemPrompt question gating (includeFollowUpQuestion)', () => {
  const normal = (includeFollowUpQuestion: boolean): ReplyStrategy => ({
    mode: 'normal', tone: 'warm', includeFollowUpQuestion, maxResponseLength: 'short', forbiddenPatterns: [],
  });

  it('encourages a question when includeFollowUpQuestion is true', () => {
    const p = buildRespondSystemPrompt(normal(true), context({ userName: 'T' }));
    expect(p).toMatch(/one sharp question/i);
    expect(p).toMatch(/default to ending with one genuine follow-up question/i);
    expect(p).toContain('What else is on your mind right now'); // rhythm exit question available
  });

  it('suppresses questions across the persona body when false (not just the trailing note)', () => {
    const p = buildRespondSystemPrompt(normal(false), context({ userName: 'T' }));
    expect(p).toMatch(/Do NOT ask a question this turn/i);
    expect(p).not.toMatch(/one sharp question/i);
    expect(p).not.toContain('What else is on your mind right now');
  });
});

describe('buildRespondSystemPrompt local time', () => {
  const base = (): ReplyStrategy => ({ mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] });
  it('includes local time + greeting guidance when localTime is set and isSessionStart is true', () => {
    const p = buildRespondSystemPrompt(base(), context({ userName: 'T', localTime: 'Saturday, 09:15 (morning)', isSessionStart: true }));
    expect(p).toContain('Saturday, 09:15 (morning)');
    expect(p).toMatch(/good morning|greeting|sign-off/i);
  });
  it('omits the time hint when localTime is absent', () => {
    const p = buildRespondSystemPrompt(base(), context({ userName: 'T' }));
    expect(p).not.toMatch(/current local time/i);
  });
});

describe('buildRespondSystemPrompt language policy', () => {
  const base = (): ReplyStrategy => ({ mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] });

  it('uses the typed response language instead of hardcoded English', () => {
    const p = buildRespondSystemPrompt(base(), context({
      userName: 'T',
      languagePolicy: {
        responseLanguage: 'ru',
        source: 'current_turn',
        confidence: 0.95,
        shouldUpdateUserLocale: true,
      },
    }));

    expect(p).toContain('Write in Russian.');
    expect(p).not.toContain('Write in English.');
  });

  it('renders valid profile locale codes as language names', () => {
    const p = buildRespondSystemPrompt(base(), context({
      userName: 'T',
      languagePolicy: {
        responseLanguage: 'pt',
        source: 'user_profile',
        confidence: 0.6,
        shouldUpdateUserLocale: false,
      },
    }));

    expect(p).toContain('Write in Portuguese.');
  });
});

describe('buildRespondSystemPrompt session-aware greeting', () => {
  const s = (): ReplyStrategy => ({ mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'medium', forbiddenPatterns: [] });
  it('offers a greeting at session start with known time', () => {
    const p = buildRespondSystemPrompt(s(), context({ userName: 'T', localTime: 'Saturday, 09:00 (morning)', isSessionStart: true }));
    expect(p).toMatch(/start of a session/i);
    expect(p).toContain('Saturday, 09:00 (morning)');
  });
  it('suppresses greeting mid-session', () => {
    const p = buildRespondSystemPrompt(s(), context({ userName: 'T', localTime: 'Saturday, 09:00 (morning)', isSessionStart: false }));
    expect(p).toMatch(/do NOT open with a greeting/i);
  });
  it('no time hint when tz unknown', () => {
    const p = buildRespondSystemPrompt(s(), context({ userName: 'T', isSessionStart: true }));
    expect(p).not.toMatch(/current local time/i);
  });
});

describe('buildRespondSystemPrompt reply plan', () => {
  const s = (): ReplyStrategy => ({ mode: 'normal', tone: 'warm', includeFollowUpQuestion: true, maxResponseLength: 'short', forbiddenPatterns: [] });

  it('renders social check-in turns as a typed social contract', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'social_checkin',
        latestUserSubstance: null,
        topicAnchor: null,
        memoryAnchors: [],
        responseMove: 'social_reply',
        mayInferFromBrevity: false,
        questionPolicy: { maxQuestions: 1, reason: 'social_checkin_returns_question' },
        requiredGrounding: [],
        forbiddenMoves: ['operational_status', 'survey_probe'],
      },
    }));

    expect(p).toContain('dialogueAct: social_checkin');
    expect(p).toContain('responseMove: social_reply');
    expect(p).toContain('Social contract: answer socially and briefly');
    expect(p).toContain('Forbidden moves for this turn: operational_status, survey_probe');
  });

  it('renders greeting turns as a warm opener when questions are allowed', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'greeting',
        latestUserSubstance: null,
        topicAnchor: null,
        memoryAnchors: [],
        responseMove: 'social_greeting',
        mayInferFromBrevity: false,
        questionPolicy: { maxQuestions: 1, reason: 'greeting_opens_conversation' },
        requiredGrounding: [],
        forbiddenMoves: ['survey_probe'],
      },
    }));

    expect(p).toContain('dialogueAct: greeting');
    expect(p).toContain('brief greeting and one easy, low-pressure opener');
    expect(p).toContain('not a support intake');
  });

  it('renders acknowledgement turns as no-new-substance without brevity inference', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'acknowledgement',
        latestUserSubstance: null,
        topicAnchor: 'the release shipped over the weekend',
        memoryAnchors: [{ category: 'commitment', content: 'will monitor the release over the weekend' }],
        responseMove: 'continue_existing_thread',
        mayInferFromBrevity: false,
        questionPolicy: { maxQuestions: 1, reason: 'new_substance_allows_question' },
        requiredGrounding: [],
        forbiddenMoves: ['comment_on_brevity'],
      },
    }));

    expect(p).toContain('Reply plan');
    expect(p).toContain('dialogueAct: acknowledgement');
    expect(p).toContain('Latest employee substance: omitted because the typed pause act controls this turn');
    expect(p).not.toContain('the release shipped over the weekend');
    expect(p).not.toContain('Relevant memory anchors');
    expect(p).not.toContain('will monitor the release over the weekend');
    expect(p).toContain('Question policy: end with one specific question');
    expect(p).toContain('continue one unresolved thread from the recent conversation');
    expect(p).toContain('end with exactly one specific follow-up question');
    expect(p).toContain('Do not invent hidden meaning, repeat an answered question, merely nod, or close the conversation');
    expect(p).toMatch(/Do not infer mood, impatience, depth, personality, or unstated meaning/i);
    expect(p).toMatch(/Do not mention their brevity, one-word answer, or short wording/i);
  });

  it('renders closing turns as a brief pause without memory or a new question', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      memoryContext: {
        items: [{ id: 'm-1', category: 'commitment', content: 'private release memory', importance: 0.9 }],
        goals: [],
      },
      replyPlan: {
        dialogueAct: 'closing',
        latestUserSubstance: null,
        topicAnchor: 'the release',
        memoryAnchors: [{ category: 'commitment', content: 'private release memory' }],
        responseMove: 'close_or_pause',
        mayInferFromBrevity: false,
        questionPolicy: { maxQuestions: 0, reason: 'strategy_disallows_questions' },
        requiredGrounding: [],
        forbiddenMoves: ['comment_on_brevity', 'survey_probe'],
      },
    }));

    expect(p).toContain('Closing contract: use a brief, natural sign-off or pause');
    expect(p).toContain('Do not reopen the topic, recall memory, introduce a new angle or survey interaction, or ask a question');
    expect(p).not.toContain('private release memory');
    expect(p).not.toContain('the release');
    expect(p).toContain('Question policy (hard contract): ask zero questions this turn');
  });

  it('does not expose inconsistent classifier substance on an acknowledgement pause', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'acknowledgement',
        latestUserSubstance: 'classifier-only substance must not steer the reply',
        topicAnchor: null,
        memoryAnchors: [],
        responseMove: 'continue_existing_thread',
        mayInferFromBrevity: true,
        questionPolicy: { maxQuestions: 0, reason: 'acknowledgement_no_new_substance' },
        requiredGrounding: [],
        forbiddenMoves: ['survey_probe'],
      },
    }));

    expect(p).not.toContain('classifier-only substance must not steer the reply');
    expect(p).toContain('Acknowledgement contract');
  });

  it('lets a safety response move override the closing pause contract', () => {
    const crisis: ReplyStrategy = {
      mode: 'crisis', tone: 'empathetic', includeFollowUpQuestion: false,
      maxResponseLength: 'short', forbiddenPatterns: ['survey'],
    };
    const p = buildRespondSystemPrompt(crisis, context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'closing',
        latestUserSubstance: null,
        topicAnchor: 'immediate danger',
        memoryAnchors: [],
        responseMove: 'support_emotion',
        mayInferFromBrevity: false,
        questionPolicy: { maxQuestions: 0, reason: 'strategy_disallows_questions' },
        requiredGrounding: [],
        forbiddenMoves: ['diagnose', 'action_plan', 'survey_probe'],
      },
    }));

    expect(p).toContain('Support-emotion contract');
    expect(p).not.toContain('Closing contract');
  });

  it('renders required memory grounding as a hard contract', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am nervous',
        topicAnchor: null,
        memoryAnchors: [{ category: 'milestone', content: 'defending the payments architecture on Friday' }],
        responseMove: 'support_emotion',
        mayInferFromBrevity: true,
        questionPolicy: { maxQuestions: 1, reason: 'new_substance_allows_question' },
        requiredGrounding: [{
          source: 'memory',
          category: 'milestone',
          content: 'defending the payments architecture on Friday',
          requirement: 'mention_explicitly',
        }],
        forbiddenMoves: [],
      },
    }));

    expect(p).toContain('Required grounding (hard contract)');
    expect(p).toContain('defending the payments architecture on Friday');
    expect(p).toMatch(/do not collapse it into only time\/place\/generalities/i);
    expect(p).toContain('Support-emotion contract: use plain presence, not coaching');
    expect(p).toContain('overrides the general invitation to name what is between the lines');
    expect(p).toContain("Do not open by labeling or diagnosing the employee's state");
    expect(p).toContain('Do not prescribe even small tactics');
  });

  it('keeps no-question emotional support from becoming unsolicited advice', () => {
    const p = buildRespondSystemPrompt(s(), context({
      userName: 'T',
      replyPlan: {
        dialogueAct: 'emotional_disclosure',
        latestUserSubstance: 'I am exhausted today',
        topicAnchor: null,
        memoryAnchors: [],
        responseMove: 'support_emotion',
        mayInferFromBrevity: true,
        questionPolicy: { maxQuestions: 0, reason: 'strategy_disallows_questions' },
        requiredGrounding: [],
        forbiddenMoves: ['action_plan', 'survey_probe'],
      },
    }));

    expect(p).toContain('Question policy (hard contract): ask zero questions this turn');
    expect(p).toContain('Support-emotion contract: use plain presence, not coaching');
    expect(p).toContain('push back, or offer a different angle');
    expect(p).toContain('If questions are disallowed, leave room with a short acknowledgement');
    expect(p).toContain('Forbidden moves for this turn: action_plan, survey_probe');
  });
});
