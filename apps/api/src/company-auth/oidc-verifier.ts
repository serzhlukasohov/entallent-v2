import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';

export interface VerifiedCorporateIdentity {
  issuerUrl: string;
  subject: string;
  email?: string;
}

export interface VerifyCorporateIdTokenInput {
  issuerUrl: string;
  clientId: string;
  idToken: string;
  nonce: string;
  fetchImpl?: typeof fetch;
}

export type CorporateOidcDiscovery = {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported?: string[];
};

export async function discoverCorporateOidc(issuer: string, fetchImpl: typeof fetch = fetch): Promise<CorporateOidcDiscovery> {
  const issuerUrl = parseHttpsUrl(issuer, 'issuer URL');
  const discoveryUrl = new URL(`${issuerUrl.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, issuerUrl);
  const discovery = await fetchJson<CorporateOidcDiscovery>(fetchImpl, discoveryUrl);
  if (discovery.issuer !== issuer) throw new Error('OIDC discovery issuer mismatch');
  for (const [label, value] of [
    ['JWKS URL', discovery.jwks_uri],
    ['authorization endpoint', discovery.authorization_endpoint],
    ['token endpoint', discovery.token_endpoint],
  ] as const) {
    if (typeof value !== 'string') throw new Error(`OIDC ${label} missing`);
    parseHttpsUrl(value, label);
  }
  const methods = discovery.token_endpoint_auth_methods_supported;
  if (methods !== undefined && (!Array.isArray(methods) || !methods.includes('client_secret_basic'))) {
    throw new Error('OIDC provider must support client_secret_basic');
  }
  return discovery;
}

export async function verifyCorporateIdToken(input: VerifyCorporateIdTokenInput): Promise<VerifiedCorporateIdentity> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const discovery = await discoverCorporateOidc(input.issuerUrl, fetchImpl);
  const jwksUrl = parseHttpsUrl(discovery.jwks_uri, 'JWKS URL');
  const jwks = await fetchJson<JSONWebKeySet>(fetchImpl, jwksUrl);
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error('OIDC JWKS is empty');

  const { payload } = await jwtVerify(input.idToken, createLocalJWKSet(jwks), {
    issuer: input.issuerUrl,
    audience: input.clientId,
    algorithms: ['RS256', 'PS256', 'ES256', 'ES384'],
  });
  if (typeof payload.nonce !== 'string' || payload.nonce !== input.nonce) {
    throw new Error('OIDC nonce mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('OIDC subject missing');

  return {
    issuerUrl: input.issuerUrl,
    subject: payload.sub,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
  };
}

function parseHttpsUrl(raw: string, label: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new Error(`OIDC ${label} must be an HTTPS URL without credentials or fragments`);
  }
  return url;
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: URL): Promise<T> {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`OIDC discovery request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
