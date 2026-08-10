import { describe, expect, it } from 'vitest';
import {
  buildInternalServiceAuditLog,
  createInternalServiceCredential,
  InternalServiceAuthService,
  type InternalServiceClaims,
} from './internal-auth.service';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';
const now = new Date('2026-08-06T12:00:00.000Z');
const tenantId = '00000000-0000-4000-8000-000000000000';

const baseClaims: InternalServiceClaims = {
  serviceIdentity: 'agent-service',
  tenantId,
  workspaceId: 'T01234567',
  permissions: ['read'],
  endpointAllowlist: ['/internal/maf/context/read'],
  iat: Math.floor(now.getTime() / 1000),
  exp: Math.floor(now.getTime() / 1000) + 300,
  traceId: 'trace-story-4-3',
};

describe('InternalServiceAuthService', () => {
  it('authorizes a valid scoped read credential', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(baseClaims, secret);

    const decision = auth.authorize({
      authorization: `Bearer ${token}`,
      endpoint: '/internal/maf/context/read',
      requiredPermission: 'read',
    });

    expect(decision.decision).toBe('authorized');
    if (decision.decision === 'authorized') {
      expect(decision.claims.tenantId).toBe(tenantId);
      expect(decision.claims.workspaceId).toBe('T01234567');
      expect(decision.claims.serviceIdentity).toBe('agent-service');
    }
  });

  it('authorizes a credential emitted by the Python helper format', () => {
    const auth = makeAuth();
    const pythonToken = [
      'v1',
      'eyJzZXJ2aWNlSWRlbnRpdHkiOiJhZ2VudC1zZXJ2aWNlIiwidGVuYW50SWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAiLCJ3b3Jrc3BhY2VJZCI6IlQwMTIzNDU2NyIsInBlcm1pc3Npb25zIjpbInJlYWQiXSwiZW5kcG9pbnRBbGxvd2xpc3QiOlsiL2ludGVybmFsL21hZi9jb250ZXh0L3JlYWQiXSwiaWF0IjoxNzg2MDE3NjAwLCJleHAiOjE3ODYwMTc5MDAsInRyYWNlSWQiOiJ0cmFjZS1zdG9yeS00LTMifQ',
      'UhGFgPdjVFNLAMEMp_iJoP5WuH3zsiyIo9AvXiW3rOE',
    ].join('.');

    const decision = auth.authorize({
      authorization: `Bearer ${pythonToken}`,
      endpoint: '/internal/maf/context/read',
      requiredPermission: 'read',
    });

    expect(decision).toMatchObject({
      decision: 'authorized',
      claims: {
        tenantId,
        workspaceId: 'T01234567',
        serviceIdentity: 'agent-service',
      },
    });
  });

  it('rejects credentials signed with the wrong secret', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(baseClaims, 'abcdef0123456789abcdef0123456789abcdef0123456789');

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'invalid_signature' });
  });

  it('rejects expired credentials', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(
      {
        ...baseClaims,
        iat: Math.floor(now.getTime() / 1000) - 301,
        exp: Math.floor(now.getTime() / 1000) - 1,
      },
      secret,
    );

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'expired' });
  });

  it('rejects credentials issued too far in the future', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(
      {
        ...baseClaims,
        iat: Math.floor(now.getTime() / 1000) + 61,
        exp: Math.floor(now.getTime() / 1000) + 300,
      },
      secret,
    );

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'issued_in_future' });
  });

  it('rejects malformed credentials', () => {
    const auth = makeAuth();

    expect(
      auth.authorize({
        authorization: 'Bearer not-a-service-token',
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'malformed_token' });
  });

  it('rejects credentials without the required permission', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(
      {
        ...baseClaims,
        endpointAllowlist: ['/internal/maf/context/write'],
      },
      secret,
    );

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/write',
        requiredPermission: 'command',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'permission_denied' });
  });

  it('rejects credentials with excessive lifetime', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(
      {
        ...baseClaims,
        exp: Math.floor(now.getTime() / 1000) + 301,
      },
      secret,
    );

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'invalid_claims' });
  });

  it('rejects endpoints outside the credential allowlist', () => {
    const auth = makeAuth();
    const token = createInternalServiceCredential(baseClaims, secret);

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/other',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'endpoint_not_allowed' });
  });

  it('fails closed when no internal service secret is configured', () => {
    const auth = new InternalServiceAuthService({ secret: undefined, now: () => now });
    const token = createInternalServiceCredential(baseClaims, secret);

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'missing_secret' });
  });

  it('fails closed when the configured secret is too short', () => {
    const auth = new InternalServiceAuthService({ secret: 'too-short', now: () => now });
    const token = createInternalServiceCredential(baseClaims, secret);

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'weak_secret' });
  });

  it('fails closed when the configured secret is only whitespace', () => {
    const auth = new InternalServiceAuthService({ secret: ' '.repeat(32), now: () => now });
    const token = createInternalServiceCredential(baseClaims, secret);

    expect(
      auth.authorize({
        authorization: `Bearer ${token}`,
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'missing_secret' });
  });

  it('rejects duplicate authorization headers', () => {
    const auth = makeAuth();

    expect(
      auth.authorize({
        authorization: ['Bearer token-a', 'Bearer token-b'],
        endpoint: '/internal/maf/context/read',
        requiredPermission: 'read',
      }),
    ).toMatchObject({ decision: 'rejected', reason: 'malformed_token' });
  });

  it('rejects invalid scoped claim shapes', () => {
    const auth = makeAuth();
    const invalidClaims = [
      { ...baseClaims, tenantId: 'not-a-uuid' },
      { ...baseClaims, workspaceId: '' },
      { ...baseClaims, permissions: [] },
      { ...baseClaims, endpointAllowlist: ['relative/path'] },
      { ...baseClaims, traceId: 'private employee message with spaces' },
    ];

    for (const claims of invalidClaims) {
      const token = createInternalServiceCredential(claims as InternalServiceClaims, secret);

      expect(
        auth.authorize({
          authorization: `Bearer ${token}`,
          endpoint: '/internal/maf/context/read',
          requiredPermission: 'read',
        }),
      ).toMatchObject({ decision: 'rejected', reason: 'invalid_claims' });
    }
  });
});

