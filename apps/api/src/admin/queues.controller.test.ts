import { describe, expect, it, vi } from 'vitest';
import { QueuesController } from './queues.controller';

describe('QueuesController retry', () => {
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
    getJob: vi.fn(async () => job),
  };
}
