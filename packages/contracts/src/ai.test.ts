import { describe, it, expect } from 'vitest';
import {
  SituationClassificationSchema,
  RiskDetectionSchema,
  MemoryProposalSchema,
  SurveyEvidenceEvaluationSchema,
  GeneratedResponseSchema,
  ReplyStrategySchema,
  FollowUpCandidateSchema,
  ConfirmationResponseSchema,
  ConversationModeSchema,
  ObservedStyleSchema,
} from './ai';

describe('Contract: SituationClassificationSchema', () => {
  const onboardingBase = {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.8,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'test',
  };

  it('keeps a valid onboardingSignal through the transform', () => {
    const parsed = SituationClassificationSchema.parse({
      ...onboardingBase,
      onboardingSignal: { intent: 'later', substantive: false },
    });
    expect(parsed.onboardingSignal).toEqual({ intent: 'later', substantive: false });
  });

  it('keeps onboardingSignal on pulse-capture classifications rewritten by the transform', () => {
    const parsed = SituationClassificationSchema.parse({
      ...onboardingBase,
      primaryIntent: 'pulse_capture_explanation',
      onboardingSignal: { intent: 'none', substantive: false },
    });
    expect(parsed.onboardingSignal).toEqual({ intent: 'none', substantive: false });
  });

  it('parses a missing onboardingSignal as absent and null as null', () => {
    expect(SituationClassificationSchema.parse(onboardingBase).onboardingSignal ?? null).toBeNull();
    expect(SituationClassificationSchema.parse({ ...onboardingBase, onboardingSignal: null }).onboardingSignal).toBeNull();
  });

  it('parses an invalid onboardingSignal as null instead of failing the classification', () => {
    for (const onboardingSignal of [
      { intent: 'maybe', substantive: false },
      { intent: 'start' },
      'start',
    ]) {
      const parsed = SituationClassificationSchema.parse({ ...onboardingBase, onboardingSignal });
      expect(parsed.onboardingSignal).toBeNull();
    }
  });

  it('accepts a valid classification', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'support',
      secondaryIntents: ['burnout_signal'],
      emotionalState: ['stressed'],
      urgency: 'high',
      confidence: 0.9,
      requiresSafetyCheck: true,
      surveyAllowed: false,
      reasoningSummary: 'User shows burnout signs.',
      dialogueAct: 'emotional_disclosure',
      latestUserSubstance: 'barely sleeping after carrying the release',
      topicAnchor: 'release strain',
      resolvedDetails: ['The employee is barely sleeping after carrying the release.'],
    });
    expect(parsed.dialogueAct).toBe('emotional_disclosure');
    expect(parsed.latestUserSubstance).toContain('barely sleeping');
    expect(parsed.topicAnchor).toBe('release strain');
    expect(parsed).toMatchObject({
      resolvedDetails: ['The employee is barely sleeping after carrying the release.'],
    });
  });

  it('carries the cycle-status question signal and defaults it to false', () => {
    const base = {
      primaryIntent: 'casual_conversation', secondaryIntents: [], emotionalState: [], urgency: 'low',
      confidence: 0.8, requiresSafetyCheck: false, surveyAllowed: true, reasoningSummary: 'asks what is left',
    };
    expect(SituationClassificationSchema.parse({ ...base, cycleStatusQuestion: true }).cycleStatusQuestion).toBe(true);
    expect(SituationClassificationSchema.parse(base).cycleStatusQuestion).toBe(false);
    expect(SituationClassificationSchema.parse({ ...base, cycleStatusQuestion: null }).cycleStatusQuestion).toBe(false);
  });

  it('defaults dialogue-state fields for older classifier payloads', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'support',
      secondaryIntents: ['burnout_signal'],
      emotionalState: ['stressed'],
      urgency: 'high',
      confidence: 0.9,
      requiresSafetyCheck: true,
      surveyAllowed: false,
      reasoningSummary: 'User shows burnout signs.',
    });
    expect(parsed.dialogueAct).toBe('new_substance');
    expect(parsed.latestUserSubstance).toBeNull();
    expect(parsed.topicAnchor).toBeNull();
    expect(parsed.resolvedDetails).toBeUndefined();
  });

  it('accepts a typed exact-message pulse capture scope', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'pulse_capture_explanation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      requiresSafetyCheck: false,
      surveyAllowed: false,
      reasoningSummary: 'The employee named an earlier message.',
      pulseCaptureScope: { type: 'message', messageIndex: 3 },
    });

    expect(parsed.pulseCaptureScope).toEqual({ type: 'message', messageIndex: 3 });
  });

  it.each([
    { type: 'message', messageIndex: -1 },
    { type: 'message', messageIndex: 1.5 },
    { type: 'something_else' },
    { type: 'conversation', messageIndex: 3 },
    { type: 'message', messageIndex: 3, previousExact: true },
    { type: 'previous_exact', messageIndex: 3 },
    { type: 'unresolved', messageIndex: 3 },
  ])('fails a malformed pulse capture scope closed to unresolved: %j', (pulseCaptureScope) => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'pulse_capture_explanation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      requiresSafetyCheck: false,
      surveyAllowed: false,
      reasoningSummary: 'Malformed model scope.',
      pulseCaptureScope,
    });

    expect(parsed.pulseCaptureScope).toEqual({ type: 'unresolved' });
  });

  it('keeps a missing CAP-8 scope on the intent but fails it closed to unresolved', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'pulse_capture_explanation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      requiresSafetyCheck: false,
      surveyAllowed: false,
      reasoningSummary: 'No scope supplied.',
    });

    expect(parsed.primaryIntent).toBe('pulse_capture_explanation');
    expect(parsed.pulseCaptureScope).toEqual({ type: 'unresolved' });
  });

  it('keeps an explicit null scope absent for non-CAP-8 classifications', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'support',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      requiresSafetyCheck: false,
      surveyAllowed: true,
      reasoningSummary: 'No CAP-8 request.',
      pulseCaptureScope: null,
    });

    expect(parsed.pulseCaptureScope).toBeUndefined();
  });

  it('normalizes duplicate and blank resolved details before applying the cap', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'casual_conversation',
      secondaryIntents: [],
      emotionalState: [],
      urgency: 'low',
      confidence: 0.9,
      requiresSafetyCheck: false,
      surveyAllowed: true,
      reasoningSummary: 'The employee continues the same thread.',
      resolvedDetails: [' one ', 'one', '', 'two', 'three', 'four', 'five'],
    });

    expect(parsed.resolvedDetails).toEqual(['one', 'two', 'three', 'four', 'five']);
  });

  it('accepts social check-in as a typed intent and dialogue act', () => {
    const parsed = SituationClassificationSchema.parse({
      primaryIntent: 'social_checkin',
      secondaryIntents: [],
      emotionalState: ['neutral'],
      urgency: 'low',
      confidence: 0.94,
      requiresSafetyCheck: false,
      surveyAllowed: true,
      reasoningSummary: 'The latest employee message is a social check-in.',
      dialogueAct: 'social_checkin',
      latestUserSubstance: null,
      topicAnchor: null,
    });

    expect(parsed.primaryIntent).toBe('social_checkin');
    expect(parsed.dialogueAct).toBe('social_checkin');
  });

  it('rejects unknown primaryIntent', () => {
    expect(() =>
      SituationClassificationSchema.parse({
        primaryIntent: 'unknown_intent',
        secondaryIntents: [],
        emotionalState: [],
        urgency: 'low',
        confidence: 0.5,
        requiresSafetyCheck: false,
        surveyAllowed: true,
        reasoningSummary: '',
      }),
    ).toThrow();
  });

  it('rejects confidence outside 0-1', () => {
    expect(() =>
      SituationClassificationSchema.parse({
        primaryIntent: 'support',
        secondaryIntents: [],
        emotionalState: [],
        urgency: 'low',
        confidence: 1.5,
        requiresSafetyCheck: false,
        surveyAllowed: true,
        reasoningSummary: '',
      }),
    ).toThrow();
  });

  it('rejects unknown urgency value', () => {
    expect(() =>
      SituationClassificationSchema.parse({
        primaryIntent: 'coaching',
        secondaryIntents: [],
        emotionalState: [],
        urgency: 'very_high',
        confidence: 0.8,
        requiresSafetyCheck: false,
        surveyAllowed: true,
        reasoningSummary: '',
      }),
    ).toThrow();
  });
});

