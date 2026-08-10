import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppendAuditLogParams } from '@entalent/application';

export type InternalServicePermission = 'read' | 'command';
export type InternalServiceAuthDecision = 'authorized' | 'rejected';
export type InternalServiceAuthRejectionReason =
  | 'missing_secret'
  | 'weak_secret'
  | 'missing_authorization'
  | 'malformed_token'
  | 'invalid_signature'
  | 'invalid_claims'
  | 'expired'
  | 'issued_in_future'
  | 'permission_denied'
  | 'endpoint_not_allowed';

export interface InternalServiceClaims {
  serviceIdentity: string;
  tenantId: string;
  workspaceId: string;
  permissions: InternalServicePermission[];
  endpointAllowlist: string[];
  iat: number;
  exp: number;
  traceId?: string;
}

export interface InternalServiceAuthRuntimeConfig {
  secret?: string;
  now?: () => Date;
}

export interface InternalServiceAuthRequest {
  authorization?: string | string[];
  endpoint: string;
  requiredPermission: InternalServicePermission;
}

export type InternalServiceAuthResult =
  | {
      decision: 'authorized';
      claims: InternalServiceClaims;
    }
  | {
      decision: 'rejected';
      reason: InternalServiceAuthRejectionReason;
      claims?: InternalServiceClaims;
    };

export interface BuildInternalServiceAuditLogInput {
  decision: InternalServiceAuthDecision;
  reason?: InternalServiceAuthRejectionReason;
  claims?: InternalServiceClaims;
  endpoint: string;
  requiredPermission: InternalServicePermission;
  traceId?: string;
  rawBody?: unknown;
}

const TOKEN_VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const MAX_CLOCK_SKEW_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UNKNOWN_TENANT_ID = '00000000-0000-4000-8000-000000000000';
const UNKNOWN_SCOPE = 'unknown';

export class InternalServiceAuthService {
  constructor(private readonly config: InternalServiceAuthRuntimeConfig) {}

  authorize(request: InternalServiceAuthRequest): InternalServiceAuthResult {
    const secret = normalizeSecret(this.config.secret);
    if (!secret) {
      return { decision: 'rejected', reason: 'missing_secret' };
    }
    if (secret.length < MIN_SECRET_LENGTH) {
      return { decision: 'rejected', reason: 'weak_secret' };
    }

    if (Array.isArray(request.authorization)) {
      return { decision: 'rejected', reason: 'malformed_token' };
    }

    const authorization = request.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      return { decision: 'rejected', reason: 'missing_authorization' };
    }

    const token = authorization.slice('Bearer '.length).trim();
    const parsed = verifyInternalServiceCredential(token, secret);
    if (!parsed.ok) {
      return { decision: 'rejected', reason: parsed.reason };
    }

    const claims = parsed.claims;
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (claims.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
      return { decision: 'rejected', reason: 'issued_in_future', claims };
    }
    if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
      return { decision: 'rejected', reason: 'invalid_claims', claims };
    }
    if (claims.exp <= nowSeconds) {
      return { decision: 'rejected', reason: 'expired', claims };
    }

    if (!claims.permissions.includes(request.requiredPermission)) {
      return { decision: 'rejected', reason: 'permission_denied', claims };
    }

    if (!claims.endpointAllowlist.includes(request.endpoint)) {
      return { decision: 'rejected', reason: 'endpoint_not_allowed', claims };
    }

    return { decision: 'authorized', claims };
  }

  private now(): Date {
    return this.config.now?.() ?? new Date();
  }
}

export function createInternalServiceCredential(claims: InternalServiceClaims, secret: string): string {
  const normalizedSecret = normalizeSecret(secret);
  if (!normalizedSecret || normalizedSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('Internal service auth secret must be at least 32 non-whitespace characters');
  }
  const encodedClaims = base64urlEncode(Buffer.from(JSON.stringify(claims), 'utf-8'));
  const signedPart = `${TOKEN_VERSION}.${encodedClaims}`;
  const signature = sign(signedPart, normalizedSecret);
  return `${signedPart}.${signature}`;
}

export function buildInternalServiceAuditLog(input: BuildInternalServiceAuditLogInput): AppendAuditLogParams {
  return {
    tenantId: input.claims?.tenantId ?? UNKNOWN_TENANT_ID,
    actorType: 'system',
    actorId: input.claims?.serviceIdentity ?? UNKNOWN_SCOPE,
    action: `internal_tool_call.${input.decision}`,
    resourceType: 'internal_endpoint',
    resourceId: input.endpoint,
    reason: input.reason,
    metadata: {
      serviceIdentity: input.claims?.serviceIdentity ?? UNKNOWN_SCOPE,
      workspaceId: input.claims?.workspaceId ?? UNKNOWN_SCOPE,
      endpoint: input.endpoint,
      permission: input.requiredPermission,
      decision: input.decision,
      traceId: sanitizeTraceId(input.traceId ?? input.claims?.traceId),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    traceId: sanitizeTraceId(input.traceId ?? input.claims?.traceId),
  };
}

function verifyInternalServiceCredential(
  token: string,
  secret: string,
):
  | { ok: true; claims: InternalServiceClaims }
  | { ok: false; reason: InternalServiceAuthRejectionReason } {
  const [version, encodedClaims, signature, extra] = token.split('.');
  if (version !== TOKEN_VERSION || !encodedClaims || !signature || extra !== undefined) {
    return { ok: false, reason: 'malformed_token' };
  }

  const signedPart = `${version}.${encodedClaims}`;
  if (!signaturesMatch(signature, sign(signedPart, secret))) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecode(encodedClaims).toString('utf-8'));
  } catch {
    return { ok: false, reason: 'malformed_token' };
  }

  if (!isInternalServiceClaims(parsed)) {
    return { ok: false, reason: 'invalid_claims' };
  }

  return { ok: true, claims: parsed };
}

function isInternalServiceClaims(value: unknown): value is InternalServiceClaims {
  if (!isRecord(value)) return false;
  const iat = value.iat;
  const exp = value.exp;

  return (
    typeof value.serviceIdentity === 'string' &&
    value.serviceIdentity.trim().length > 0 &&
    typeof value.tenantId === 'string' &&
    UUID_PATTERN.test(value.tenantId) &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.trim().length > 0 &&
    Array.isArray(value.permissions) &&
    value.permissions.length > 0 &&
    value.permissions.every(isInternalServicePermission) &&
    Array.isArray(value.endpointAllowlist) &&
    value.endpointAllowlist.length > 0 &&
    value.endpointAllowlist.every((endpoint) => typeof endpoint === 'string' && endpoint.startsWith('/')) &&
    Number.isInteger(iat) &&
    Number.isInteger(exp) &&
    typeof iat === 'number' &&
    typeof exp === 'number' &&
    exp > iat &&
    (value.traceId === undefined || (typeof value.traceId === 'string' && TRACE_ID_PATTERN.test(value.traceId)))
  );
}

function isInternalServicePermission(value: unknown): value is InternalServicePermission {
  return value === 'read' || value === 'command';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sign(value: string, secret: string): string {
  return base64urlEncode(createHmac('sha256', secret).update(value).digest());
}

function normalizeSecret(secret: string | undefined): string | undefined {
  const normalized = secret?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function sanitizeTraceId(traceId: string | undefined): string | undefined {
  return traceId && TRACE_ID_PATTERN.test(traceId) ? traceId : undefined;
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

function base64urlEncode(value: Buffer): string {
  return value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64urlDecode(value: string): Buffer {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}
