import {
  FollowUpExecutionUseCase,
  type FollowUpContextData,
  type FollowUpContextPort,
  type OutboxPort,
} from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { createCoachAgent } from '../harness/coach-agent';
import { InMemoryConversationRepository, InMemoryScheduledActionRepository } from '../fakes/repositories';
import { ScriptedAiProvider, makeClassification, makeRisk } from '../fakes/scripted-ai';
import {
  expectNoDeterministicViolations,
  reportDeterministicPolicyRun,
  reportDeterministicRun,
} from './baseline-test-helpers';

describe('migration baseline: proactivity and reminders', () => {
  it('does not invent reminders or follow-ups when the user did not ask', async () => {
    const scheduledActions = new InMemoryScheduledActionRepository();
    const { harness } = createCoachAgent({
      userName: 'Ira',
      scheduledActionRepo: scheduledActions,
      aiProvider: new ScriptedAiProvider({
        classifications: [
          makeClassification({
            primaryIntent: 'casual_conversation',
            reminderRequest: null,
            latestUserSubstance: 'ordinary update',
          }),
        ],
        responses: [
          {
            text: 'Nice, sounds like a normal update.',
            confidence: 0.9,
            containsSurveyProbe: false,
          },
        ],
      }),
    });

    await harness.send('Small update: the design review went fine.');
    await reportDeterministicRun('unwanted proactivity', harness);

    expectNoDeterministicViolations(harness);
    expect(scheduledActions.actions).toHaveLength(0);
    expect(harness.turns[0]?.classification.reminderRequest).toBeNull();
  });

  it('schedules one explicit reminder and deduplicates the repeated request', async () => {
    const scheduledActions = new InMemoryScheduledActionRepository();
    const dueAt = '2026-08-06T09:00:00.000Z';
    const aiProvider = new ScriptedAiProvider({
      classifications: [
        makeClassification({
          primaryIntent: 'support',
          reminderRequest: { intent: 'send the assessment notes', dueAt },
          latestUserSubstance: 'explicit reminder request',
        }),
      ],
      responses: [
        ({ context }) => ({
          text: `Reminder acknowledged: ${context.reminderConfirmation?.intent ?? 'none'}.`,
          confidence: 0.9,
          containsSurveyProbe: false,
        }),
      ],
    });
    const { harness } = createCoachAgent({
      userName: 'Ira',
      scheduledActionRepo: scheduledActions,
      aiProvider,
    });

    await harness.send('Remind me tomorrow morning to send the assessment notes.');
    await harness.send('Remind me tomorrow morning to send the assessment notes.');
    await reportDeterministicRun('explicit reminder', harness);

    expectNoDeterministicViolations(harness);
    expect(scheduledActions.actions).toHaveLength(1);
    expect(scheduledActions.actions[0]).toMatchObject({
      type: 'user_reminder',
      intent: 'send the assessment notes',
      status: 'pending',
    });
  });

  it('postpones delayed follow-up execution during active high-risk state', async () => {
    const scheduledActions = new InMemoryScheduledActionRepository();
    const action = await scheduledActions.save({
      tenantId: 'sim-tenant',
      userId: 'sim-user',
      conversationId: 'sim-conversation',
      type: 'follow_up',
      intent: 'check in about the project decision',
      context: {
        channelType: 'sim',
        externalConversationId: 'sim-channel',
        originalReason: 'Synthetic follow-up',
        messageStrategy: 'Ask whether the decision got easier.',
      },
      dueAt: new Date(Date.now() - 1000),
      timezone: 'America/New_York',
      cancellationConditions: [],
      sourceMessageIds: ['msg-1'],
    });
    const outbox = new RecordingOutbox();
    const useCase = new FollowUpExecutionUseCase(
      scheduledActions,
      new StaticFollowUpContext({ hasActiveHighRisk: true }),
      new InMemoryConversationRepository({
        id: 'sim-conversation',
        tenantId: 'sim-tenant',
        userId: 'sim-user',
        channelType: 'sim',
        externalConversationId: 'sim-channel',
        status: 'active',
        userTimezone: 'Europe/Berlin',
      }),
      outbox,
      new ScriptedAiProvider({ risks: [makeRisk()] }),
    );

    const decision = await useCase.execute({
      scheduledActionId: action.id,
      tenantId: 'sim-tenant',
      userId: 'sim-user',
    });

    expect(decision).toEqual({ decision: 'postpone', reason: 'active_risk_signal' });
    expect(scheduledActions.actions[0]?.status).toBe('pending');
    expect(scheduledActions.actions[0]?.attemptCount).toBe(1);
    expect(outbox.sentMessages).toHaveLength(0);
    reportDeterministicPolicyRun('delayed follow-up active risk', [
      {
        rule: 'active-risk-postpones-follow-up',
        passed: decision.decision === 'postpone' && decision.reason === 'active_risk_signal',
        detail: `expected active_risk_signal postpone, got ${decision.decision}:${decision.reason}`,
      },
      {
        rule: 'active-risk-sends-no-follow-up',
        passed: outbox.sentMessages.length === 0,
        detail: `expected no outbox sends, got ${outbox.sentMessages.length}`,
      },
    ]);
  });

  it('cancels delayed follow-up execution when proactive messaging is disabled', async () => {
    const scheduledActions = new InMemoryScheduledActionRepository();
    const action = await scheduledActions.save({
      tenantId: 'sim-tenant',
      userId: 'sim-user',
      conversationId: 'sim-conversation',
      type: 'follow_up',
      intent: 'check in about the project decision',
      context: {
        channelType: 'sim',
        externalConversationId: 'sim-channel',
        originalReason: 'Synthetic follow-up',
        messageStrategy: 'Ask whether the decision got easier.',
      },
      dueAt: new Date(Date.now() - 1000),
      timezone: 'America/New_York',
      cancellationConditions: [],
      sourceMessageIds: ['msg-1'],
    });
    const outbox = new RecordingOutbox();
    const useCase = new FollowUpExecutionUseCase(
      scheduledActions,
      new StaticFollowUpContext({
        user: {
          proactiveMessagingEnabled: false,
          timezone: 'America/New_York',
          quietHours: { enabled: false },
          preferredName: 'Ira',
        },
      }),
      new InMemoryConversationRepository({
        id: 'sim-conversation',
        tenantId: 'sim-tenant',
        userId: 'sim-user',
        channelType: 'sim',
        externalConversationId: 'sim-channel',
        status: 'active',
        userTimezone: 'Europe/Berlin',
      }),
      outbox,
      new ScriptedAiProvider({ risks: [makeRisk()] }),
    );

    const decision = await useCase.execute({
      scheduledActionId: action.id,
      tenantId: 'sim-tenant',
      userId: 'sim-user',
    });

    expect(decision).toEqual({ decision: 'cancel', reason: 'proactive_disabled' });
    expect(scheduledActions.actions[0]?.status).toBe('cancelled');
    expect(outbox.sentMessages).toHaveLength(0);
    reportDeterministicPolicyRun('delayed follow-up proactive disabled', [
      {
        rule: 'disabled-proactivity-cancels-follow-up',
        passed: decision.decision === 'cancel' && decision.reason === 'proactive_disabled',
        detail: `expected proactive_disabled cancel, got ${decision.decision}:${decision.reason}`,
      },
      {
        rule: 'disabled-proactivity-sends-no-follow-up',
        passed: outbox.sentMessages.length === 0,
        detail: `expected no outbox sends, got ${outbox.sentMessages.length}`,
      },
    ]);
  });
});

