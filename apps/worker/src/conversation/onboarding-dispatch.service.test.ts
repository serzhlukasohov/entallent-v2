import { describe, expect, it, vi } from 'vitest';
import { channelAccounts, conversations, orgOnboardingDeliveries, people } from '@entalent/database';
import { OnboardingDispatchService } from './onboarding-dispatch.service';

const slack = vi.hoisted(() => ({ openDirectMessage: vi.fn() }));
vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class { openDirectMessage = slack.openDirectMessage; },
}));

describe('OnboardingDispatchService', () => {
  it('opens the linked DM, creates a conversation, and queues one first-contact message', async () => {
    slack.openDirectMessage.mockResolvedValue('D123');
    const delivery = {
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 'tenant-1', personId: 'person-1', externalWorkspaceId: 'T123',
      status: 'pending', createdAt: new Date(),
    };
    const from = vi.fn().mockImplementation((table: unknown) => {
      if (table === orgOnboardingDeliveries) {
        return { where: () => ({ orderBy: () => ({ limit: async () => [delivery] }) }) };
      }
      if (table === people) {
        return { innerJoin: () => ({ where: () => ({ limit: async () => [{
          lifecycleStatus: 'active', pulseParticipant: false, userStatus: 'active', deletedAt: null,
        }] }) }) };
      }
      if (table === channelAccounts) {
        return { where: () => ({ limit: async () => [{ externalUserId: 'U123' }] }) };
      }
      if (table === conversations) {
        return { where: () => ({ limit: async () => [{
          id: 'conversation-1', userId: 'person-1', status: 'active',
        }] }) };
      }
      throw new Error('unexpected table');
    });
    const select = vi.fn().mockReturnValue({ from });
    const insert = vi.fn().mockReturnValue({ values: () => ({ onConflictDoNothing: async () => undefined }) });
    const execute = vi.fn().mockResolvedValue({ outboundMessageId: delivery.id });
    const service = new OnboardingDispatchService(
      { client: { select, insert } } as never,
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      { execute } as never,
    );

    expect(await service.dispatchPending('tenant-1')).toEqual({ found: 1, queued: 1, failed: 0 });
    expect(slack.openDirectMessage).toHaveBeenCalledWith('U123');
    expect(insert).toHaveBeenCalledWith(conversations);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', userId: 'person-1', conversationId: 'conversation-1',
      externalConversationId: 'D123', onboardingMessageId: delivery.id, pulseEnabled: false,
    }));
  });
});
