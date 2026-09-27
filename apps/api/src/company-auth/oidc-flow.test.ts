import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCorporateAuthorizationUrl,
  createOidcLoginAttempt,
  exchangeCorporateAuthorizationCode,
} from './oidc-flow';
import type { CorporateOidcDiscovery } from './oidc-verifier';

const discovery: CorporateOidcDiscovery = {
  issuer: 'https://id.example.test/tenant',
  jwks_uri: 'https://id.example.test/tenant/keys',
  authorization_endpoint: 'https://id.example.test/tenant/authorize',
  token_endpoint: 'https://id.example.test/tenant/token',
};

describe('corporate OIDC authorization code flow', () => {
  it('creates a short-lived, distinct attempt and sends state, nonce and PKCE challenge', () => {
    const attempt = createOidcLoginAttempt('tenant-1', 1_000);
    const other = createOidcLoginAttempt('tenant-1', 1_000);
    expect(attempt.expiresAt).toBe(601_000);
    expect(attempt.state).not.toBe(other.state);
    expect(attempt.nonce).not.toBe(other.nonce);
    expect(attempt.codeVerifier).not.toBe(other.codeVerifier);

    const url = new URL(buildCorporateAuthorizationUrl(
      discovery, 'client-1', 'https://app.example.test/oidc/callback', attempt,
    ));
    expect(url.origin).toBe('https://id.example.test');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('state')).toBe(attempt.state);
    expect(url.searchParams.get('nonce')).toBe(attempt.nonce);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(attempt.codeVerifier).digest('base64url'),
    );
    expect(url.searchParams.has('code_verifier')).toBe(false);
  });

  it('exchanges the code with the original verifier and rejects a missing ID token', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: true, json: async () => ({ id_token: 'signed-id-token' }),
    }).mockResolvedValueOnce({
      ok: true, json: async () => ({ access_token: 'not-an-id-token' }),
    }) as unknown as typeof fetch;
    const input = {
      discovery, code: 'auth-code', codeVerifier: 'original-verifier',
      clientId: 'client-1', clientSecret: 'secret-1',
      redirectUri: 'https://app.example.test/oidc/callback', fetchImpl,
    };
    await expect(exchangeCorporateAuthorizationCode(input)).resolves.toBe('signed-id-token');
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(discovery.token_endpoint);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(new URLSearchParams(init.body as string).get('code_verifier')).toBe('original-verifier');
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`,
    });
    await expect(exchangeCorporateAuthorizationCode(input)).rejects.toThrow('OIDC ID token missing');
  });

  it('form-encodes client credentials before HTTP Basic authentication', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ id_token: 'signed-id-token' }),
    }) as unknown as typeof fetch;
    await exchangeCorporateAuthorizationCode({
      discovery, code: 'auth-code', codeVerifier: 'verifier',
      clientId: 'client:id', clientSecret: 'secret +/é',
      redirectUri: 'https://app.example.test/oidc/callback', fetchImpl,
    });
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('client%3Aid:secret+%2B%2F%C3%A9').toString('base64')}`,
    });
  });
});
