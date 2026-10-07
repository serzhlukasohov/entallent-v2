import { describe, expect, it, vi } from 'vitest';
import { handleSlackInteraction, type SlackInteractionEvent } from './slack-interaction';

function event(overrides: Partial<SlackInteractionEvent['payload']> = {}): SlackInteractionEvent {
  return {
    type: 'interaction',
    payload: {
      externalWorkspaceId: 'T1', externalUserId: 'U1', externalChannelId: 'D1',
      messageTs: '100.1', actionId: 'onboarding:start', value: 'start', actionTs: '200.5',
      ...overrides,
    },
  };
}

function deps(over: Record<string, unknown> = {}) {
  const jobs = new Map<string, unknown>();
  const queue = { add: vi.fn(async (_n: string, data: unknown, opts: { jobId: string }) => { jobs.set(opts.jobId, data); }) };
  return {
    jobs, queue,
    d: {
      findWorkspaceIdentity: vi.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
      findLinkedPersonId: vi.fn(async ({ externalUserId }: { externalUserId: string }) => (externalUserId === 'U1' ? 'person-1' : null)),
      findOnboardingIntroTarget: vi.fn().mockResolvedValue({ introChannelId: 'D1', introActionsMessageTs: '100.1' }),
      queue,
      debug: vi.fn(),
      ...over,
    },
  };
}

describe('handleSlackInteraction', () => {
  it('enqueues an onboarding action job for the current intro buttons', async () => {
    const { d, queue } = deps();
    await expect(handleSlackInteraction(event(), d as never)).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith('action', {
      tenantId: 'tenant-1', personId: 'person-1', action: 'start',
      actionTs: '200.5', messageTs: '100.1', channelId: 'D1',
    }, { jobId: 'onb-act:U1:200.5' });
  });

  it('drops a click on a message that is not the current intro buttons', async () => {
    const { d, queue } = deps();
    await expect(handleSlackInteraction(event({ messageTs: '999.9' }), d as never)).resolves.toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('drops a click in a different channel than the recorded intro channel', async () => {
    const { d, queue } = deps();
    await handleSlackInteraction(event({ externalChannelId: 'D2' }), d as never);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('drops a Slack user who is not a linked person', async () => {
    const { d, queue } = deps();
    await handleSlackInteraction(event({ externalUserId: 'U2' }), d as never);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('drops when the person has no onboarding state or no recorded buttons', async () => {
    const a = deps({ findOnboardingIntroTarget: vi.fn().mockResolvedValue(null) });
    await handleSlackInteraction(event(), a.d as never);
    const b = deps({ findOnboardingIntroTarget: vi.fn().mockResolvedValue({ introChannelId: null, introActionsMessageTs: null }) });
    await handleSlackInteraction(event(), b.d as never);
    expect(a.queue.add).not.toHaveBeenCalled();
    expect(b.queue.add).not.toHaveBeenCalled();
  });

  it('drops unknown workspaces, non-DM channels and unparseable action ids', async () => {
    const unknown = deps({ findWorkspaceIdentity: vi.fn().mockResolvedValue(null) });
    await handleSlackInteraction(event(), unknown.d as never);
    const { d, queue } = deps();
    await handleSlackInteraction(event({ externalChannelId: 'C1' }), d as never);
    await handleSlackInteraction(event({ actionId: 'onboarding:bogus' }), d as never);
    await handleSlackInteraction(event({ actionId: 'other:start' }), d as never);
    expect(unknown.queue.add).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('gives the same action_ts twice one identical jobId so only one job exists', async () => {
    const { d, queue, jobs } = deps();
    await handleSlackInteraction(event(), d as never);
    await handleSlackInteraction(event(), d as never);
    const ids = queue.add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
    expect(ids).toEqual(['onb-act:U1:200.5', 'onb-act:U1:200.5']);
    expect(jobs.size).toBe(1);
  });
});
