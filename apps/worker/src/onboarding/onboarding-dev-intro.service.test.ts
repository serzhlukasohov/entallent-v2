import { describe, expect, it, vi } from 'vitest';
import { OnboardingDevIntroService } from './onboarding-dev-intro.service';

function fakeDb(personRows: unknown[]) {
  const inserted: unknown[] = [];
  const db = {
    client: {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => personRows }) }) })),
      insert: vi.fn(() => ({ values: (v: unknown) => { inserted.push(v); return { onConflictDoNothing: async () => undefined }; } })),
    },
  };
  return { db, inserted };
}

const target = { conversationId: 'c1', channelType: 'dev', externalConversationId: 'dev-conv-alice', externalWorkspaceId: 'dev-workspace' };

describe('OnboardingDevIntroService', () => {
  it('seeds a fresh state version and sends the intro for the current role', async () => {
    const { db, inserted } = fakeDb([{ role: 'team_lead' }]);
    const effects = { findDeliveryTarget: vi.fn().mockResolvedValue(target) };
    const intro = { sendIntro: vi.fn().mockResolvedValue({ introMessageId: 'i', trustMessageId: 't' }) };
    await new OnboardingDevIntroService(db as never, effects as never, intro as never).send('t1', 'p1', 1_791_000_000);
    expect(inserted).toEqual([expect.objectContaining({
      tenantId: 't1', personId: 'p1', track: 'team_lead', participation: 'undecided', version: 1_791_000_000, buttonsActive: false,
    })]);
    expect(intro.sendIntro).toHaveBeenCalledWith({
      tenantId: 't1', personId: 'p1', role: 'team_lead', version: 1_791_000_000,
      conversation: { id: 'c1', channelType: 'dev', externalConversationId: 'dev-conv-alice', externalWorkspaceId: 'dev-workspace' },
    });
  });

  it('fails without a person or a delivery target', async () => {
    const intro = { sendIntro: vi.fn() };
    await expect(new OnboardingDevIntroService(fakeDb([]).db as never,
      { findDeliveryTarget: vi.fn().mockResolvedValue(target) } as never, intro as never).send('t1', 'p1', 1))
      .rejects.toThrow('dev_person_missing');
    await expect(new OnboardingDevIntroService(fakeDb([{ role: 'employee' }]).db as never,
      { findDeliveryTarget: vi.fn().mockResolvedValue(null) } as never, intro as never).send('t1', 'p1', 1))
      .rejects.toThrow('dev_delivery_target_missing');
    expect(intro.sendIntro).not.toHaveBeenCalled();
  });
});
