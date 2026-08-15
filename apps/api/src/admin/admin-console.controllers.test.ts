import { describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAGS } from '@entalent/application';
import { AuditLogsController } from './audit-logs.controller';
import { FeatureFlagsController } from './feature-flags.controller';
import { LlmRunsController } from './llm-runs.controller';
import { UserDebugController } from './user-debug.controller';

const TENANT_ID = '7d1e0163-6d53-4713-bd24-254690cc5090';
const USER_ID = '9d1e0163-6d53-4713-bd24-254690cc5090';

describe('admin console MAF-primary regression', () => {
  it('lists known MAF runtime feature flags with configured flags', async () => {
    const controller = new FeatureFlagsController({
      client: {
        select: vi.fn(() => queryOrderBy([
          { key: FEATURE_FLAGS.MAF_RUNTIME_PRIMARY, tenantId: TENANT_ID, enabled: true },
        ])),
      },
    } as never);

    await expect(controller.list(TENANT_ID)).resolves.toEqual({
      flags: [{ key: FEATURE_FLAGS.MAF_RUNTIME_PRIMARY, tenantId: TENANT_ID, enabled: true }],
      knownKeys: expect.arrayContaining([
        FEATURE_FLAGS.MAF_RUNTIME_DISABLED,
        FEATURE_FLAGS.MAF_RUNTIME_SHADOW,
        FEATURE_FLAGS.MAF_RUNTIME_CANARY,
        FEATURE_FLAGS.MAF_RUNTIME_PRIMARY,
        FEATURE_FLAGS.MAF_RUNTIME_USER_DENYLIST,
      ]),
    });
  });

  it('lists audit logs and totals for MAF runtime operations', async () => {
    const controller = new AuditLogsController({
      client: {
        select: vi.fn()
          .mockReturnValueOnce(queryOrderLimitOffset([
            {
              id: 'audit-1',
              tenantId: TENANT_ID,
              action: 'runtime.maf_primary_attempted',
              resourceType: 'runtime_attempt',
            },
          ]))
          .mockReturnValueOnce(queryWhere([{ total: 1 }])),
      },
    } as never);

    await expect(
      controller.list(TENANT_ID, undefined, 'runtime.maf_primary_attempted'),
    ).resolves.toEqual({
      logs: [
        {
          id: 'audit-1',
          tenantId: TENANT_ID,
          action: 'runtime.maf_primary_attempted',
          resourceType: 'runtime_attempt',
        },
      ],
      total: 1,
    });
  });

  it('lists LLM/runtime runs and totals for admin inspection', async () => {
    const controller = new LlmRunsController({
      client: {
        select: vi.fn()
          .mockReturnValueOnce(queryOrderLimit([
            {
              id: 'run-1',
              tenantId: TENANT_ID,
              taskType: 'maf_primary_runtime',
              status: 'success',
            },
          ]))
          .mockReturnValueOnce(queryWhere([{ total: 1 }])),
      },
    } as never);

    await expect(controller.list(TENANT_ID, 'maf_primary_runtime')).resolves.toEqual({
      runs: [
        {
          id: 'run-1',
          tenantId: TENANT_ID,
          taskType: 'maf_primary_runtime',
          status: 'success',
        },
      ],
      total: 1,
    });
  });

  it('audits user debug access and returns previews without private risk reasoning', async () => {
    const auditLog = { append: vi.fn() };
    const longText = 'x'.repeat(130);
    const controller = new UserDebugController(
      {
        client: {
          select: vi.fn()
            .mockReturnValueOnce(queryLimit([
              {
                id: USER_ID,
                preferredName: 'Alex',
                status: 'active',
                timezone: 'Europe/Warsaw',
                proactiveMessagingEnabled: true,
                onboardingStatus: 'complete',
                consentState: 'granted',
                createdAt: new Date('2026-08-15T09:00:00.000Z'),
              },
            ]))
            .mockReturnValueOnce(queryOrderLimit([
              {
                id: 'message-1',
                direction: 'inbound',
                messageType: 'text',
                occurredAt: new Date('2026-08-15T09:00:00.000Z'),
                textPreview: longText,
              },
            ]))
            .mockReturnValueOnce(queryOrderLimit([]))
            .mockReturnValueOnce(queryWhere([]))
            .mockReturnValueOnce(queryOrderLimit([]))
            .mockReturnValueOnce(queryOrder([
              {
                id: 'risk-1',
                type: 'burnout',
                severity: 'high',
                status: 'active',
                detectedAt: new Date('2026-08-15T09:00:00.000Z'),
                resolvedAt: null,
                expiresAt: null,
                reasoning: 'private MAF risk reasoning',
                evidenceSummary: 'private MAF risk evidence',
              },
            ]))
            .mockReturnValueOnce(queryJoinOrder([])),
        },
      } as never,
      auditLog as never,
    );

    const response = await controller.getDebugView(USER_ID, TENANT_ID);

    expect(auditLog.append).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      action: 'admin.user_debug_viewed',
      resourceType: 'user',
      resourceId: USER_ID,
    }));
    const preview = (response['recentMessages'] as Array<{ textPreview: string }>)[0]!.textPreview;
    expect(preview).toHaveLength(121);
    expect(preview.startsWith('x'.repeat(120))).toBe(true);
    expect(JSON.stringify(response)).not.toContain(longText);
    expect(JSON.stringify(response)).not.toContain('private MAF risk reasoning');
    expect(JSON.stringify(response)).not.toContain('private MAF risk evidence');
  });
});

function queryOrderBy(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })) })) };
}

function queryWhere(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(async () => rows) })) };
}

function queryLimit(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => rows) })) })) };
}

function queryOrder(rows: unknown[]) {
  return { from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })) })) };
}

function queryOrderLimit(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })) })),
    })),
  };
}

function queryOrderLimitOffset(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ offset: vi.fn(async () => rows) })) })),
      })),
    })),
  };
}

function queryJoinOrder(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn(async () => rows) })) })),
      })),
    })),
  };
}
