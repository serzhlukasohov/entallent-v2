import { createHash } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { orgOidcProviders, orgOidcSubjects, orgPersonCapabilities, people, tenants, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { verifyCorporateIdToken } from './oidc-verifier';

export interface CompanyAdminIdentity {
  tenantId: string;
  personId: string;
  bindingFingerprint: string;
}

@Injectable()
export class CompanyAdminIdentityService {
  constructor(private readonly db: DatabaseService) {}

  async resolveIdToken(tenantId: string, idToken: string, nonce: string): Promise<CompanyAdminIdentity> {
    const [provider] = await this.db.client.select({
      issuerUrl: orgOidcProviders.issuerUrl,
      clientId: orgOidcProviders.clientId,
    }).from(orgOidcProviders).innerJoin(tenants, eq(tenants.id, orgOidcProviders.tenantId))
      .where(and(eq(orgOidcProviders.tenantId, tenantId), eq(orgOidcProviders.status, 'active'),
        eq(tenants.status, 'active'))).limit(1);
    if (!provider) throw new UnauthorizedException('Company Admin access denied');

    let subject: string;
    try {
      const verified = await verifyCorporateIdToken({
        issuerUrl: provider.issuerUrl, clientId: provider.clientId, idToken, nonce,
      });
      subject = verified.subject;
    } catch {
      throw new UnauthorizedException('Company Admin access denied');
    }

    const [actor] = await this.db.client.select({ personId: people.id })
      .from(orgOidcSubjects)
      .innerJoin(people, and(eq(people.id, orgOidcSubjects.personId),
        eq(people.tenantId, orgOidcSubjects.tenantId)))
      .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .innerJoin(orgPersonCapabilities, and(eq(orgPersonCapabilities.personId, people.id),
        eq(orgPersonCapabilities.tenantId, people.tenantId)))
      .where(and(
        eq(orgOidcSubjects.tenantId, tenantId),
        eq(orgOidcSubjects.issuerUrl, provider.issuerUrl),
        eq(orgOidcSubjects.subject, subject),
        permittedLifecycle(),
        isNull(users.deletedAt),
        eq(orgPersonCapabilities.capability, 'company_admin'),
        eq(orgPersonCapabilities.lifecycleStatus, 'active'),
      )).limit(1);
    if (!actor) throw new UnauthorizedException('Company Admin access denied');

    await this.db.client.update(orgOidcSubjects).set({ lastLoginAt: new Date() })
      .where(and(eq(orgOidcSubjects.tenantId, tenantId),
        eq(orgOidcSubjects.issuerUrl, provider.issuerUrl), eq(orgOidcSubjects.subject, subject),
        eq(orgOidcSubjects.personId, actor.personId)));
    return { tenantId, personId: actor.personId,
      bindingFingerprint: fingerprint(provider.issuerUrl, subject) };
  }

  async assertActiveBoundPerson(tenantId: string, personId: string,
    bindingFingerprint: string): Promise<Pick<CompanyAdminIdentity, 'tenantId' | 'personId'>> {
    const [actor] = await this.db.client.select({
      personId: people.id, issuerUrl: orgOidcSubjects.issuerUrl, subject: orgOidcSubjects.subject,
    })
      .from(people)
      .innerJoin(tenants, eq(tenants.id, people.tenantId))
      .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .innerJoin(orgPersonCapabilities, and(eq(orgPersonCapabilities.personId, people.id),
        eq(orgPersonCapabilities.tenantId, people.tenantId)))
      .innerJoin(orgOidcSubjects, and(eq(orgOidcSubjects.personId, people.id),
        eq(orgOidcSubjects.tenantId, people.tenantId)))
      .innerJoin(orgOidcProviders, and(eq(orgOidcProviders.tenantId, people.tenantId),
        eq(orgOidcProviders.issuerUrl, orgOidcSubjects.issuerUrl)))
      .where(and(eq(people.tenantId, tenantId), eq(people.id, personId),
        eq(tenants.status, 'active'), permittedLifecycle(), isNull(users.deletedAt),
        eq(orgPersonCapabilities.capability, 'company_admin'),
        eq(orgPersonCapabilities.lifecycleStatus, 'active'),
        eq(orgOidcProviders.status, 'active'))).limit(1);
    if (!actor || fingerprint(actor.issuerUrl, actor.subject) !== bindingFingerprint) {
      throw new UnauthorizedException('Company Admin access denied');
    }
    return { tenantId, personId: actor.personId };
  }
}

function fingerprint(issuerUrl: string, subject: string): string {
  return createHash('sha256').update(JSON.stringify([issuerUrl, subject])).digest('hex');
}

function permittedLifecycle() {
  return or(
    and(eq(people.lifecycleStatus, 'active'), eq(users.status, 'active')),
    and(eq(people.lifecycleStatus, 'draft'), eq(users.status, 'inactive')),
  );
}