describe('Contract: RiskDetectionSchema', () => {
  it('accepts a critical risk', () => {
    expect(() =>
      RiskDetectionSchema.parse({
        riskType: 'potential_self_harm',
        severity: 'critical',
        confidence: 0.95,
        evidence: ['user said they feel hopeless'],
        immediateResponseRequired: true,
        escalationRecommended: true,
        surveyMustBeBlocked: true,
        proactiveMessagesMustBePaused: true,
        reasoningSummary: 'Direct self-harm language.',
      }),
    ).not.toThrow();
  });

  it('accepts null riskType (no risk)', () => {
    expect(() =>
      RiskDetectionSchema.parse({
        riskType: null,
        severity: 'none',
        confidence: 0.99,
        evidence: [],
        immediateResponseRequired: false,
        escalationRecommended: false,
        surveyMustBeBlocked: false,
        proactiveMessagesMustBePaused: false,
        reasoningSummary: 'Normal conversation.',
      }),
    ).not.toThrow();
  });

  it('rejects unknown riskType', () => {
    expect(() =>
      RiskDetectionSchema.parse({
        riskType: 'alien_invasion',
        severity: 'high',
        confidence: 0.8,
        evidence: [],
        immediateResponseRequired: false,
        escalationRecommended: false,
        surveyMustBeBlocked: false,
        proactiveMessagesMustBePaused: false,
        reasoningSummary: '',
      }),
    ).toThrow();
  });
});

