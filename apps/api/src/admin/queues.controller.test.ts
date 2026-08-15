import { describe, expect, it, vi } from 'vitest';
import { QueuesController } from './queues.controller';

describe('QueuesController retry', () => {
  it('uses the Redis DB from REDIS_URL for admin queue inspection', async () => {
    const controller = new QueuesController({
      get: vi.fn(() => 'redis://:pass@localhost:6380/15'),
    } as never);

    controller.onModuleInit();
    const [firstQueue] = (controller as unknown as { queues: Array<{ opts: { connection: { db?: number } } }> }).queues;

    expect(firstQueue?.opts.connection.db).toBe(15);
    await controller.onModuleDestroy();
  });

  it('rejects an invalid Redis DB in REDIS_URL', () => {
    const controller = new QueuesController({
      get: vi.fn(() => 'redis://localhost:6380/-1'),
    } as never);

    expect(() => controller.onModuleInit()).toThrow('invalid_redis_database');
  });

  it('lists queue counts and failed jobs for admin console inspection', async () => {
    const controller = makeController([
      queue('conversation', {
        counts: { waiting: 1, failed: 1 },
        failed: [failedJob({ id: 'job-1', failedReason: 'MAF runtime unavailable' })],
      }),
      queue('profile-hydration', {
        counts: { waiting: 0, failed: 0 },
        failed: [],
      }),
    ]);

    await expect(controller.getStats()).resolves.toMatchObject({
      queues: [
        { name: 'conversation', counts: { waiting: 1, failed: 1 } },
        { name: 'profile-hydration', counts: { waiting: 0, failed: 0 } },
      ],
    });
    await expect(controller.getDeadLetterJobs()).resolves.toEqual({
      jobs: [
        {
          id: 'job-1',
          queue: 'conversation',
          name: 'process-message',
          failedReason: 'MAF runtime unavailable',
          attemptsMade: 3,
          data: { traceId: 'trace-1', runtimeMode: 'maf_primary' },
          timestamp: 1786492800000,
          finishedOn: 1786492801000,
        },
      ],
    });
  });

  it('does not retry when a job id exists in multiple queues', async () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    const controller = makeController([
      queue('conversation', { retry: retryA }),
      queue('profile-hydration', { retry: retryB }),
    ]);

    await expect(controller.retryJob('42')).resolves.toEqual({
      retried: false,
      reason: 'Job id is ambiguous across queues; retry by queue name',
      matches: ['conversation', 'profile-hydration'],
    });

    expect(retryA).not.toHaveBeenCalled();
    expect(retryB).not.toHaveBeenCalled();
  });

  it('retries a job from the named queue only', async () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    const controller = makeController([
      queue('conversation', { retry: retryA }),
      queue('profile-hydration', { retry: retryB }),
    ]);

    await expect(controller.retryJobInQueue('profile-hydration', '42')).resolves.toEqual({
      retried: true,
      queue: 'profile-hydration',
    });

    expect(retryA).not.toHaveBeenCalled();
    expect(retryB).toHaveBeenCalledOnce();
  });
});

function makeController(queues: unknown[]): QueuesController {
  const controller = new QueuesController({ get: vi.fn() } as never);
  (controller as unknown as { queues: unknown[] }).queues = queues;
  return controller;
}

function queue(name: string, job: unknown) {
  return {
    name,
    getJob: vi.fn(async () => ('retry' in Object(job) ? job : null)),
    getJobCounts: vi.fn(async () => Object(job).counts ?? {}),
    getFailed: vi.fn(async () => Object(job).failed ?? []),
  };
}

function failedJob(overrides: { id: string; failedReason: string }) {
  return {
    id: overrides.id,
    name: 'process-message',
    failedReason: overrides.failedReason,
    attemptsMade: 3,
    data: { traceId: 'trace-1', runtimeMode: 'maf_primary' },
    timestamp: 1786492800000,
    finishedOn: 1786492801000,
  };
}
