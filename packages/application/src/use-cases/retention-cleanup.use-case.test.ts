import { describe, expect, it, vi } from 'vitest';
import { RetentionCleanupUseCase } from './retention-cleanup.use-case';
import type { RetentionCleanupRepositoryPort } from '../ports/retention.repository.port';

describe('RetentionCleanupUseCase', () => {
  it('applies tenant retention policy cutoffs through the repository boundary', async () => {
    const repo: RetentionCleanupRepositoryPort = {
      findRetentionTenants: vi.fn().mockResolvedValue([{
        tenantId: 'tenant-1',
        retentionPolicy: {
          messagesRetentionDays: 10,
          memoryRetentionDays: 20,
          riskSignalRetentionDays: 3,
          auditLogRetentionDays: 30,
        },
      }]),
      applyRetention: vi.fn().mockResolvedValue({
        messagesDeleted: 1,
        surveyEvidenceExpired: 2,
        memoryItemsExpired: 3,
        riskSignalsExpired: 4,
        temporaryGroupStatesExpired: 5,
        confirmedGroupStatesExpired: 6,
        withdrawnGroupStatesExpired: 7,
        auditLogsDeleted: 8,
        reportSnapshotsDeleted: 9,
      }),
    };
    const useCase = new RetentionCleanupUseCase(repo);

    await expect(useCase.execute({
      now: new Date('2026-10-31T00:00:00.000Z'),
    })).resolves.toEqual({
      tenantsProcessed: 1,
      messagesDeleted: 1,
      surveyEvidenceExpired: 2,
      memoryItemsExpired: 3,
      riskSignalsExpired: 4,
      temporaryGroupStatesExpired: 5,
      confirmedGroupStatesExpired: 6,
      withdrawnGroupStatesExpired: 7,
      auditLogsDeleted: 8,
      reportSnapshotsDeleted: 9,
    });

    expect(repo.applyRetention).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      now: new Date('2026-10-31T00:00:00.000Z'),
      messagesCutoff: new Date('2026-10-21T00:00:00.000Z'),
      memoryCutoff: new Date('2026-10-11T00:00:00.000Z'),
      riskSignalCutoff: new Date('2026-10-28T00:00:00.000Z'),
      auditLogCutoff: new Date('2026-10-01T00:00:00.000Z'),
    });
  });
});
