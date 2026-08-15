import { describe, expect, it, vi } from 'vitest';
import { UserDataController } from './user-data.controller';

const USER_ID = '9d1e0163-6d53-4713-bd24-254690cc5090';

describe('UserDataController GDPR privacy regression', () => {
  it('exports the allowlisted user data groups and audits access', async () => {
    const auditLog = { append: vi.fn() };
    const controller = new UserDataController(
      {
        client: {
          select: vi.fn()
            .mockReturnValueOnce(queryLimit([
              {
                id: USER_ID,
                preferredName: 'Alex',
                timezone: 'Europe/Warsaw',
                proactiveMessagingEnabled: true,
                quietHours: { start: '22:00', end: '07:00' },
                onboardingStatus: 'complete',
                consentState: 'granted',
                createdAt: new Date('2026-08-15T09:00:00.000Z'),
              },
            ]))
            .mockReturnValueOnce(queryOrderLimit([
              {
                id: 'message-1',
                direction: 'inbound',
                text: 'portable message text',
                occurredAt: new Date('2026-08-15T09:00:00.000Z'),
                messageType: 'text',
              },
            ]))
            .mockReturnValueOnce(queryWhere([
              {
                id: 'memory-1',
                category: 'preference',
                content: 'Prefers concise updates',
                status: 'active',
                createdAt: new Date('2026-08-15T09:00:00.000Z'),
              },
            ]))
            .mockReturnValueOnce(queryWhere([
              { id: 'goal-1', title: 'Finish migration', status: 'active', targetDate: null },
            ]))
            .mockReturnValueOnce(queryWhere([
              {
                id: 'action-1',
                type: 'follow_up',
                intent: 'check_in',
                dueAt: new Date('2026-08-16T09:00:00.000Z'),
                status: 'pending',
              },
            ])),
        },
      } as never,
      auditLog as never,
    );

    const response = await controller.export(USER_ID);

    expect(auditLog.append).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'user',
      actorId: USER_ID,
      action: 'user.data_exported',
      resourceType: 'user',
      resourceId: USER_ID,
    }));
    expect(Object.keys(response).sort()).toEqual([
      'exportedAt',
      'goals',
      'memoryItems',
      'messages',
      'scheduledActions',
      'user',
    ]);
    expect(response['user']).toMatchObject({
      id: USER_ID,
      preferredName: 'Alex',
      timezone: 'Europe/Warsaw',
    });
  });

  it('anonymizes deleted user data, cancels side effects, resolves risks, and audits deletion', async () => {
    const auditLog = { append: vi.fn() };
    const sets: unknown[] = [];
    const controller = new UserDataController(
      {
        client: {
          update: vi.fn(() => ({
            set: vi.fn((value: unknown) => {
              sets.push(value);
              return { where: vi.fn(async () => []) };
            }),
          })),
        },
      } as never,
      auditLog as never,
    );

    await expect(controller.delete(USER_ID)).resolves.toEqual({
      accepted: true,
      message: 'User data has been anonymized and scheduled for permanent deletion.',
    });

    expect(auditLog.append).toHaveBeenCalledWith(expect.objectContaining({
      actorType: 'user',
      actorId: USER_ID,
      action: 'user.data_deletion_requested',
      resourceType: 'user',
      resourceId: USER_ID,
    }));
    expect(sets).toEqual([
      expect.objectContaining({ text: '[deleted]', normalizedText: null, deletedAt: expect.any(Date) }),
      expect.objectContaining({ status: 'deleted', content: '[deleted]', updatedAt: expect.any(Date) }),
      expect.objectContaining({
        title: '[deleted]',
        description: null,
        status: 'cancelled',
        sourceMessageIds: [],
        updatedAt: expect.any(Date),
      }),
      expect.objectContaining({ status: 'cancelled', updatedAt: expect.any(Date) }),
      expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) }),
      expect.objectContaining({
        status: 'deleted',
        preferredName: null,
        timezone: null,
        timezoneUpdatedAt: null,
        communicationPreferences: {},
        proactiveMessagingEnabled: false,
        quietHours: { enabled: false },
        consentState: {},
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    ]);
  });
});

function queryLimit(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => rows) })) })) };
}

function queryOrderLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })) })),
    })),
  };
}

function queryWhere(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) };
}
