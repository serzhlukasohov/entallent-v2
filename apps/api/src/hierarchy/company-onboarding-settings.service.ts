import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { auditLogs, tenants } from '@entalent/database';
import { CompanyOnboardingSettingsSchema, type CompanyOnboardingSettings } from '@entalent/contracts';
import { defaultOnboardingSettings } from '@entalent/application';
import { DatabaseService } from '../database/database.service';
import { actorId, assertHierarchyActorAuthorized, type HierarchyActor } from './hierarchy-authorization';

@Injectable()
export class CompanyOnboardingSettingsService {
  constructor(private readonly db: DatabaseService) {}
  async read(tenantId: string): Promise<CompanyOnboardingSettings> {
    const [tenant] = await this.db.client.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error('company_not_found');
    const parsed = CompanyOnboardingSettingsSchema.safeParse((tenant.proactiveMessagingPolicy as Record<string, unknown>).onboarding);
    return parsed.success ? parsed.data : defaultOnboardingSettings(tenant.timezone,
      tenant.locale === 'ru' || tenant.locale === 'uk' ? tenant.locale : 'en');
  }
  async save(tenantId: string, input: CompanyOnboardingSettings, actor: HierarchyActor): Promise<CompanyOnboardingSettings> {
    const settings = CompanyOnboardingSettingsSchema.parse(input);
    return this.db.client.transaction(async (tx) => {
      await assertHierarchyActorAuthorized(tx, tenantId, actor);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update').limit(1);
      if (!tenant) throw new Error('company_not_found');
      await tx.update(tenants).set({ timezone: settings.timezone, locale: settings.defaultLanguage,
        proactiveMessagingPolicy: { ...tenant.proactiveMessagingPolicy as Record<string, unknown>, onboarding: settings },
        updatedAt: new Date() }).where(eq(tenants.id, tenantId));
      await tx.insert(auditLogs).values({ tenantId, actorType: actor.type, actorId: actorId(actor),
        action: 'company.onboarding_settings.updated', resourceType: 'tenant', resourceId: tenantId,
        metadata: { timezone: settings.timezone, defaultLanguage: settings.defaultLanguage, workingDays: settings.workingDays,
          workdayStart: settings.workdayStart, workdayEnd: settings.workdayEnd } });
      return settings;
    });
  }
}
