import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { encryptField, decryptField } from '@entalent/crypto-utils';
import { orgCompanyAdminSessions, orgOidcLoginAttempts } from '@entalent/database';
import { CompanyAdminSessionService } from './company-admin-session.service';

const mocks = vi.hoisted(() => ({
  discover: vi.fn(), exchange: vi.fn(),
}));
vi.mock('./oidc-verifier', () => ({ discoverCorporateOidc: mocks.discover }));
vi.mock('./oidc-flow', async (importOriginal) => ({
  ...await importOriginal<typeof import('./oidc-flow')>(),
  exchangeCorporateAuthorizationCode: mocks.exchange,
}));

const KEY = 'ab'.repeat(32);
const TENANT = '00000000-0000-4000-8000-000000000001';
const PERSON = '00000000-0000-4000-8000-000000000002';
const BINDING = 'b'.repeat(64);
const discovery = {
  issuer: 'https://id.example.test/tenant',
  jwks_uri: 'https://id.example.test/tenant/keys',
  authorization_endpoint: 'https://id.example.test/tenant/authorize',
  token_endpoint: 'https://id.example.test/tenant/token',
};

function setup() {
  const stored = new Map<unknown, Record<string, unknown>[]>();
  const provider = {
    issuerUrl: discovery.issuer,
    clientId: 'client-1',
    encryptedClientSecret: encryptField('client-secret', KEY),
    redirectUri: 'https://app.example.test/api/v1/company-auth/callback',
  };
  const select = vi.fn().mockImplementation(() => ({
    from: (table: unknown) => ({
      innerJoin: () => ({ where: () => ({ limit: async () => [provider] }) }),
      where: () => ({ limit: async () => stored.get(table) ?? [] }),
    }),
  }));
  const insert = vi.fn().mockImplementation((table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      stored.set(table, [...(stored.get(table) ?? []), row]);
    },
  }));
  const deletion = vi.fn().mockImplementation(() => ({
    where: () => ({ returning: async () => stored.get(orgOidcLoginAttempts)?.splice(0, 1) ?? [] }),
  }));
  const update = vi.fn().mockReturnValue({ set: () => ({ where: async () => undefined }) });
  const identity = {
    resolveIdToken: vi.fn().mockResolvedValue({ tenantId: TENANT, personId: PERSON,
      bindingFingerprint: BINDING }),
    assertActiveBoundPerson: vi.fn().mockResolvedValue({ tenantId: TENANT, personId: PERSON }),
  };
  const service = new CompanyAdminSessionService(
    { client: { select, insert, delete: deletion, update } } as never,
    { get: () => KEY } as never,
    identity as never,
  );
  mocks.discover.mockResolvedValue(discovery);
  mocks.exchange.mockResolvedValue('signed-id-token');
  return { service, stored, identity, provider, deletion, update };
}

describe('CompanyAdminSessionService', () => {
  it('stores only a digest of browser state and encrypted protocol secrets', async () => {
    const { service, stored } = setup();
    const { authorizationUrl, state } = await service.start(TENANT);
    const attempt = stored.get(orgOidcLoginAttempts)?.[0];
    expect(attempt?.stateHash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(attempt?.stateHash).not.toBe(state);
    expect(decryptField(attempt?.encryptedNonce as string, KEY)).toBe(
      new URL(authorizationUrl).searchParams.get('nonce'),
    );
    expect(decryptField(attempt?.encryptedCodeVerifier as string, KEY)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects callback state that does not match the browser before consuming the attempt', async () => {
    const { service, deletion } = setup();
    const { state } = await service.start(TENANT);
    await expect(service.complete('code', state, 'other-state')).rejects.toThrow('access denied');
    expect(deletion).not.toHaveBeenCalled();
  });

  it('consumes one attempt and issues a hashed, revocable session with an active-binding check', async () => {
    const { service, stored, identity, update } = setup();
    const { state } = await service.start(TENANT);
    const { token, expiresAt } = await service.complete('auth-code', state, state);
    expect(mocks.exchange).toHaveBeenCalledWith(expect.objectContaining({
      code: 'auth-code', clientSecret: 'client-secret',
    }));
    expect(identity.resolveIdToken).toHaveBeenCalledWith(TENANT, 'signed-id-token', expect.any(String));
    const row = stored.get(orgCompanyAdminSessions)?.[0];
    expect(row?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.expiresAt).toEqual(expiresAt);
    expect(row?.bindingFingerprint).toBe(BINDING);
    await expect(service.complete('auth-code', state, state)).rejects.toThrow('access denied');

    const session = await service.resolve(token);
    expect(session).toMatchObject({ tenantId: TENANT, personId: PERSON });
    expect(identity.assertActiveBoundPerson).toHaveBeenCalledWith(TENANT, PERSON, BINDING);
    expect(service.verifyCsrf(token, session.csrfToken)).toBe(true);
    expect(service.verifyCsrf(token, 'wrong')).toBe(false);
    await service.revoke(token);
    expect(update).toHaveBeenCalledOnce();
  });
});
