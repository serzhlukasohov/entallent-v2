import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_SERVICE_AUTH_POLICY,
  InternalServiceAuthGuard,
  RequireInternalServiceAuth,
} from './internal-auth.guard';

describe('RequireInternalServiceAuth', () => {
  it('stores read or command policy metadata on handlers', () => {
    class TestController {
      @RequireInternalServiceAuth({ permission: 'read' })
      read() {
        return null;
      }
    }

    const metadata = Reflect.getMetadata(INTERNAL_SERVICE_AUTH_POLICY, TestController.prototype.read);

    expect(metadata).toEqual({ permission: 'read' });
  });
});

describe('InternalServiceAuthGuard', () => {
  it('allows authorized requests, records audit, and attaches internal service claims to the request', async () => {
    const claims = { tenantId: 't-1', workspaceId: 'w-1', serviceIdentity: 'agent-service' };
    const auth = {
      authorize: vi.fn(() => ({ decision: 'authorized', claims })),
    };
    const reflector = {
      get: vi.fn(() => ({ permission: 'read' })),
    };
    const auditLog = { append: vi.fn(async () => undefined) };
    const request = makeRequest();
    const guard = new InternalServiceAuthGuard(auth as never, reflector as never, auditLog as never);

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(request.internalServiceAuth).toEqual(claims);
    expect(auth.authorize).toHaveBeenCalledWith({
      authorization: 'Bearer token',
      endpoint: '/internal/maf/context/read',
      requiredPermission: 'read',
    });
    expect(auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't-1',
        actorId: 'agent-service',
        action: 'internal_tool_call.authorized',
        resourceId: '/internal/maf/context/read',
      }),
    );
  });

  it('rejects unauthenticated requests after recording claim-less audit', async () => {
    const auth = {
      authorize: vi.fn(() => ({ decision: 'rejected', reason: 'missing_authorization' })),
    };
    const reflector = {
      get: vi.fn(() => ({ permission: 'read' })),
    };
    const auditLog = { append: vi.fn(async () => undefined) };
    const guard = new InternalServiceAuthGuard(auth as never, reflector as never, auditLog as never);

    await expect(guard.canActivate(makeContext(makeRequest()))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-4000-8000-000000000000',
        actorId: 'unknown',
        action: 'internal_tool_call.rejected',
        reason: 'missing_authorization',
        resourceId: '/internal/maf/context/read',
      }),
    );
  });

  it('rejects forbidden scoped requests after recording audit', async () => {
    const auth = {
      authorize: vi.fn(() => ({ decision: 'rejected', reason: 'endpoint_not_allowed' })),
    };
    const reflector = {
      get: vi.fn(() => ({ permission: 'read' })),
    };
    const auditLog = { append: vi.fn(async () => undefined) };
    const guard = new InternalServiceAuthGuard(auth as never, reflector as never, auditLog as never);

    await expect(guard.canActivate(makeContext(makeRequest()))).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'internal_tool_call.rejected',
        reason: 'endpoint_not_allowed',
        resourceId: '/internal/maf/context/read',
      }),
    );
  });
});

function makeRequest() {
  return {
    headers: { authorization: 'Bearer token' },
    url: '/internal/maf/context/read?limit=20',
  } as { headers: Record<string, string>; url: string; internalServiceAuth?: unknown };
}

function makeContext(request: ReturnType<typeof makeRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => () => null,
  } as unknown as ExecutionContext;
}
