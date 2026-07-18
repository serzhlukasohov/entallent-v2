import { describe, it, expect } from 'vitest';
import {
  SituationClassificationSchema,
  RiskDetectionSchema,
  MemoryProposalSchema,
  SurveyEvidenceEvaluationSchema,
  GeneratedResponseSchema,
  ReplyStrategySchema,
  FollowUpCandidateSchema,
} from './ai';

describe('Contract: SituationClassificationSchema', () => {
  it('accepts a valid classification', () => {
    expect(() =>
      SituationClassificationSchema.parse({
        primaryIntent: 'support',
        secondaryIntents: ['burnout_signal'],
        emotionalState: ['stressed'],
        urgency: 'high',
        confidence: 0.9,
        requiresSafetyCheck: true,
        surveyAllowed: false,
        reasoningSummary: 'User shows burnout signs.',
      }),
    ).not.toThrow();
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
