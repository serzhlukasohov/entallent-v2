import { describe, expect, it, vi } from 'vitest';
import { initialOnboardingState } from '@entalent/application';
import { users, people, conversations, messages } from '@entalent/database';
import { OnboardingFlowService } from './onboarding-flow.service';

function fixture(role = 'employee') {
  const user = { id: 'user', tenantId: 'tenant', status: 'active', deletedAt: null, locale: 'en', preferredName: 'Alex',
    communicationPreferences: { onboarding: initialOnboardingState() }, consentState: { approvedInsights: [] },
    proactiveMessagingEnabled: false, onboardingStatus: 'in_progress' };
  const records: Array<Record<string, unknown>> = [{ id: 'inbound', text: 'onboarding:start', direction: 'inbound' }];
  let messageReads = 0;
  const query = (rows: unknown[]) => ({ where() { return this; }, for() { return this; }, limit: async () => rows });
  const client = {
    select: vi.fn(() => ({ from: (table: unknown) => {
      if (table === users) return query([user]);
      if (table === people) return query([{ primaryRole: role, lifecycleStatus: 'active', pulseParticipant: ['employee', 'team_lead'].includes(role) }]);
      if (table === conversations) return query([{ externalConversationId: 'D1' }]);
      if (table === messages) {
        messageReads++;
        if (messageReads % 4 === 1) return query([records[0]]);
        if (messageReads % 4 === 2) return query([{ metadata: { onboardingVersion: 'v2.1' } }]);
        if (messageReads % 4 === 3) return query(records.slice(1));
        return query(records.slice(1));
      }
      throw new Error('unexpected table');
    } })),
    update: vi.fn(() => ({ set: (values: Record<string, unknown>) => ({ where: async () => Object.assign(user, values) }) })),
    insert: vi.fn(() => ({ values: async (values: Record<string, unknown>) => { records.push(values); } })),
    transaction: async (run: (tx: unknown) => unknown) => run(client),
  };
  const outbox = { enqueueMessageSend: vi.fn() };
  const backlog = { getNextProbeQuestion: vi.fn().mockResolvedValue({ question: { id: 'q1', probeStrategies: ['Ask about autonomy'] }, windowId: 'window' }), recordProbeSent: vi.fn() };
  const ai = { generateResponse: vi.fn().mockResolvedValue({ text: 'How much say do you have in your work?', containsSurveyProbe: true, surveyProbeQuestionId: 'q1' }) };
  const service = new OnboardingFlowService({ client } as never, outbox as never, backlog as never, ai as never);
  const input = { requestId: 'r', eventId: 'e', messageId: 'inbound', conversationId: 'conversation', userId: 'user', tenantId: 'tenant',
    externalWorkspaceId: 'T1', externalConversationId: 'D1', traceId: 'trace', onboardingAction: { action: 'start' as const, parentMessageTs: '1720000000.123456' } };
  return { service, input, user, records, ai, backlog, outbox };
}
describe('OnboardingFlowService', () => {
  it('starts the first backlog topic once and repairs an outbox enqueue on replay', async () => {
    const f = fixture();
    f.outbox.enqueueMessageSend.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(f.service.handleInbound(f.input)).rejects.toThrow('redis unavailable');
    expect(f.user.onboardingStatus).toBe('completed');
    expect(f.user.proactiveMessagingEnabled).toBe(true);
    expect(f.user.consentState).toEqual({ approvedInsights: [] });
    await f.service.handleInbound(f.input);
    expect(f.ai.generateResponse).toHaveBeenCalledTimes(1);
    expect(f.records).toHaveLength(2);
    expect(f.outbox.enqueueMessageSend).toHaveBeenCalledTimes(2);
  });
  it.each(['employee', 'team_lead'])('declines personal invitations for %s without changing insight consent', async (role) => {
    const f = fixture(role);
    await f.service.handleInbound({ ...f.input, onboardingAction: { ...f.input.onboardingAction, action: 'decline' } });
    expect(f.user.proactiveMessagingEnabled).toBe(false);
    expect(f.user.communicationPreferences.onboarding.personalParticipation).toBe('declined');
    expect(f.user.communicationPreferences.onboarding.reminderQueued).toBe(true);
    expect(f.user.onboardingStatus).toBe(role === 'team_lead' ? 'completed' : 'declined');
    expect(f.user.consentState).toEqual({ approvedInsights: [] });
    expect(f.backlog.getNextProbeQuestion).not.toHaveBeenCalled();
  });
  it('Got It completes Team Lead management onboarding without enabling personal Pulse', async () => {
    const f = fixture('team_lead');
    await f.service.handleInbound({ ...f.input, onboardingAction: { ...f.input.onboardingAction, action: 'got_it' } });
    expect(f.user.onboardingStatus).toBe('completed');
    expect(f.user.proactiveMessagingEnabled).toBe(false);
    expect(f.user.communicationPreferences.onboarding.managementCompleted).toBe(true);
    expect(f.user.communicationPreferences.onboarding.personalParticipation).toBe('undecided');
    expect(f.ai.generateResponse).not.toHaveBeenCalled();
  });
  it('Later defers participation without resetting the reminder budget', async () => {
    const f = fixture();
    await f.service.handleInbound({ ...f.input, onboardingAction: { ...f.input.onboardingAction, action: 'later' } });
    expect(f.user.onboardingStatus).toBe('deferred');
    expect(f.user.proactiveMessagingEnabled).toBe(false);
    expect(f.user.communicationPreferences.onboarding.deferredAt).toBeDefined();
    expect(f.ai.generateResponse).not.toHaveBeenCalled();
  });
  it('cannot start personal Pulse for a Manager even with a valid Slack click', async () => {
    const f = fixture('manager');
    await f.service.handleInbound(f.input);
    expect(f.user.proactiveMessagingEnabled).toBe(false);
    expect(f.backlog.getNextProbeQuestion).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(1);
  });
});
