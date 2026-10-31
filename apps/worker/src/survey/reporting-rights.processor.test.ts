import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { ReportingRightsProcessor } from './reporting-rights.processor';

const T = '00000000-0000-4000-8000-000000000001', A = '00000000-0000-4000-8000-0000000000c1', M = '00000000-0000-4000-8000-0000000000a1';
const send = { messageId: 'msg-1', tenantId: T, conversationId: 'c', channelType: 'slack', externalWorkspaceId: 'W', externalChannelId: 'D1' };
function build(result: unknown = { outcome: 'settled', status: 'applied', confirmationMessageId: 'msg-1' }) {
  const repository = {
    render: vi.fn().mockResolvedValue(send),
    messageSendJob: vi.fn().mockResolvedValue(send),
    findUnapplied: vi.fn().mockResolvedValue([{ tenantId: T, admissionId: A }]),
    findUnsentConfirmations: vi.fn().mockResolvedValue([{ tenantId: T, messageId: 'msg-2' }]),
  };
  const apply = { execute: vi.fn().mockResolvedValue(result) };
  const queue = { add: vi.fn() }, messageSend = { add: vi.fn() };
  const processor = new ReportingRightsProcessor(repository as never, apply as never, queue as never, messageSend as never);
  return { processor, repository, apply, queue, messageSend };
}

describe('RPT-09 ReportingRightsProcessor', () => {
  it('applies an admission and sends its confirmation through message-send', async () => {
    const t = build();
    await t.processor.process({ data: { kind: 'apply', tenantId: T, admissionId: A } } as Job);
    expect(t.apply.execute).toHaveBeenCalledWith({ kind: 'apply', tenantId: T, admissionId: A });
    expect(t.messageSend.add).toHaveBeenCalledWith('send', send, expect.objectContaining({ jobId: 'message-send-msg-1', removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } }));
  });

  it('sends the content-free not-applied notice for a failed settlement', async () => {
    const t = build({ outcome: 'settled', status: 'failed', confirmationMessageId: 'msg-1' });
    await t.processor.process({ data: { kind: 'apply', tenantId: T, admissionId: A } } as Job);
    expect(t.messageSend.add).toHaveBeenCalledWith('send', send, expect.objectContaining({ jobId: 'message-send-msg-1' }));
  });

  it('renders a menu step per click', async () => {
    const t = build();
    await t.processor.process({ data: { kind: 'render', tenantId: T, menuId: M, view: 'topics', page: 1, clickTs: '2.0' } } as Job);
    expect(t.repository.render).toHaveBeenCalledWith({ kind: 'render', tenantId: T, menuId: M, view: 'topics', page: 1, clickTs: '2.0' });
    expect(t.messageSend.add).toHaveBeenCalledWith('send', send, expect.objectContaining({ jobId: 'message-send-msg-1', removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } }));
  });

  it('rejects malformed jobs', async () => {
    await expect(build().processor.process({ data: { kind: 'apply', tenantId: 'x' } } as Job)).rejects.toThrow('reporting_rights_job_invalid');
  });

  it('sweep re-enqueues unapplied admissions and unsent confirmations under repair ids', async () => {
    const t = build();
    expect(await t.processor.process({ data: { kind: 'sweep' } } as Job)).toEqual({ admissions: 1, confirmations: 1 });
    expect(t.queue.add).toHaveBeenCalledWith('apply', { kind: 'apply', tenantId: T, admissionId: A }, expect.objectContaining({ jobId: expect.stringMatching(new RegExp(`^reporting-rights-apply-${A}-repair-\\d+$`)), removeOnFail: { count: 1000 } }));
    expect(t.messageSend.add).toHaveBeenCalledWith('send', send, expect.objectContaining({ jobId: expect.stringMatching(/^message-send-msg-2-repair-\d+$/) }));
  });

  it('registers one repeatable sweep', async () => {
    const t = build();
    await t.processor.onModuleInit();
    expect(t.queue.add).toHaveBeenCalledWith('sweep', { kind: 'sweep' }, expect.objectContaining({ jobId: 'reporting-rights-sweep', repeat: { every: 60_000 } }));
  });
});