describe('Contract: MemoryProposalSchema', () => {
  it('accepts a well-formed memory proposal', () => {
    expect(() =>
      MemoryProposalSchema.parse({
        memoryItems: [
          {
            category: 'goal',
            canonicalKey: 'career_goal_em',
            content: 'Wants to become EM by 2026',
            confidence: 0.9,
            importance: 0.85,
            sensitivity: 'normal',
            expectedLifetime: 'long_term',
            sourceMessageIds: [],
            action: 'create',
          },
        ],
        goalProposals: [],
        commitmentProposals: [],
        followUpCandidates: [],
      }),
    ).not.toThrow();
  });

  it('rejects unknown memory category', () => {
    expect(() =>
      MemoryProposalSchema.parse({
        memoryItems: [
          {
            category: 'social_media_post',
            content: 'something',
            confidence: 0.5,
            importance: 0.5,
            sensitivity: 'normal',
            expectedLifetime: 'days',
            sourceMessageIds: [],
            action: 'create',
          },
        ],
        goalProposals: [],
        commitmentProposals: [],
        followUpCandidates: [],
      }),
    ).toThrow();
  });

  it('rejects unknown memory action', () => {
    expect(() =>
      MemoryProposalSchema.parse({
        memoryItems: [
          {
            category: 'goal',
            content: 'test',
            confidence: 0.5,
            importance: 0.5,
            sensitivity: 'normal',
            expectedLifetime: 'days',
            sourceMessageIds: [],
            action: 'delete',
          },
        ],
        goalProposals: [],
        commitmentProposals: [],
        followUpCandidates: [],
      }),
    ).toThrow();
  });

  it('parses follow-up candidates correctly', () => {
    const result = MemoryProposalSchema.parse({
      memoryItems: [],
      goalProposals: [],
      commitmentProposals: [],
      followUpCandidates: [
        {
          type: 'follow_up',
          topic: 'project completion',
          reason: 'User started a big project',
          recommendedDelayDays: 7,
          earliestDaysFromNow: 5,
          relevanceChecks: ['project not mentioned as done'],
          cancellationConditions: ['user_mentions_completion'],
          messageStrategy: 'light_check_in',
          confidence: 0.8,
        },
      ],
    });
    expect(result.followUpCandidates).toHaveLength(1);
    expect(result.followUpCandidates[0]!.confidence).toBe(0.8);
  });
});

