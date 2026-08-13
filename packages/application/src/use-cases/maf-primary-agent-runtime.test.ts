import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult, SituationClassification } from '@entalent/contracts';
import { FEATURE_FLAGS } from '../ports/feature-flag.port';
import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import type { ConversationRepositoryPort } from '../ports/conversation.repository.port';
import type { OutboxPort } from '../ports/outbox.port';
import type { ScheduledActionRepositoryPort } from '../ports/scheduled-action.repository.port';
import type { GoalRepositoryPort, SaveGoalParams } from '../ports/goal.repository.port';
import type { MemoryRepositoryPort, SaveMemoryItemParams } from '../ports/memory.repository.port';
import { MafPrimaryAgentRuntime } from './maf-primary-agent-runtime';

const REQUEST: ProcessMessageRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  eventId: '22222222-2222-4222-8222-222222222222',
  runtimeAttempt: 1,
  messageId: '33333333-3333-4333-8333-333333333333',
  conversationId: '44444444-4444-4444-8444-444444444444',
  userId: '55555555-5555-4555-8555-555555555555',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
  messageText: 'I feel stuck but I can keep going.',
  messageCreatedAt: '2026-08-06T18:00:00.000Z',
  conversationSessionKey: 'workspace-1:55555555-5555-4555-8555-555555555555:channel-1:dm',
  conversationThreadId: 'thread-1',
  runtimeContext: {
    recentTurns: [],
    memoryItems: [],
    goals: [],
    replyPlan: {
      dialogueAct: 'social_checkin',
      latestUserSubstance: null,
      topicAnchor: null,
      memoryAnchors: [],
      responseMove: 'social_reply',
      mayInferFromBrevity: false,
      questionPolicy: {
        maxQuestions: 1,
        reason: 'social_checkin_returns_question',
      },
      requiredGrounding: [],
      forbiddenMoves: ['operational_status'],
    },
  },
};

const RUNTIME_CLASSIFICATION: SituationClassification = {
  primaryIntent: 'support',
  secondaryIntents: ['goal_setting'],
  emotionalState: [],
  urgency: 'high',
  confidence: 0.82,
  requiresSafetyCheck: true,
  surveyAllowed: false,
  reasoningSummary: 'Intent was inferred from request text.',
  reminderRequest: null,
  dialogueAct: 'new_substance',
  latestUserSubstance: null,
  topicAnchor: null,
};

const RUNTIME_RESULT: RuntimeResult = {
  reply: {
    text: 'That sounds heavy. What would make the next step smaller?',
  mode: 'normal',
  },
  riskAssessment: {
    type: null,
    severity: 'none',
    confidence: 0,
    evidence: [],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
  },
  memoryCandidates: [],
  proposedActions: [],
  classification: RUNTIME_CLASSIFICATION,
  diagnostics: {
    traceId: 'trace-1',
    runtimeVersion: 'agent-service-maf-core/1.13.0',
    runtimeAttempt: 1,
    modelCalls: 1,
    toolCalls: 0,
    latencyMs: 42,
    retryCount: 0,
    modelRetryCount: 0,
    toolRetryCount: 0,
    httpRetryCount: 0,
    replyRenderer: 'llm',
  },
};

