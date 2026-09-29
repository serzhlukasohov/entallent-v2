import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
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

  it('does not log provider error text when onboarding preparation fails', async () => {
    const privateMarker = 'private employee content';
    slack.openDirectMessage.mockRejectedValueOnce(new Error(privateMarker));
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const delivery = {
      id: '00000000-0000-4000-8000-000000000002',
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
      throw new Error('unexpected table');
    });
    const update = vi.fn().mockReturnValue({
      set: () => ({ where: async () => undefined }),
    });
    const service = new OnboardingDispatchService(
      { client: { select: () => ({ from }), update } } as never,
      { findByExternalWorkspace: vi.fn().mockResolvedValue({ botToken: 'test-token' }) } as never,
      { execute: vi.fn() } as never,
    );

    try {
      expect(await service.dispatchPending('tenant-1')).toEqual({ found: 1, queued: 0, failed: 1 });
      expect(update).toHaveBeenCalledWith(orgOnboardingDeliveries);
      expect(log).toHaveBeenCalledWith(`onboarding_preparation_failed delivery=${delivery.id}`);
      expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    } finally {
      log.mockRestore();
    }
  });
});
