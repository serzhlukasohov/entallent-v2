import { describe, expect, it, vi } from 'vitest';
import { UserProfileRepository } from './user-profile.repository';

function createDbMock() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const select = vi.fn();

  return {
    client: {
      update,
      select,
    },
    calls: {
      update,
      select,
      set,
      where,
    },
  };
}

function flattenSqlChunks(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const stringChunk = (value as { value?: unknown }).value;
  if (Array.isArray(stringChunk)) {
    return stringChunk.map((chunk) => (typeof chunk === 'string' ? chunk : flattenSqlChunks(chunk))).join('');
  }

  const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';

  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      if (Array.isArray(chunk)) return chunk.join('');
      return flattenSqlChunks(chunk);
    })
    .join('');
}

describe('UserProfileRepository', () => {
  it('records profile hydration outcomes with a single atomic metadata update', async () => {
    const db = createDbMock();
    const repository = new UserProfileRepository(db as never);

    await repository.recordProfileHydrationOutcome(
      'user-1',
      'tenant-1',
      'slack',
      {
        status: 'failed',
        error: 'Slack timeout\nBearer secret-token',
        occurredAt: new Date('2026-08-12T16:10:00.000Z'),
      },
      { externalWorkspaceId: 'workspace-1' },
    );

    expect(db.calls.select).not.toHaveBeenCalled();
    expect(db.calls.update).toHaveBeenCalledTimes(1);
    expect(db.calls.set).toHaveBeenCalledTimes(1);

    const setCalls = db.calls.set.mock.calls as unknown as [[unknown]];
    const payload = setCalls[0][0] as {
      profileMetadata?: unknown;
      updatedAt?: unknown;
    };
    const metadataSql = flattenSqlChunks(payload.profileMetadata);

    expect(payload.updatedAt).toBeInstanceOf(Date);
    expect(metadataSql).toContain('jsonb_set');
    expect(metadataSql).toContain('CASE WHEN');
    expect(metadataSql).toContain("~ '^[0-9]+$'");
    expect(metadataSql).toContain("->'profileHydration'->>'attemptCount'");
    expect(metadataSql).toContain('+ 1');
    expect(metadataSql).toContain('jsonb_strip_nulls');
    expect(metadataSql).not.toContain('secret-token');
  });
});