describe('MafPrimaryAgentRuntime', () => {
  it('persists a Python MAF reply through TypeScript-owned message and outbox ports', async () => {
    const { runtime, mafRuntime, conversationRepo, outbox } = createRuntime();

    await expect(runtime.processMessage(REQUEST)).resolves.toEqual({
      outboundMessageId: 'outbound-1',
      responseText: RUNTIME_RESULT.reply.text,
      mode: 'normal',
      classification: RUNTIME_CLASSIFICATION,
      risk: {
        riskType: null,
        severity: 'none',
        confidence: 0,
        evidence: [],
        immediateResponseRequired: false,
        escalationRecommended: false,
        surveyMustBeBlocked: false,
        proactiveMessagesMustBePaused: false,
        reasoningSummary: 'maf_primary',
      },
    });

    expect(mafRuntime.processCandidate).toHaveBeenCalledWith(REQUEST);
    expect(conversationRepo.saveMessage).toHaveBeenCalledWith({
      conversationId: '44444444-4444-4444-8444-444444444444',
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      direction: 'outbound',
      text: RUNTIME_RESULT.reply.text,
      occurredAt: expect.any(Date),
      traceId: 'trace-1',
      metadata: {
        runtimeMode: 'maf_primary',
        runtimeVersion: 'agent-service-maf-core/1.13.0',
        modelCalls: 1,
        toolCalls: 0,
        retryCount: 0,
        replyRenderer: 'llm',
        proposedActionCount: 0,
        memoryCandidateCount: 0,
        proposedActionsDeferred: false,
        memoryCandidatesDeferred: false,
        replyPlanStatus: 'available',
        replyPlanDialogueAct: 'social_checkin',
        replyPlanResponseMove: 'social_reply',
        replyPlanMaxQuestions: 1,
        replyPlanQuestionReason: 'social_checkin_returns_question',
        replyShape: {
          askedQuestion: true,
          maxQuestions: 1,
          questionPolicyReason: 'social_checkin_returns_question',
        },
      },
    });
    expect(outbox.enqueueMessageSend).toHaveBeenCalledWith({
      messageId: 'outbound-1',
      tenantId: 'tenant-1',
      conversationId: '44444444-4444-4444-8444-444444444444',
      channelType: 'slack',
      externalWorkspaceId: 'workspace-1',
      externalChannelId: 'channel-1',
      text: RUNTIME_RESULT.reply.text,
      replyToExternalThreadId: 'thread-1',
    });
  });

it('uses Python-supplied classification when available', async () => {
    const pyClassification: SituationClassification = {
      ...RUNTIME_CLASSIFICATION,
      primaryIntent: 'coaching',
      secondaryIntents: ['feedback_request'],
      confidence: 0.91,
      reasoningSummary: 'Python-sourced classification in primary mode.',
    };
    const { runtime } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        classification: pyClassification,
      },
    });

    await expect(runtime.processMessage(REQUEST)).resolves.toMatchObject({
      classification: pyClassification,
    });
  });

  it('keeps downstream extraction jobs TypeScript-owned and feature-flagged', async () => {
    const { runtime, outbox } = createRuntime({
      featureFlags: {
        isEnabled: vi.fn(async (flag) => flag !== FEATURE_FLAGS.CONVERSATIONAL_SURVEY),
      },
    });

    await runtime.processMessage(REQUEST);

    expect(outbox.enqueueMemoryExtraction).toHaveBeenCalledWith({
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-1',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      outboundMessageId: 'outbound-1',
      traceId: 'trace-1',
      channelType: 'slack',
      externalConversationId: 'channel-1',
    });
    expect(outbox.enqueueStyleAnalysis).toHaveBeenCalledWith({
      conversationId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-1',
      traceId: 'trace-1',
    });
    expect(outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('persists proactive check-in replies with MAF metadata and skips inbound-owned extraction jobs', async () => {
    const proactiveRequest: ProcessMessageRequest = {
      ...REQUEST,
      requestPurpose: 'proactive_check_in',
      runtimeContext: {
        recentTurns: [],
        memoryItems: [],
        goals: [],
        replyPolicy: {
          maxChars: 360,
          maxQuestions: 1,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      },
      proactiveContext: {
        reason: 'pulse_check_in',
        probeQuestion: {
          id: '88888888-8888-4888-8888-888888888888',
          stableKey: 'role_clarity',
          title: 'Role Clarity',
          group: 'growth',
          probeStrategies: ['Ask what success looks like this week.'],
        },
      },
    };
    const { runtime, conversationRepo, outbox } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        reply: {
          ...RUNTIME_RESULT.reply,
          metadata: {
            containsSurveyProbe: true,
            surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
          },
        },
      },
    });

    await expect(runtime.processMessage(proactiveRequest)).resolves.toMatchObject({
      replyMetadata: {
        containsSurveyProbe: true,
        surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
      },
    });

    expect(conversationRepo.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'proactive_check_in',
      metadata: expect.objectContaining({
        runtimeMode: 'maf_primary',
        containsSurveyProbe: true,
        surveyProbeQuestionId: '88888888-8888-4888-8888-888888888888',
        replyShape: {
          askedQuestion: true,
          maxQuestions: 1,
          questionPolicyReason: 'reply_policy',
        },
      }),
    }));
    expect(outbox.enqueueMessageSend).toHaveBeenCalled();
    expect(outbox.enqueueMemoryExtraction).not.toHaveBeenCalled();
    expect(outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('does not commit inbound-evidence side effects for proactive check-in synthetic message ids', async () => {
    const proactiveRequest: ProcessMessageRequest = {
      ...REQUEST,
      requestPurpose: 'proactive_check_in',
      proactiveContext: { reason: 'pulse_check_in' },
    };
    const { runtime, riskSignalRepo, escalation, scheduledActionRepo, memoryRepo, goalRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        riskAssessment: {
          type: 'potential_self_harm',
          severity: 'critical',
          confidence: 0.91,
          evidence: ['model evidence'],
          immediateResponseRequired: true,
          escalationRecommended: true,
          surveyMustBeBlocked: true,
          proactiveMessagesMustBePaused: true,
        },
        memoryCandidates: [
          {
            actionId: 'memory-candidate-1',
            type: 'preference',
            content: 'Synthetic proactive request should not save this memory.',
            confidence: 0.86,
            sourceMessageIds: [REQUEST.messageId],
          },
        ],
        proposedActions: [
          {
            actionId: 'follow-up-action',
            actionType: 'schedule_follow_up',
            aggregateType: 'follow_up',
            idempotencyKey: 'idem-follow-up',
            payload: {
              executeAt: '2026-08-06T19:00:00.000Z',
              intent: 'candidate follow up',
              deduplicationKey: 'followup:proactive',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
          {
            actionId: 'memory-action',
            actionType: 'save_memory',
            aggregateType: 'memory',
            idempotencyKey: 'idem-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
          {
            actionId: 'goal-action',
            actionType: 'update_goal',
            aggregateType: 'goal',
            idempotencyKey: 'idem-goal',
            payload: {
              goalId: 'goal-1',
              changes: { status: 'completed' },
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(proactiveRequest);

    expect(riskSignalRepo.save).not.toHaveBeenCalled();
    expect(escalation.raise).not.toHaveBeenCalled();
    expect(scheduledActionRepo.save).not.toHaveBeenCalled();
    expect(memoryRepo.save).not.toHaveBeenCalled();
    expect(goalRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('persists risk signals and raises escalation through TypeScript-owned ports', async () => {
    const criticalResult: RuntimeResult = {
      ...RUNTIME_RESULT,
      riskAssessment: {
        type: 'potential_self_harm',
        severity: 'critical',
        confidence: 0.91,
        evidence: ['raw evidence must not be persisted here'],
        immediateResponseRequired: true,
        escalationRecommended: true,
        surveyMustBeBlocked: true,
        proactiveMessagesMustBePaused: true,
      },
    };
    const { runtime, riskSignalRepo, escalation } = createRuntime({ runtimeResult: criticalResult });

    await expect(runtime.processMessage(REQUEST)).resolves.toMatchObject({
      risk: {
        riskType: 'potential_self_harm',
        severity: 'critical',
        confidence: 0.91,
        evidence: [],
        immediateResponseRequired: true,
        escalationRecommended: true,
      },
    });

    expect(riskSignalRepo.save).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      type: 'potential_self_harm',
      severity: 'critical',
      confidence: 0.91,
      evidenceMessageIds: ['33333333-3333-4333-8333-333333333333'],
      policyVersion: 'v1',
      expiresAt: expect.any(Date),
    });
    expect(JSON.stringify(riskSignalRepo.save.mock.calls[0]?.[0])).not.toContain('raw evidence');
    expect(escalation.raise).toHaveBeenCalledWith({
      type: 'risk_detected',
      severity: 'critical',
      userId: '55555555-5555-4555-8555-555555555555',
      tenantId: 'tenant-1',
      riskType: 'potential_self_harm',
      messageIds: ['33333333-3333-4333-8333-333333333333'],
      traceId: 'trace-1',
    });
  });

  it('records non-empty Python proposals as redacted deferred counts only', async () => {
    const { runtime, conversationRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        memoryCandidates: [
          {
            actionId: 'memory-candidate-1',
            type: 'preference',
            content: 'raw memory content must not enter metadata',
            confidence: 0.5,
            sourceMessageIds: [REQUEST.messageId],
          },
        ],
        proposedActions: [
          {
            actionId: 'action-1',
            actionType: 'schedule_follow_up',
            aggregateType: 'follow_up',
            idempotencyKey: 'idem-1',
            payload: {
              executeAt: '2026-08-07T12:00:00.000Z',
              intent: 'action payload must not enter metadata',
              deduplicationKey: 'follow-up-1',
            },
            validationResult: {
              status: 'pending',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    const metadata = conversationRepo.saveMessage.mock.calls[0]?.[0].metadata;
    expect(metadata).toEqual(expect.objectContaining({
      proposedActionCount: 1,
      memoryCandidateCount: 1,
      proposedActionsDeferred: true,
      memoryCandidatesDeferred: true,
    }));
    expect(JSON.stringify(metadata)).not.toContain('raw memory content');
    expect(JSON.stringify(metadata)).not.toContain('action payload');
  });

  it('persists typed reply planning diagnostics when no reply plan is available', async () => {
    const request: ProcessMessageRequest = {
      ...REQUEST,
      runtimeContext: {
        recentTurns: [],
        memoryItems: [],
        goals: [],
        replyPlanning: {
          status: 'unavailable',
          reason: 'classifier_failed',
        },
      },
    };
    const { runtime, conversationRepo } = createRuntime();

    await runtime.processMessage(request);

    expect(conversationRepo.saveMessage.mock.calls[0]?.[0].metadata).toEqual(expect.objectContaining({
      replyPlanStatus: 'unavailable',
      replyPlanUnavailableReason: 'classifier_failed',
    }));
  });

  it('schedules valid Python follow-up proposals through scheduled action repository', async () => {
    const { runtime, scheduledActionRepo, outbox } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        proposedActions: [
          {
            actionId: 'action-1',
            actionType: 'schedule_follow_up',
            aggregateType: 'follow_up',
            idempotencyKey: 'idem-1',
            payload: {
              executeAt: '2026-08-06T19:00:00.000Z',
              intent: 'candidate follow up',
              deduplicationKey: 'followup:action-1',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(scheduledActionRepo.existsByDeduplicationKey).toHaveBeenCalledWith('followup:action-1');
    expect(scheduledActionRepo.save).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      conversationId: '44444444-4444-4444-8444-444444444444',
      type: 'follow_up',
      intent: 'candidate follow up',
      context: {
        channelType: 'slack',
        externalConversationId: 'channel-1',
        messageStrategy: 'python-suggested-follow-up',
        topic: 'candidate follow up',
        originalReason: 'action-1',
      },
      reason: 'Python workflow follow-up action action-1',
      dueAt: new Date('2026-08-06T19:00:00.000Z'),
      timezone: 'Europe/Warsaw',
      cancellationConditions: [],
      deduplicationKey: 'followup:action-1',
      sourceMessageIds: ['33333333-3333-4333-8333-333333333333'],
    });
    expect(outbox.enqueueFollowUpExecution).toHaveBeenCalledWith({
      scheduledActionId: 'action-id-1',
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      traceId: 'maf-follow-up-action-1',
      dueAt: new Date('2026-08-06T19:00:00.000Z'),
    });
  });

  it('saves valid Python memory proposals through the memory repository', async () => {
    const { runtime, memoryRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        memoryCandidates: [
          {
            actionId: 'memory-candidate-1',
            type: 'preference',
            content: 'Prefers weekly planning checkpoints.',
            confidence: 0.86,
            sourceMessageIds: [REQUEST.messageId],
          },
        ],
        proposedActions: [
          {
            actionId: 'memory-action',
            actionType: 'save_memory',
            aggregateType: 'memory',
            idempotencyKey: 'idem-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(memoryRepo.save).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      category: 'preference',
      canonicalKey: 'memory-candidate-1',
      content: 'Prefers weekly planning checkpoints.',
      confidence: 0.86,
      importance: 0.86,
      sensitivity: 'normal',
      sourceMessageIds: ['33333333-3333-4333-8333-333333333333'],
      extractorVersion: 'maf-primary-proposals',
    });
    expect(memoryRepo.findByCanonicalKey).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      'memory-candidate-1',
      'tenant-1',
    );
  });

  it('skips Python memory proposals when the canonical key already exists', async () => {
    const { runtime, memoryRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        memoryCandidates: [
          {
            actionId: 'memory-candidate-1',
            type: 'preference',
            content: 'Prefers weekly planning checkpoints.',
            confidence: 0.86,
            sourceMessageIds: [REQUEST.messageId],
          },
        ],
        proposedActions: [
          {
            actionId: 'memory-action',
            actionType: 'save_memory',
            aggregateType: 'memory',
            idempotencyKey: 'idem-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
      existingMemoryCandidate: {
        id: 'existing-memory-1',
        tenantId: 'tenant-1',
        userId: '55555555-5555-4555-8555-555555555555',
        category: 'preference',
        content: 'already exists',
        status: 'active',
        sourceMessageIds: [],
        sourceType: 'extraction',
        confidence: 0.8,
        importance: 0.8,
        validFrom: new Date(),
        sensitivity: 'normal',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await runtime.processMessage(REQUEST);

    expect(memoryRepo.findByCanonicalKey).toHaveBeenCalled();
    expect(memoryRepo.save).not.toHaveBeenCalled();
  });

  it('updates goal status through Python goal proposals when update_goal contains supported status', async () => {
    const { runtime, goalRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        proposedActions: [
          {
            actionId: 'goal-action-1',
            actionType: 'update_goal',
            aggregateType: 'goal',
            idempotencyKey: 'idem-goal',
            payload: {
              goalId: 'goal-1',
              changes: { status: 'completed', title: 'ignored' },
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(goalRepo.updateStatus).toHaveBeenCalledWith('goal-1', 'completed', 'tenant-1');
  });

  it('ignores Python goal proposals with unsupported status updates', async () => {
    const { runtime, goalRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        proposedActions: [
          {
            actionId: 'goal-action-1',
            actionType: 'update_goal',
            aggregateType: 'goal',
            idempotencyKey: 'idem-goal',
            payload: {
              goalId: 'goal-1',
              changes: { status: 'archived' },
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(goalRepo.updateStatus).not.toHaveBeenCalled();
  });

  it('does not schedule invalid follow-up proposals from MAF', async () => {
    const { runtime, scheduledActionRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        proposedActions: [
          {
            actionId: 'action-blocked',
            actionType: 'schedule_follow_up',
            aggregateType: 'follow_up',
            idempotencyKey: 'idem-blocked',
            payload: {
              executeAt: '2026-08-06T19:00:00.000Z',
              intent: 'candidate follow up',
              deduplicationKey: 'followup:action-blocked',
            },
            validationResult: {
              status: 'invalid',
              reasonCodes: ['policy_block'],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(scheduledActionRepo.save).not.toHaveBeenCalled();
  });

  it('ignores non-follow-up Python proposals by default (deferred to TS-owned workflows)', async () => {
    const { runtime, scheduledActionRepo } = createRuntime({
      runtimeResult: {
        ...RUNTIME_RESULT,
        proposedActions: [
          {
            actionId: 'memory-action',
            actionType: 'save_memory',
            aggregateType: 'memory',
            idempotencyKey: 'idem-memory',
            payload: {
              memoryCandidateId: 'memory-candidate-1',
            },
            validationResult: {
              status: 'valid',
              reasonCodes: [],
            },
            executionStatus: 'not_started',
            commitMarker: null,
          },
        ],
      },
    });

    await runtime.processMessage(REQUEST);

    expect(scheduledActionRepo.save).not.toHaveBeenCalled();
  });

  it('does not commit TypeScript side effects when the Python candidate fails', async () => {
    const failure = new Error('maf_runtime_fetch_failed');
    const { runtime, mafRuntime, conversationRepo, outbox } = createRuntime({
      runtimeResult: Promise.reject(failure),
    });

    await expect(runtime.processMessage(REQUEST)).rejects.toThrow(failure);

    expect(mafRuntime.processCandidate).toHaveBeenCalledWith(REQUEST);
    expect(conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(outbox.enqueueMessageSend).not.toHaveBeenCalled();
    expect(outbox.enqueueMemoryExtraction).not.toHaveBeenCalled();
    expect(outbox.enqueueSurveyEvidence).not.toHaveBeenCalled();
  });

  it('fails before writing when the conversation cannot be found', async () => {
    const { runtime, conversationRepo, outbox } = createRuntime({ conversationFound: false });

    await expect(runtime.processMessage(REQUEST)).rejects.toThrow(
      'Conversation 44444444-4444-4444-8444-444444444444 not found',
    );

    expect(conversationRepo.saveMessage).not.toHaveBeenCalled();
    expect(outbox.enqueueMessageSend).not.toHaveBeenCalled();
  });
});

function createRuntime(options: {
  runtimeResult?: RuntimeResult | Promise<RuntimeResult>;
  conversationFound?: boolean;
  featureFlags?: { isEnabled(flag: string, context: { tenantId: string; userId?: string }): Promise<boolean> };
  existingScheduledAction?: boolean;
  existingMemoryCandidate?: {
    id: string;
    tenantId: string;
    userId: string;
    category: string;
    content: string;
    status: string;
    sourceMessageIds: string[];
    sourceType: string;
    confidence: number;
    importance: number;
    validFrom: Date;
    sensitivity: string;
    createdAt: Date;
    updatedAt: Date;
  };
  memoryRepo?: MemoryRepositoryPort;
  goalRepo?: GoalRepositoryPort;
} = {}) {
  const mafRuntime = {
    getConfigurationDiagnostic: vi.fn(() => null),
    processCandidate: vi.fn(async () => options.runtimeResult ?? RUNTIME_RESULT),
  };
  const conversationRepo = {
    findById: vi.fn(async () => (
      options.conversationFound === false
        ? null
        : {
            id: '44444444-4444-4444-8444-444444444444',
            tenantId: 'tenant-1',
            userId: '55555555-5555-4555-8555-555555555555',
            channelType: 'slack',
            externalConversationId: 'channel-1',
            status: 'active',
            userTimezone: 'Europe/Warsaw',
            userTimezoneUpdatedAt: new Date(),
          }
    )),
    findRecentMessages: vi.fn(async () => []),
    saveMessage: vi.fn(async (params) => ({
      id: 'outbound-1',
      ...params,
      occurredAt: params.occurredAt ?? new Date(),
      createdAt: new Date(),
    })),
    updateMessageDelivery: vi.fn(async () => undefined),
  } satisfies ConversationRepositoryPort;
  const outbox = {
    enqueueMessageSend: vi.fn(async () => undefined),
    enqueueMemoryExtraction: vi.fn(async () => undefined),
    enqueueFollowUpExecution: vi.fn(async () => undefined),
    enqueueSurveyEvidence: vi.fn(async () => undefined),
    enqueueGroupReport: vi.fn(async () => undefined),
    enqueueStyleAnalysis: vi.fn(async () => undefined),
    enqueueProfileHydration: vi.fn(async () => undefined),
  } satisfies OutboxPort;
  const featureFlags = options.featureFlags ?? {
    isEnabled: vi.fn(async () => true),
  };
  const riskSignalRepo = {
    save: vi.fn(async (params) => ({
      id: 'risk-1',
      status: 'active',
      detectedAt: new Date(),
      ...params,
    })),
    findActiveByUser: vi.fn(async () => []),
    resolve: vi.fn(async () => undefined),
  };
  const escalation = {
    raise: vi.fn(async () => undefined),
  };
  const scheduledActionRepo = {
    save: vi.fn(async () => ({
      id: 'action-id-1',
      tenantId: 'tenant-1',
      userId: '55555555-5555-4555-8555-555555555555',
      conversationId: '44444444-4444-4444-8444-444444444444',
      type: 'follow_up',
      intent: 'candidate follow up',
      context: { channelType: 'slack', externalConversationId: 'channel-1', messageStrategy: 'python-suggested-follow-up' },
      dueAt: new Date(),
      timezone: 'UTC',
      status: 'pending',
      cancellationConditions: [],
      sourceMessageIds: ['33333333-3333-4333-8333-333333333333'],
      deduplicationKey: 'followup:action-1',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findById: vi.fn(),
    markSent: vi.fn(),
    cancel: vi.fn(),
    postpone: vi.fn(),
    existsByDeduplicationKey: vi.fn(async () => options.existingScheduledAction ?? false),
    cancelPendingByUserAndType: vi.fn(async () => undefined),
  } satisfies ScheduledActionRepositoryPort;
  const memoryRepo: MemoryRepositoryPort = options.memoryRepo ?? {
    findActiveByUser: vi.fn(async () => []),
    findByCanonicalKey: vi.fn(async () => options.existingMemoryCandidate ?? null),
    findById: vi.fn(async () => null),
    save: vi.fn(async (params: SaveMemoryItemParams) => ({
      id: 'memory-1',
      tenantId: params.tenantId,
      userId: params.userId,
      category: params.category,
      canonicalKey: params.canonicalKey,
      content: params.content,
      structuredValue: params.structuredValue,
      confidence: params.confidence,
      importance: params.importance,
      sensitivity: params.sensitivity,
      status: 'active',
      sourceMessageIds: params.sourceMessageIds,
      sourceType: 'extraction',
      validFrom: new Date(),
      expiresAt: params.expiresAt,
      supersededById: undefined,
      extractorVersion: params.extractorVersion,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    supersede: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
  };
  const goalRepo: GoalRepositoryPort = options.goalRepo ?? {
    findActiveByUser: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    save: vi.fn(async (params: SaveGoalParams) => ({
      id: 'goal-1',
      tenantId: params.tenantId,
      userId: params.userId,
      title: params.title,
      description: params.description,
      category: params.category,
      status: 'active',
      priority: 'medium',
      confidence: params.confidence,
      targetDate: params.targetDate,
      sourceMessageIds: params.sourceMessageIds,
      completedAt: undefined,
      cancelledAt: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateStatus: vi.fn(async () => undefined),
  };

  return {
    runtime: new MafPrimaryAgentRuntime(
      conversationRepo,
      outbox,
      mafRuntime,
      featureFlags,
      riskSignalRepo,
      escalation,
      scheduledActionRepo,
      memoryRepo,
      goalRepo,
    ),
    mafRuntime,
    conversationRepo,
    outbox,
    riskSignalRepo,
    escalation,
    scheduledActionRepo,
    memoryRepo,
    goalRepo,
  };
}
