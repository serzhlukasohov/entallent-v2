import { describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { discoverCorporateOidc, verifyCorporateIdToken } from './oidc-verifier';

const ISSUER = 'https://id.example.test/tenant/v2.0';
const CLIENT = 'company-admin-client';

async function fixture(overrides: { nonce?: string; issuer?: string; audience?: string } = {}) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  const token = await new SignJWT({ nonce: overrides.nonce ?? 'nonce-123', email: 'admin@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? CLIENT)
    .setSubject('stable-subject-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const fetchImpl = vi.fn().mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      return { ok: true, json: async () => ({
        issuer: ISSUER, jwks_uri: `${ISSUER}/keys`,
        authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`,
      }) };
    }
    if (url.pathname.endsWith('/keys')) {
      return { ok: true, json: async () => ({ keys: [{ ...publicJwk, kid: 'key-1', alg: 'RS256' }] }) };
    }
    throw new Error('unexpected URL');
  }) as unknown as typeof fetch;
  return { token, fetchImpl };
}

describe('verifyCorporateIdToken', () => {
  it('rejects a provider advertising token authentication without client_secret_basic', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      issuer: ISSUER, jwks_uri: `${ISSUER}/keys`,
      authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`,
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
    }) }) as unknown as typeof fetch;
    await expect(discoverCorporateOidc(ISSUER, fetchImpl))
      .rejects.toThrow('OIDC provider must support client_secret_basic');
  });

  it('accepts a signed token with exact issuer, audience and nonce', async () => {
    const { token, fetchImpl } = await fixture();
    await expect(verifyCorporateIdToken({
      issuerUrl: ISSUER, clientId: CLIENT, idToken: token, nonce: 'nonce-123', fetchImpl,
    })).resolves.toEqual({
      issuerUrl: ISSUER, subject: 'stable-subject-1', email: 'admin@example.com',
    });
  });

  it('rejects a token for another client or browser login', async () => {
    const { token, fetchImpl } = await fixture();
    await expect(verifyCorporateIdToken({
      issuerUrl: ISSUER, clientId: 'other-client', idToken: token, nonce: 'nonce-123', fetchImpl,
    })).rejects.toThrow();
    await expect(verifyCorporateIdToken({
      issuerUrl: ISSUER, clientId: CLIENT, idToken: token, nonce: 'other-nonce', fetchImpl,
    })).rejects.toThrow('OIDC nonce mismatch');
  });

  it('rejects issuer substitution before trusting the signing keys', async () => {
    const { token, fetchImpl } = await fixture({ issuer: 'https://other.example.test' });
    await expect(verifyCorporateIdToken({
      issuerUrl: ISSUER, clientId: CLIENT, idToken: token, nonce: 'nonce-123', fetchImpl,
    })).rejects.toThrow();
  });
});