class StaticFollowUpContext implements FollowUpContextPort {
  constructor(private readonly overrides: Partial<FollowUpContextData> = {}) {}

  async load(): Promise<FollowUpContextData> {
    return {
      user: {
        proactiveMessagingEnabled: true,
        timezone: 'America/New_York',
        quietHours: { enabled: false },
        preferredName: 'Ira',
      },
      conversation: {
        id: 'sim-conversation',
        tenantId: 'sim-tenant',
        userId: 'sim-user',
        channelType: 'sim',
        externalConversationId: 'sim-channel',
        status: 'active',
      },
      workspaceConnection: null,
      lastInboundAt: null,
      recentProactiveCount24h: 0,
      recentProactiveCount7d: 0,
      hasActiveHighRisk: false,
      ...this.overrides,
    };
  }
}

class RecordingOutbox implements OutboxPort {
  readonly sentMessages: string[] = [];

  async enqueueMessageSend(payload: { text: string }): Promise<void> {
    this.sentMessages.push(payload.text);
  }

  async enqueueMemoryExtraction(): Promise<void> {}
  async enqueueFollowUpExecution(): Promise<void> {}
  async enqueueSurveyEvidence(): Promise<void> {}
  async enqueueGroupReport(): Promise<void> {}
  async enqueueStyleAnalysis(): Promise<void> {}
  async enqueueProfileHydration(): Promise<void> {}
}
