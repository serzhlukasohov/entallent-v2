import { createHash, randomBytes } from 'node:crypto';
import type { CorporateOidcDiscovery } from './oidc-verifier';

export interface OidcLoginAttempt {
  tenantId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  expiresAt: number;
}

export function createOidcLoginAttempt(tenantId: string, now = Date.now()): OidcLoginAttempt {
  return {
    tenantId,
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(32).toString('base64url'),
    expiresAt: now + 10 * 60_000,
  };
}

export function buildCorporateAuthorizationUrl(
  discovery: CorporateOidcDiscovery,
  clientId: string,
  redirectUri: string,
  attempt: OidcLoginAttempt,
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', attempt.state);
  url.searchParams.set('nonce', attempt.nonce);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', createHash('sha256').update(attempt.codeVerifier).digest('base64url'));
  return url.toString();
}

export async function exchangeCorporateAuthorizationCode(input: {
  discovery: CorporateOidcDiscovery;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const response = await (input.fetchImpl ?? fetch)(input.discovery.token_endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${formEncode(input.clientId)}:${formEncode(input.clientSecret)}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: input.code, code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`OIDC token exchange failed: ${response.status}`);
  const body = await response.json() as { id_token?: unknown };
  if (typeof body.id_token !== 'string' || !body.id_token) throw new Error('OIDC ID token missing');
  return body.id_token;
}

function formEncode(value: string): string {
  return new URLSearchParams([['value', value]]).toString().slice('value='.length);
}