describe('buildInternalServiceAuditLog', () => {
  it('records scoped auth decisions without raw request text or bearer token material', () => {
    const audit = buildInternalServiceAuditLog({
      decision: 'rejected',
      reason: 'endpoint_not_allowed',
      claims: baseClaims,
      endpoint: '/internal/maf/context/other',
      requiredPermission: 'read',
      traceId: 'trace-story-4-3',
      rawBody: {
        message: 'private employee message',
        prompt: 'private prompt',
        authorization: 'Bearer secret-token',
      },
    });

    expect(audit).toEqual({
      tenantId,
      actorType: 'system',
      actorId: 'agent-service',
      action: 'internal_tool_call.rejected',
      resourceType: 'internal_endpoint',
      resourceId: '/internal/maf/context/other',
      reason: 'endpoint_not_allowed',
      metadata: {
        serviceIdentity: 'agent-service',
        workspaceId: 'T01234567',
        endpoint: '/internal/maf/context/other',
        permission: 'read',
        decision: 'rejected',
        traceId: 'trace-story-4-3',
        reason: 'endpoint_not_allowed',
      },
      traceId: 'trace-story-4-3',
    });
    expect(JSON.stringify(audit)).not.toContain('private employee message');
    expect(JSON.stringify(audit)).not.toContain('private prompt');
    expect(JSON.stringify(audit)).not.toContain('secret-token');
  });

  it('records claim-less rejections without raw request text or bearer token material', () => {
    const audit = buildInternalServiceAuditLog({
      decision: 'rejected',
      reason: 'missing_authorization',
      endpoint: '/internal/maf/context/read',
      requiredPermission: 'read',
      traceId: 'private employee message with spaces',
      rawBody: {
        text: 'private employee message',
        authorization: 'Bearer secret-token',
      },
    });

    expect(audit).toMatchObject({
      tenantId: '00000000-0000-4000-8000-000000000000',
      actorType: 'system',
      actorId: 'unknown',
      action: 'internal_tool_call.rejected',
      resourceType: 'internal_endpoint',
      resourceId: '/internal/maf/context/read',
      reason: 'missing_authorization',
      traceId: undefined,
      metadata: expect.objectContaining({
        serviceIdentity: 'unknown',
        workspaceId: 'unknown',
        decision: 'rejected',
        reason: 'missing_authorization',
      }),
    });
    expect(JSON.stringify(audit)).not.toContain('private employee message');
    expect(JSON.stringify(audit)).not.toContain('secret-token');
  });
});

function makeAuth(): InternalServiceAuthService {
  return new InternalServiceAuthService({ secret, now: () => now });
}