describe('Contract: SurveyEvidenceEvaluationSchema', () => {
  it('accepts valid evidence evaluation', () => {
    expect(() =>
      SurveyEvidenceEvaluationSchema.parse({
        candidateQuestionIds: ['q-1'],
        evidence: [
          {
            questionId: 'q-1',
            evidenceSummary: 'User expressed positive feelings about their team.',
            polarity: 'positive',
            strength: 0.8,
            completeness: 0.6,
            confidence: 0.85,
            followUpProbeNeeded: false,
            thresholdReached: false,
            assessmentShouldRemainUnknown: false,
          },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects unknown polarity', () => {
    expect(() =>
      SurveyEvidenceEvaluationSchema.parse({
        candidateQuestionIds: [],
        evidence: [
          {
            questionId: 'q-1',
            evidenceSummary: '',
            polarity: 'ambiguous',
            strength: 0.5,
            completeness: 0.5,
            confidence: 0.5,
            followUpProbeNeeded: false,
            thresholdReached: false,
            assessmentShouldRemainUnknown: false,
          },
        ],
      }),
    ).toThrow();
  });

  it.each([0, 7, 10])('accepts an explicit numeric value of %s', (numericValue) => {
    const parsed = SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: ['q-1'],
      evidence: [{
        questionId: 'q-1', evidenceSummary: `Explicit rating: ${numericValue}`,
        polarity: 'neutral', strength: 1, completeness: 1, confidence: 1,
        followUpProbeNeeded: false, thresholdReached: true,
        assessmentShouldRemainUnknown: false, numericValue,
      }],
    });
    expect(parsed.evidence[0]?.numericValue).toBe(numericValue);
  });

  it.each([-1, 11])('rejects an out-of-range numeric value of %s', (numericValue) => {
    expect(() => SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: ['q-1'],
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Invalid rating', polarity: 'neutral',
        strength: 1, completeness: 1, confidence: 1, followUpProbeNeeded: false,
        thresholdReached: true, assessmentShouldRemainUnknown: false, numericValue,
      }],
    })).toThrow();
  });

  it('accepts a null numeric value as no explicit rating', () => {
    const parsed = SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: ['q-1'],
      evidence: [{
        questionId: 'q-1', evidenceSummary: 'Qualitative signal only', polarity: 'neutral',
        strength: 0.6, completeness: 0.5, confidence: 0.7, followUpProbeNeeded: true,
        thresholdReached: false, assessmentShouldRemainUnknown: false, numericValue: null,
      }],
    });
    expect(parsed.evidence[0]?.numericValue).toBeNull();
  });
});

describe('Contract: GeneratedResponseSchema', () => {
  it('accepts valid response', () => {
    const result = GeneratedResponseSchema.parse({
      text: 'That sounds really challenging. How long have you been feeling this way?',
      confidence: 0.92,
      containsSurveyProbe: false,
    });
    expect(result.text).toBeTruthy();
    expect(result.containsSurveyProbe).toBe(false);
  });

  it('accepts response with survey probe', () => {
    const result = GeneratedResponseSchema.parse({
      text: 'Great to hear! How has the team collaboration been on this project?',
      confidence: 0.88,
      containsSurveyProbe: true,
      surveyProbeQuestionId: 'q-team-collab',
    });
    expect(result.surveyProbeQuestionId).toBe('q-team-collab');
  });

  it('normalizes null confirmationSummary from model output to undefined', () => {
    const result = GeneratedResponseSchema.parse({
      text: 'Okay, I am here if you need me.',
      confirmationSummary: null,
      confidence: 0.8,
      containsSurveyProbe: false,
    });
    expect(result.confirmationSummary).toBeUndefined();
  });

  it('normalizes null optional survey probe id from model output', () => {
    const result = GeneratedResponseSchema.parse({
      text: 'That is a lot to carry.',
      confidence: 0.88,
      containsSurveyProbe: false,
      surveyProbeQuestionId: null,
    });

    expect(result.surveyProbeQuestionId).toBeUndefined();
  });
});

