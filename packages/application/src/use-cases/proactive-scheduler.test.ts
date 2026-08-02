import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveSchedulerUseCase } from './proactive-scheduler.use-case';
import type {
  ProactiveSchedulerRepositoryPort,
  CheckInEnqueuePort,
  CheckInCandidate,
} from '../ports/proactive-scheduler.repository.port';

function makeCandidate(overrides: Partial<CheckInCandidate> = {}): CheckInCandidate {
  return {
    userId: 'u-1',
    tenantId: 't-1',
    conversationId: 'c-1',
    channelType: 'dev',
    externalConversationId: 'ext-c-1',
    externalWorkspaceId: 'dev-workspace',
    timezone: 'UTC',
    quietHours: { enabled: false },
    preferredName: 'Alex',
    ...overrides,
  };
}

function makeRepo(candidates: CheckInCandidate[]): ProactiveSchedulerRepositoryPort {
  return {
    findCheckInCandidates: vi.fn().mockResolvedValue(candidates),
  };
}

function makeQueue(): CheckInEnqueuePort & { enqueueCheckIn: ReturnType<typeof vi.fn> } {
  return { enqueueCheckIn: vi.fn().mockResolvedValue(undefined) };
}

describe('ProactiveSchedulerUseCase', () => {
  it('enqueues a check-in for each eligible candidate', async () => {
    const repo = makeRepo([makeCandidate({ userId: 'u-1' }), makeCandidate({ userId: 'u-2' })]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue);

    const result = await useCase.scan();

    expect(queue.enqueueCheckIn).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ candidatesFound: 2, enqueued: 2, skippedQuietHours: 0 });
  });

  it('passes the correct payload shape to the queue', async () => {
    const repo = makeRepo([makeCandidate()]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue);

    await useCase.scan();

    expect(queue.enqueueCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c-1',
        userId: 'u-1',
        tenantId: 't-1',
        externalWorkspaceId: 'dev-workspace',
        externalConversationId: 'ext-c-1',
        traceId: expect.any(String),
      }),
    );
  });

  it('skips candidates currently in quiet hours', async () => {
    // Force "now" to 23:00 UTC so a 22–8 quiet window is active
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T23:00:00Z'));

    const repo = makeRepo([
      makeCandidate({ userId: 'quiet', timezone: 'UTC', quietHours: { enabled: true, startHour: 22, endHour: 8 } }),
      // 'awake' has an explicit quiet window (01–04) that does NOT include 23:00
      makeCandidate({ userId: 'awake', timezone: 'UTC', quietHours: { enabled: true, startHour: 1, endHour: 4 } }),
    ]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue);

    const result = await useCase.scan();

    expect(result.skippedQuietHours).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(queue.enqueueCheckIn).toHaveBeenCalledTimes(1);
    expect(queue.enqueueCheckIn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'awake' }));
  });

  it('forwards config thresholds and tenant filter to the repository', async () => {
    const repo = makeRepo([]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue, {
      minSilenceDays: 7,
      minCheckInGapDays: 10,
      batchLimit: 25,
    });

    await useCase.scan({ tenantId: 't-99' });

    expect(repo.findCheckInCandidates).toHaveBeenCalledWith({
      minSilenceDays: 7,
      minCheckInGapDays: 10,
      limit: 25,
      tenantId: 't-99',
    });
  });

  it('uses minCheckInGapDays=3 as the default', async () => {
    const repo = makeRepo([]);
    const queue = makeQueue();
    const useCase = new ProactiveSchedulerUseCase(repo, queue);

    await useCase.scan();

    expect(repo.findCheckInCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ minCheckInGapDays: 3 }),
    );
  });

  describe('quietHoursEnabled bypass', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // 03:00 UTC — inside the default 22–08 quiet window for a UTC user
      vi.setSystemTime(new Date('2026-08-02T03:00:00Z'));
    });

    it('enqueues a candidate who would otherwise be in quiet hours when quietHoursEnabled=false', async () => {
      const candidate = makeCandidate({
        userId: 'night-owl',
        timezone: 'UTC',
        quietHours: { enabled: true, startHour: 22, endHour: 8 },
      });
      const repo = makeRepo([candidate]);
      const queue = makeQueue();
      const useCase = new ProactiveSchedulerUseCase(repo, queue, { quietHoursEnabled: false });

      const result = await useCase.scan();

      expect(queue.enqueueCheckIn).toHaveBeenCalledTimes(1);
      expect(queue.enqueueCheckIn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'night-owl' }));
      expect(result).toMatchObject({ candidatesFound: 1, enqueued: 1, skippedQuietHours: 0 });
    });

    it('skips a UTC candidate at 03:00 when quietHoursEnabled=true (default window 22–08)', async () => {
      const candidate = makeCandidate({
        userId: 'sleeping',
        timezone: 'UTC',
        quietHours: { enabled: false }, // no custom window → DEFAULT_QUIET_HOURS (22–08) applies
      });
      const repo = makeRepo([candidate]);
      const queue = makeQueue();
      const useCase = new ProactiveSchedulerUseCase(repo, queue, { quietHoursEnabled: true });

      const result = await useCase.scan();

      expect(queue.enqueueCheckIn).not.toHaveBeenCalled();
      expect(result).toMatchObject({ candidatesFound: 1, enqueued: 0, skippedQuietHours: 1 });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
});
