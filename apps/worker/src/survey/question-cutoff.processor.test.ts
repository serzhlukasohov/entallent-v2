import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCutoffProcessor } from './question-cutoff.processor';

afterEach(() => vi.useRealTimers());

describe('QuestionCutoffProcessor', () => {
  const admissionRepo = {
    findUndispatchedTimelyQuestionReplies: vi.fn().mockResolvedValue([]),
    findQueuedTimelyQuestionRepliesWithoutReceipt: vi.fn().mockResolvedValue([]),
    markQuestionReplyAdmissionQueued: vi.fn(),
  };
  const conversationQueue = { add: vi.fn() };
  it('registers one repeatable lifecycle scan and runs cutoff before model-backed recovery', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ tenantsProcessed: 2, expiredQuestionCount: 3, overdueReplyCount: 0 });
    const recover = vi.fn().mockResolvedValue({ usersScanned: 1, finalizedQuestionCount: 2, failedUserCount: 0 });
    const processor = new QuestionCutoffProcessor({ execute } as never, { execute: recover } as never,
      { add } as never, admissionRepo as never, conversationQueue as never);
    await processor.onModuleInit();
    expect(add).toHaveBeenCalledWith('cutoff', {}, {
      repeat: { every: 300_000 }, jobId: 'v2-question-cutoff-recurring', removeOnComplete: true,
    });

    const now = new Date('2026-09-29T01:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await processor.process({ name: 'cutoff' } as never);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(recover.mock.invocationCallOrder[0]!);
    expect(execute).toHaveBeenCalledWith(now);
  });

  it('uses a safe failure reason for cutoff processing errors', async () => {
    const processor = new QuestionCutoffProcessor({ execute: vi.fn().mockRejectedValue(new Error('private SQL detail')) } as never,
      { execute: vi.fn().mockResolvedValue({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never, admissionRepo as never, conversationQueue as never);
    await expect(processor.process({ name: 'cutoff' } as never))
      .rejects.toThrow('v2_question_cutoff_failed');
  });

  it('runs cutoff after a private recovery failure and persists only a safe failure reason', async () => {
    const execute = vi.fn().mockResolvedValue({ tenantsProcessed: 1, expiredQuestionCount: 1, overdueReplyCount: 0 });
    const processor = new QuestionCutoffProcessor({ execute } as never,
      { execute: vi.fn().mockRejectedValue(new Error('private confirmed meaning')) } as never,
      {} as never, admissionRepo as never, conversationQueue as never);
    await expect(processor.process({ name: 'cutoff' } as never))
      .rejects.toThrow('v2_question_recovery_failed');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('warns with an aggregate count when timely replies remain unprocessed after grace', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const processor = new QuestionCutoffProcessor({ execute: async () => ({
        tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 2,
      }) } as never, { execute: async () => ({
        usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0,
      }) } as never, {} as never, admissionRepo as never, conversationQueue as never);
      await processor.process({ name: 'cutoff' } as never);
      expect(warn).toHaveBeenCalledWith(
        'Question cutoff deferred: overdue_reply_count=2 reason=conversation_processing_pending',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('replays an undispatched timely reply before cutoff using only persisted identifiers', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const mark = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 });
    const reply = {
      messageId: 'message-1', tenantId: 'tenant-1', userId: 'user-1',
      conversationId: 'conversation-1', externalWorkspaceId: 'T1', externalConversationId: 'D1',
      eventId: 'event-1', requestId: 'request-1', traceId: 'trace-1',
    };
    const processor = new QuestionCutoffProcessor({ execute } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [reply],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [],
        markQuestionReplyAdmissionQueued: mark } as never,
      { add } as never);

    await processor.process({ name: 'cutoff' } as never);

    expect(add).toHaveBeenCalledWith('process', { ...reply, rapidMessageCoalescing: true },
      { jobId: 'conversation-message-1' });
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(mark.mock.invocationCallOrder[0]!);
    expect(mark.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder[0]!);
    expect(mark).toHaveBeenCalledWith('message-1', 'tenant-1');
  });

  it('keeps admission pending and returns a safe failure when replay enqueue fails', async () => {
    const mark = vi.fn();
    const execute = vi.fn().mockResolvedValue({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 });
    const processor = new QuestionCutoffProcessor({ execute } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [{ messageId: 'message-1', tenantId: 'tenant-1' }],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [],
        markQuestionReplyAdmissionQueued: mark } as never,
      { add: vi.fn().mockRejectedValue(new Error('private queue failure')) } as never);

    await expect(processor.process({ name: 'cutoff' } as never))
      .rejects.toThrow('v2_question_reply_dispatch_failed');
    expect(mark).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
  });

  it('retries only the receipt for a completed scoped conversation job', async () => {
    const reply = { messageId: 'message-1', tenantId: 'tenant-1',
      userId: 'user-1', conversationId: 'conversation-1' };
    const add = vi.fn().mockResolvedValue(undefined);
    const getJob = vi.fn().mockResolvedValue({
      name: 'process', data: reply, getState: vi.fn().mockResolvedValue('completed'),
    });
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [reply] } as never,
      { add, getJob } as never,
    );

    await processor.process({ name: 'cutoff' } as never);

    expect(getJob).toHaveBeenCalledWith('conversation-message-1');
    expect(add).toHaveBeenCalledWith('receipt-retry', reply,
      expect.objectContaining({ jobId: 'receipt-message-1' }));
  });

  it('does not replay a failed or missing conversation job with unknown side effects', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const reply = { messageId: 'message-1', tenantId: 'tenant-1',
        userId: 'user-1', conversationId: 'conversation-1' };
      const add = vi.fn();
      const getJob = vi.fn()
        .mockResolvedValueOnce({ name: 'process', data: reply, getState: async () => 'failed' })
        .mockResolvedValueOnce(null);
      const processor = new QuestionCutoffProcessor(
        { execute: async () => ({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 }) } as never,
        { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
        {} as never,
        { findUndispatchedTimelyQuestionReplies: async () => [],
          findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [reply] } as never,
        { add, getJob } as never,
      );

      await processor.process({ name: 'cutoff' } as never);
      await processor.process({ name: 'cutoff' } as never);

      expect(add).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'Question cutoff requires manual conversation reconciliation: count=1',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('requeues an unsent committed turn and its missing message job from durable identities', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T01:00:00.000Z'));
    const reply = { messageId: 'message-1', tenantId: 'tenant-1',
      userId: 'user-1', conversationId: 'conversation-1' };
    const admission = { ...reply, externalWorkspaceId: 'T1', externalConversationId: 'D1',
      eventId: 'event-1', requestId: 'request-1', traceId: 'trace-1' };
    const send = { intentId: 'intent-1', inboundMessageId: reply.messageId,
      outboundMessageId: 'outbound-1', tenantId: reply.tenantId,
      userId: reply.userId, conversationId: reply.conversationId,
      channelType: 'slack', externalWorkspaceId: 'T1', externalConversationId: 'D1' };
    const conversationAdd = vi.fn().mockResolvedValue(undefined);
    const messageAdd = vi.fn().mockResolvedValue(undefined);
    const markCommittedDispatchQueued = vi.fn().mockResolvedValue(undefined);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [reply] } as never,
      { add: conversationAdd, getJob: async () => null } as never,
      { findRecoverableMessageSends: async () => [send],
        isUserRuntimeEligible: async () => true, markCommittedDispatchQueued,
        countUnresolvedMessageSends: async () => 0,
        findCommittedAdmissionForRecovery: async () => admission } as never,
      { add: messageAdd } as never,
    );

    await processor.process({ name: 'cutoff' } as never);

    expect(messageAdd).toHaveBeenCalledWith('send', {
      messageId: 'outbound-1', tenantId: 'tenant-1', conversationId: 'conversation-1',
      channelType: 'slack', externalWorkspaceId: 'T1', externalChannelId: 'D1',
    }, expect.objectContaining({ jobId: expect.stringMatching(/^message-send-recovery-outbound-1-/) }));
    expect(markCommittedDispatchQueued).toHaveBeenCalledWith({
      inboundMessageId: 'message-1', tenantId: 'tenant-1', userId: 'user-1',
      conversationId: 'conversation-1', kind: 'message_send',
    });
    expect(conversationAdd).toHaveBeenCalledWith('process', {
      ...admission, rapidMessageCoalescing: true,
    }, expect.objectContaining({ jobId: expect.stringMatching(/^conversation-recovery-message-1-/) }));
    expect(messageAdd.mock.invocationCallOrder[0])
      .toBeLessThan(markCommittedDispatchQueued.mock.invocationCallOrder[0]!);
  });

  it('continues recovery after one dispatch intent fails and reports a safe failure', async () => {
    const bad = { intentId: 'intent-1', inboundMessageId: 'inbound-1',
      outboundMessageId: 'outbound-1', tenantId: 'tenant-1', userId: 'user-1',
      conversationId: 'conversation-1', channelType: 'slack',
      externalWorkspaceId: 'T1', externalConversationId: 'D1' };
    const good = { ...bad, intentId: 'intent-2', inboundMessageId: 'inbound-2',
      outboundMessageId: 'outbound-2' };
    const send = vi.fn().mockImplementation(async (_name: string, payload: { messageId: string }) => {
      if (payload.messageId === bad.outboundMessageId) throw new Error('private queue detail');
    });
    const mark = vi.fn().mockResolvedValue(undefined);
    const hydrate = vi.fn().mockResolvedValue(undefined);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      { add: vi.fn() } as never,
      { findRecoverableMessageSends: async () => [bad, good],
        countUnresolvedMessageSends: async () => 0,
        findRecoverableProfileHydrations: async () => [{ intentId: 'profile-1',
          inboundMessageId: 'inbound-3', tenantId: 'tenant-1', userId: 'user-1',
          conversationId: 'conversation-1', channelType: 'slack',
          externalWorkspaceId: 'T1', traceId: 'trace-1' }],
        findCommittedAdmissionsWithUnqueuedDispatches: async () => [],
        isUserRuntimeEligible: async () => true, markCommittedDispatchQueued: mark } as never,
      { add: send } as never,
      { add: hydrate, getJob: async () => null } as never,
    );

    await expect(processor.process({ name: 'cutoff' } as never))
      .rejects.toThrow('v2_question_reply_dispatch_failed');
    expect(send).toHaveBeenCalledTimes(2);
    expect(mark).toHaveBeenCalledWith(expect.objectContaining({ inboundMessageId: good.inboundMessageId }));
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it('requeues a committed turn with an unqueued non-send intent outside a survey window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T01:00:00.000Z'));
    const admission = {
      messageId: 'message-1', tenantId: 'tenant-1', userId: 'user-1',
      conversationId: 'conversation-1', externalWorkspaceId: 'T1',
      externalConversationId: 'D1', eventId: 'event-1',
      requestId: 'request-1', traceId: 'trace-1',
    };
    const add = vi.fn().mockResolvedValue(undefined);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      { add } as never,
      { findCommittedAdmissionsWithUnqueuedDispatches: async () => [admission],
        findCommittedAdmissionForRecovery: async () => admission,
        isUserRuntimeEligible: async () => true } as never,
    );

    await processor.process({ name: 'cutoff' } as never);

    expect(add).toHaveBeenCalledWith('process', {
      ...admission, rapidMessageCoalescing: true,
    }, expect.objectContaining({ jobId: expect.stringMatching(/^conversation-recovery-message-1-/) }));
  });

  it('restores an aged profile job only when its original is no longer pending', async () => {
    const lost = {
      intentId: 'intent-1', inboundMessageId: 'message-1', tenantId: 'tenant-1',
      userId: 'user-1', conversationId: 'conversation-1', channelType: 'slack',
      externalWorkspaceId: 'T1', traceId: 'trace-1',
    };
    const running = { ...lost, intentId: 'intent-2', inboundMessageId: 'message-2' };
    const add = vi.fn().mockResolvedValue(undefined);
    const mark = vi.fn().mockResolvedValue(undefined);
    const getJob = vi.fn().mockImplementation(async (id: string) => id.endsWith('message-2')
      ? { getState: async () => 'active' } : null);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      { add: vi.fn() } as never,
      { findCommittedAdmissionsWithUnqueuedDispatches: async () => [],
        findRecoverableProfileHydrations: async () => [lost, running],
        isUserRuntimeEligible: async () => true, markCommittedDispatchQueued: mark } as never,
      undefined,
      { add, getJob } as never,
    );

    await processor.process({ name: 'cutoff' } as never);

    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('hydrate', {
      inboundMessageId: lost.inboundMessageId, tenantId: lost.tenantId,
      userId: lost.userId, channelType: lost.channelType,
      externalWorkspaceId: lost.externalWorkspaceId, traceId: lost.traceId,
    }, expect.objectContaining({
      jobId: 'profile-hydration-recovery-message-1', removeOnComplete: true,
    }));
    expect(mark).toHaveBeenCalledWith({
      inboundMessageId: lost.inboundMessageId, tenantId: lost.tenantId,
      userId: lost.userId, conversationId: lost.conversationId,
      kind: 'profile_hydration',
    });
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(mark.mock.invocationCallOrder[0]!);
  });

  it('requeues a lost style job but leaves an active original alone', async () => {
    const lost = {
      intentId: 'intent-1', inboundMessageId: 'message-1', tenantId: 'tenant-1',
      userId: 'user-1', conversationId: 'conversation-1', channelType: 'slack',
      externalWorkspaceId: 'T1', traceId: 'trace-1',
    };
    const active = { ...lost, intentId: 'intent-2', inboundMessageId: 'message-2' };
    const add = vi.fn().mockResolvedValue(undefined);
    const mark = vi.fn().mockResolvedValue(undefined);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      { add: vi.fn() } as never,
      { findCommittedAdmissionsWithUnqueuedDispatches: async () => [],
        findRecoverableStyleAnalyses: async () => [lost, active],
        isUserRuntimeEligible: async () => true, markCommittedDispatchQueued: mark } as never,
      undefined, undefined,
      { add, getJob: async (id: string) => id.endsWith('message-2')
        ? { getState: async () => 'active' } : null } as never,
    );
    await processor.process({ name: 'cutoff' } as never);
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('analyze', {
      inboundMessageId: lost.inboundMessageId, tenantId: lost.tenantId,
      userId: lost.userId, conversationId: lost.conversationId, traceId: lost.traceId,
    }, expect.objectContaining({ jobId: 'style-analysis-recovery-message-1' }));
    expect(mark).toHaveBeenCalledWith({
      inboundMessageId: lost.inboundMessageId, tenantId: lost.tenantId,
      userId: lost.userId, conversationId: lost.conversationId, kind: 'style_analysis',
    });
  });

  it('scans beyond a full batch of unrecoverable jobs to retry a later completed receipt', async () => {
    const failed = Array.from({ length: 100 }, (_, index) => ({
      messageId: `message-${String(index).padStart(3, '0')}`,
      tenantId: 'tenant-1', userId: 'user-1', conversationId: 'conversation-1',
    }));
    const completed = { messageId: 'message-100', tenantId: 'tenant-1',
      userId: 'user-1', conversationId: 'conversation-1' };
    const findQueued = vi.fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce([completed]);
    const getJob = vi.fn().mockImplementation(async (jobId: string) => jobId === 'conversation-message-100'
      ? { name: 'process', data: completed, getState: async () => 'completed' }
      : null);
    const add = vi.fn().mockResolvedValue(undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const processor = new QuestionCutoffProcessor(
        { execute: async () => ({ tenantsProcessed: 1, expiredQuestionCount: 0, overdueReplyCount: 1 }) } as never,
        { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
        {} as never,
        { findUndispatchedTimelyQuestionReplies: async () => [],
          findQueuedTimelyQuestionRepliesWithoutReceipt: findQueued } as never,
        { add, getJob } as never,
      );

      await processor.process({ name: 'cutoff' } as never);

      expect(findQueued).toHaveBeenNthCalledWith(1, expect.any(Date), undefined);
      expect(findQueued).toHaveBeenNthCalledWith(2, expect.any(Date), 'message-099');
      expect(add).toHaveBeenCalledOnce();
      expect(add).toHaveBeenCalledWith('receipt-retry', completed,
        expect.objectContaining({ jobId: 'receipt-message-100' }));
      expect(error).toHaveBeenCalledWith(
        'Question cutoff requires manual conversation reconciliation: count=100',
      );
    } finally {
      error.mockRestore();
    }
  });

  it('recovers a missing group-report job without duplicating a waiting original', async () => {
    const lost = { intentId: 'intent-1', sourceGroupStateId: 'state-1',
      reportingCohortId: 'cohort-1', tenantId: 'tenant-1', userId: 'user-1',
      teamId: 'team-1', questionGroup: 'growth' };
    const waiting = { ...lost, intentId: 'intent-2', sourceGroupStateId: 'state-2' };
    const add = vi.fn().mockResolvedValue(undefined);
    const processor = new QuestionCutoffProcessor(
      { execute: async () => ({ tenantsProcessed: 0, expiredQuestionCount: 0, overdueReplyCount: 0 }) } as never,
      { execute: async () => ({ usersScanned: 0, finalizedQuestionCount: 0, failedUserCount: 0 }) } as never,
      {} as never,
      { findUndispatchedTimelyQuestionReplies: async () => [],
        findQueuedTimelyQuestionRepliesWithoutReceipt: async () => [] } as never,
      { add: vi.fn() } as never,
      { findRecoverableGroupReports: async () => [lost, waiting],
        isUserRuntimeEligible: async () => true,
        findCommittedAdmissionsWithUnqueuedDispatches: async () => [] } as never,
      undefined, undefined, undefined, undefined, undefined, undefined,
      { add, getJob: async (id: string) => id === 'group-report-state-2'
        ? { getState: async () => 'waiting' } : null } as never,
    );
    await processor.process({ name: 'cutoff' } as never);
    expect(add).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith('report', {
      reportingCohortId: lost.reportingCohortId, tenantId: lost.tenantId,
      teamId: lost.teamId, questionGroup: lost.questionGroup,
      traceId: 'group-report-recovery-state-1', sourceGroupStateId: lost.sourceGroupStateId,
    }, expect.objectContaining({ jobId: 'group-report-state-1', removeOnComplete: true }));
  });
});
