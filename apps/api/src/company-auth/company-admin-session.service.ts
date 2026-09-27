import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import { decryptField, encryptField } from '@entalent/crypto-utils';
import { orgCompanyAdminSessions, orgOidcLoginAttempts, orgOidcProviders, tenants } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { CompanyAdminIdentityService, type CompanyAdminIdentity } from './company-admin-identity.service';
import { buildCorporateAuthorizationUrl, createOidcLoginAttempt, exchangeCorporateAuthorizationCode } from './oidc-flow';
import { discoverCorporateOidc } from './oidc-verifier';

const SESSION_LIFETIME_MS = 8 * 60 * 60_000;

export interface CompanyAdminSession extends Pick<CompanyAdminIdentity, 'tenantId' | 'personId'> {
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class CompanyAdminSessionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
    private readonly identity: CompanyAdminIdentityService,
  ) {}

  async start(tenantId: string): Promise<{ authorizationUrl: string; state: string }> {
    const provider = await this.activeProvider(tenantId);
    const discovery = await discoverCorporateOidc(provider.issuerUrl);
    const attempt = createOidcLoginAttempt(tenantId);
    const key = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    await this.db.client.insert(orgOidcLoginAttempts).values({
      stateHash: digest(attempt.state), tenantId,
      encryptedNonce: encryptField(attempt.nonce, key),
      encryptedCodeVerifier: encryptField(attempt.codeVerifier, key),
      expiresAt: new Date(attempt.expiresAt),
    });
    return {
      authorizationUrl: buildCorporateAuthorizationUrl(
        discovery, provider.clientId, provider.redirectUri, attempt,
      ),
      state: attempt.state,
    };
  }

  async complete(code: string, state: string, browserState: string): Promise<{ token: string; expiresAt: Date }> {
    if (!isSessionToken(state) || !secureEqual(state, browserState)) throw denied();
    const [attempt] = await this.db.client.delete(orgOidcLoginAttempts)
      .where(and(eq(orgOidcLoginAttempts.stateHash, digest(state)),
        gt(orgOidcLoginAttempts.expiresAt, new Date())))
      .returning();
    if (!attempt) throw denied();

    const provider = await this.activeProvider(attempt.tenantId);
    const key = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const idToken = await exchangeCorporateAuthorizationCode({
      discovery: await discoverCorporateOidc(provider.issuerUrl),
      code, codeVerifier: decryptField(attempt.encryptedCodeVerifier, key),
      clientId: provider.clientId,
      clientSecret: decryptField(provider.encryptedClientSecret, key),
      redirectUri: provider.redirectUri,
    });
    const identity = await this.identity.resolveIdToken(
      attempt.tenantId, idToken, decryptField(attempt.encryptedNonce, key),
    );
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.db.client.insert(orgCompanyAdminSessions).values({
      tokenHash: digest(token), tenantId: identity.tenantId,
      personId: identity.personId, bindingFingerprint: identity.bindingFingerprint, expiresAt,
    });
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<CompanyAdminSession> {
    if (!isSessionToken(token)) throw denied();
    const [session] = await this.db.client.select().from(orgCompanyAdminSessions)
      .where(and(eq(orgCompanyAdminSessions.tokenHash, digest(token)),
        gt(orgCompanyAdminSessions.expiresAt, new Date()),
        isNull(orgCompanyAdminSessions.revokedAt))).limit(1);
    if (!session?.bindingFingerprint) throw denied();
    await this.identity.assertActiveBoundPerson(session.tenantId, session.personId, session.bindingFingerprint);
    return {
      tenantId: session.tenantId, personId: session.personId,
      csrfToken: this.csrfToken(token), expiresAt: session.expiresAt,
    };
  }

  async revoke(token: string): Promise<void> {
    if (!isSessionToken(token)) return;
    await this.db.client.update(orgCompanyAdminSessions).set({ revokedAt: new Date() })
      .where(eq(orgCompanyAdminSessions.tokenHash, digest(token)));
  }

  verifyCsrf(token: string, provided: string | undefined): boolean {
    return Boolean(provided && secureEqual(this.csrfToken(token), provided));
  }

  private csrfToken(token: string): string {
    const key = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    return createHmac('sha256', Buffer.from(key, 'hex')).update(`company-admin-csrf:${token}`).digest('base64url');
  }

  private async activeProvider(tenantId: string) {
    const [provider] = await this.db.client.select({
      issuerUrl: orgOidcProviders.issuerUrl,
      clientId: orgOidcProviders.clientId,
      encryptedClientSecret: orgOidcProviders.encryptedClientSecret,
      redirectUri: orgOidcProviders.redirectUri,
    }).from(orgOidcProviders)
      .innerJoin(tenants, eq(tenants.id, orgOidcProviders.tenantId))
      .where(and(eq(orgOidcProviders.tenantId, tenantId),
        eq(orgOidcProviders.status, 'active'), eq(tenants.status, 'active'))).limit(1);
    if (!provider) throw denied();
    return provider;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isSessionToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function denied(): UnauthorizedException {
  return new UnauthorizedException('Company Admin access denied');
}