describe('Contract: ReplyStrategySchema', () => {
  it('accepts all valid tone/mode combinations', () => {
    const modes = ['normal', 'supportive', 'coaching', 'sensitive', 'crisis', 'survey_probe', 'proactive_follow_up', 'onboarding', 'celebration'] as const;
    for (const mode of modes) {
      expect(() =>
        ReplyStrategySchema.parse({
          mode,
          tone: 'warm',
          includeFollowUpQuestion: true,
          maxResponseLength: 'medium',
          forbiddenPatterns: [],
        }),
      ).not.toThrow();
    }
  });

  it('rejects unknown maxResponseLength', () => {
    expect(() =>
      ReplyStrategySchema.parse({
        mode: 'normal',
        tone: 'warm',
        includeFollowUpQuestion: false,
        maxResponseLength: 'very_long',
        forbiddenPatterns: [],
      }),
    ).toThrow();
  });
});

describe('Contract: FollowUpCandidateSchema', () => {
  it('requires confidence in 0-1 range', () => {
    expect(() =>
      FollowUpCandidateSchema.parse({
        type: 'follow_up',
        topic: 'project',
        reason: 'user started project',
        recommendedDelayDays: 7,
        earliestDaysFromNow: 5,
        relevanceChecks: [],
        cancellationConditions: [],
        messageStrategy: 'light_check_in',
        confidence: 1.5,
      }),
    ).toThrow();
  });
});

describe('ObservedStyleSchema', () => {
  it('accepts valid observed style', () => {
    const r = ObservedStyleSchema.parse({ dimensions: { register: 1, humor: 0.5, verbosity: 0.2, emoji: 0 }, phrases: ['eh, so-so'] });
    expect(r.dimensions.register).toBe(1);
  });
  it('rejects out-of-range', () => {
    expect(() => ObservedStyleSchema.parse({ dimensions: { register: 2, humor: 0, verbosity: 0, emoji: 0 }, phrases: [] })).toThrow();
  });
});

describe('ConfirmationResponseSchema', () => {
  it('accepts a valid agree verdict', () => {
    const r = ConfirmationResponseSchema.parse({ verdict: 'agree' });
    expect(r.verdict).toBe('agree');
  });

  it('accepts correct with a note', () => {
    const r = ConfirmationResponseSchema.parse({ verdict: 'correct', correctionNote: 'not about pay' });
    expect(r.correctionNote).toBe('not about pay');
  });

  it('accepts an exclusion verdict', () => {
    const r = ConfirmationResponseSchema.parse({ verdict: 'exclude' });
    expect(r.verdict).toBe('exclude');
  });

  it('rejects an unknown verdict', () => {
    expect(() => ConfirmationResponseSchema.parse({ verdict: 'maybe' })).toThrow();
  });

  it('allows confirmation as a conversation mode', () => {
    expect(ConversationModeSchema.parse('confirmation')).toBe('confirmation');
  });
});

