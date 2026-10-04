import { describe, expect, it, vi } from 'vitest';
import { CompanyOnboardingSettingsService } from './company-onboarding-settings.service';
import { defaultOnboardingSettings } from '@entalent/application';

describe('CompanyOnboardingSettingsService', () => {
  it('preserves unrelated tenant cadence settings and audits defaults without personal content', async () => {
    const tenant = { timezone: 'UTC', locale: 'en', proactiveMessagingPolicy: { ignoreWindowHours: 48, enabled: true } };
    const saved: unknown[] = [];
    const audit = vi.fn();
    const tx = {
      select: () => ({ from() { return this; }, where() { return this; }, for() { return this; }, limit: async () => [tenant] }),
      update: () => ({ set: (values: unknown) => ({ where: async () => { saved.push(values); } }) }),
      insert: () => ({ values: audit }),
    };
    const service = new CompanyOnboardingSettingsService({ client: { transaction: (run: (db: unknown) => unknown) => run(tx) } } as never);
    const settings = { ...defaultOnboardingSettings('Europe/Warsaw'), defaultLanguage: 'ru' as const };
    expect(await service.save('tenant', settings, { type: 'internal_operator', operatorId: 'operator' })).toEqual(settings);
    expect(saved[0]).toMatchObject({ timezone: 'Europe/Warsaw', locale: 'ru', proactiveMessagingPolicy: { enabled: true, ignoreWindowHours: 48, onboarding: settings } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'company.onboarding_settings.updated', tenantId: 'tenant' }));
  });
});
