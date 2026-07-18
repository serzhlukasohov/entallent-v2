import { describe, it, expect } from 'vitest';
import { isWithinQuietHours, canReceiveProactiveMessage } from './user';
import type { User } from './user';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    status: 'active',
    preferredName: 'Alice',
    timezone: 'Europe/Berlin',
    locale: 'en',
    communicationPreferences: { language: 'en', responseStyle: 'default' },
    proactiveMessagingEnabled: true,
    quietHours: { enabled: false, startTime: '22:00', endTime: '09:00' },
    onboardingStatus: 'completed',
    consentState: {
      platformTermsAccepted: true,
      aiProcessingConsented: true,
      surveyParticipationConsented: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('isWithinQuietHours', () => {
  it('returns false when quiet hours disabled', () => {
    const user = makeUser({ quietHours: { enabled: false, startTime: '22:00', endTime: '09:00' } });
    const date = new Date('2024-01-01T23:00:00Z'); // 11pm UTC
    expect(isWithinQuietHours(user, date)).toBe(false);
  });

  it('detects quiet hours that do not span midnight', () => {
    const user = makeUser({
      quietHours: { enabled: true, startTime: '13:00', endTime: '14:00', timezone: 'UTC' },
    });
    const inside = new Date('2024-01-01T13:30:00Z');
    const outside = new Date('2024-01-01T14:30:00Z');
    expect(isWithinQuietHours(user, inside)).toBe(true);
    expect(isWithinQuietHours(user, outside)).toBe(false);
  });

  it('detects quiet hours spanning midnight', () => {
    const user = makeUser({
      quietHours: { enabled: true, startTime: '22:00', endTime: '09:00', timezone: 'UTC' },
    });
    const midNight = new Date('2024-01-01T23:30:00Z');
    const earlyMorning = new Date('2024-01-01T08:00:00Z');
    const daytime = new Date('2024-01-01T10:00:00Z');
    expect(isWithinQuietHours(user, midNight)).toBe(true);
    expect(isWithinQuietHours(user, earlyMorning)).toBe(true);
    expect(isWithinQuietHours(user, daytime)).toBe(false);
  });
});

describe('canReceiveProactiveMessage', () => {
  it('returns true for active user with proactive enabled and tenant enabled', () => {
    const user = makeUser({ proactiveMessagingEnabled: true, status: 'active' });
    expect(canReceiveProactiveMessage(user, true)).toBe(true);
  });

  it('returns false when tenant has proactive disabled', () => {
    const user = makeUser({ proactiveMessagingEnabled: true, status: 'active' });
    expect(canReceiveProactiveMessage(user, false)).toBe(false);
  });

  it('returns false when user has proactive disabled', () => {
    const user = makeUser({ proactiveMessagingEnabled: false, status: 'active' });
    expect(canReceiveProactiveMessage(user, true)).toBe(false);
  });

  it('returns false for deleted user', () => {
    const user = makeUser({ status: 'deleted' });
    expect(canReceiveProactiveMessage(user, true)).toBe(false);
  });
});
