import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_SERVICE_AUTH_POLICY,
  type InternalServiceAuthenticatedRequest,
} from '../internal-auth';
import { InternalMafContextController } from './internal-maf-context.controller';

const tenantId = '00000000-0000-4000-8000-000000000000';
const otherTenantId = '11111111-1111-4111-8111-111111111111';
const workspaceId = 'T01234567';
const userId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

describe('InternalMafContextController', () => {
  it('requires read-only internal service auth metadata', () => {
    const metadata = Reflect.getMetadata(
      INTERNAL_SERVICE_AUTH_POLICY,
      InternalMafContextController.prototype.readContext,
    );

    expect(metadata).toEqual({ permission: 'read' });
  });

  it('passes validated scoped context requests to the service', async () => {
    const service = { readContext: vi.fn(async () => ({ diagnostics: { traceId: 'trace-1' } })) };
    const controller = new InternalMafContextController(service as never);

    await expect(
      controller.readContext(makeRequest(), {
        tenantId,
        workspaceId,
        userId,
        conversationId,
        threadId: '1700000000.001',
        recentTurnLimit: 3,
      }),
    ).resolves.toEqual({ diagnostics: { traceId: 'trace-1' } });

    expect(service.readContext).toHaveBeenCalledWith({
      tenantId,
      workspaceId,
      userId,
      conversationId,
      threadId: '1700000000.001',
      recentTurnLimit: 3,
      memoryLimit: 10,
      goalLimit: 10,
      riskLimit: 10,
      traceId: 'trace-1',
    });
  });

  it('rejects invalid threadId values', async () => {
    const controller = new InternalMafContextController({ readContext: vi.fn() } as never);

    await expect(
      controller.readContext(makeRequest(), {
        tenantId,
        workspaceId,
        userId,
        conversationId,
        threadId: 'bad thread',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects tenant or workspace mismatches from the authenticated claims', async () => {
    const controller = new InternalMafContextController({ readContext: vi.fn() } as never);

    await expect(
      controller.readContext(makeRequest(), {
        tenantId: otherTenantId,
        workspaceId,
        userId,
        conversationId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.readContext(makeRequest(), {
        tenantId,
        workspaceId: 'T76543210',
        userId,
        conversationId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects malformed body fields and unsafe limits with safe validation errors', async () => {
    const controller = new InternalMafContextController({ readContext: vi.fn() } as never);

    await expect(controller.readContext(makeRequest(), null as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await expect(
      controller.readContext(makeRequest(), {
        tenantId,
        workspaceId,
        userId: 'not-a-uuid',
        conversationId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.readContext(makeRequest(), {
        tenantId,
        workspaceId,
        userId,
        conversationId,
        memoryLimit: 999,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function makeRequest(): InternalServiceAuthenticatedRequest {
  return {
    internalServiceAuth: {
      serviceIdentity: 'agent-service',
      tenantId,
      workspaceId,
      permissions: ['read'],
      endpointAllowlist: ['/internal/maf/context/read'],
      iat: 1786017600,
      exp: 1786017900,
      traceId: 'trace-1',
    },
  } as InternalServiceAuthenticatedRequest;
}