describe('Contract: SituationClassificationSchema offer and format signals (GC round 3 CAP-6/CAP-9)', () => {
  const payload = (extra: Record<string, unknown> = {}) => ({
    primaryIntent: 'coaching',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.9,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'test',
    dialogueAct: 'request',
    latestUserSubstance: 'yes, a bit more direct please',
    topicAnchor: null,
    ...extra,
  });

  it('leaves the offer and format signals absent for older classifier payloads', () => {
    const parsed = SituationClassificationSchema.parse(payload());

    expect(parsed.priorAssistantOffer).toBeUndefined();
    expect(parsed.acceptsPriorOffer).toBeUndefined();
    expect(parsed.formatRequest).toBeUndefined();
  });

  it('keeps an explicit null format request as null', () => {
    const parsed = SituationClassificationSchema.parse(payload({ formatRequest: null }));

    expect(parsed.formatRequest).toBeNull();
  });

  it('keeps an accepted offer when the latest assistant turn contained one', () => {
    const parsed = SituationClassificationSchema.parse(payload({
      priorAssistantOffer: true,
      acceptsPriorOffer: true,
      formatRequest: 'list',
    }));

    expect(parsed.priorAssistantOffer).toBe(true);
    expect(parsed.acceptsPriorOffer).toBe(true);
    expect(parsed.formatRequest).toBe('list');
  });

  it('fails an acceptance closed when no prior offer was reported', () => {
    const parsed = SituationClassificationSchema.parse(payload({
      priorAssistantOffer: false,
      acceptsPriorOffer: true,
    }));

    expect(parsed.acceptsPriorOffer).toBe(false);
  });

  it.each(['table', 'bullets', 42, {}])('fails an unknown format request closed to null: %j', (formatRequest) => {
    const parsed = SituationClassificationSchema.parse(payload({ formatRequest }));

    expect(parsed.formatRequest).toBeNull();
  });

  it('fails malformed offer flags closed to false', () => {
    const parsed = SituationClassificationSchema.parse(payload({
      priorAssistantOffer: 'yes',
      acceptsPriorOffer: 'yes',
    }));

    expect(parsed.priorAssistantOffer).toBe(false);
    expect(parsed.acceptsPriorOffer).toBe(false);
  });
});

describe('Contract: GC round 3 CAP-1/CAP-2 topic steering fields', () => {
  const evidence = {
    questionId: 'q-1', evidenceSummary: 'Motivation is high at 9 out of 10.', polarity: 'positive',
    strength: 0.9, completeness: 0.8, confidence: 0.9, followUpProbeNeeded: false,
    thresholdReached: true, assessmentShouldRemainUnknown: false,
  };

  it('carries typed driver signals on survey evidence', () => {
    const parsed = SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: ['q-1'],
      evidence: [{ ...evidence, driverCaptured: true, driverDeclined: false }],
    });
    expect(parsed.evidence[0]).toMatchObject({ driverCaptured: true, driverDeclined: false });
  });

  it('fails closed to no driver when the signals are missing or malformed', () => {
    const parsed = SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: ['q-1'],
      evidence: [evidence, { ...evidence, driverCaptured: 'yes', driverDeclined: null }],
    });
    expect(parsed.evidence.map((item) => [item.driverCaptured, item.driverDeclined]))
      .toEqual([[undefined, undefined], [false, false]]);
  });

  it('carries a separate topic question on a generated reply and normalizes null', () => {
    expect(GeneratedResponseSchema.parse({
      text: '', replyText: 'That deadline sounds tight.', topicQuestion: 'How much say do you have over how you plan it?',
      confidence: 0.9, containsSurveyProbe: true, surveyProbeQuestionId: 'q-1',
    }).topicQuestion).toBe('How much say do you have over how you plan it?');
    expect(GeneratedResponseSchema.parse({
      text: 'ok', topicQuestion: null, confidence: 0.9, containsSurveyProbe: false,
    }).topicQuestion).toBeUndefined();
  });

  it('carries driver declines that come without new meaning, failing closed to none', () => {
    expect(SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: [], evidence: [], driverDeclinedQuestionIds: ['q-1'],
    }).driverDeclinedQuestionIds).toEqual(['q-1']);
    expect(SurveyEvidenceEvaluationSchema.parse({
      candidateQuestionIds: [], evidence: [], driverDeclinedQuestionIds: 'q-1',
    }).driverDeclinedQuestionIds).toEqual([]);
  });

  it('treats a null confirmation summary from model output as absent', () => {
    expect(GeneratedResponseSchema.parse({
      text: '', replyText: 'ok.', topicQuestion: 'What helps?', confirmationSummary: null,
      confidence: 0.9, containsSurveyProbe: true,
    }).confirmationSummary).toBeUndefined();
  });
});
