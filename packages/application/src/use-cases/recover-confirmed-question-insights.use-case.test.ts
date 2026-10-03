import { describe, expect, it, vi } from 'vitest';
import { RecoverConfirmedQuestionInsightsUseCase } from './recover-confirmed-question-insights.use-case';

describe('RecoverConfirmedQuestionInsightsUseCase', () => {
  it('retries pending confirmations without another employee turn and isolates user failures', async () => {
    const users = [
      { tenantId: 'tenant-a', userId: 'person-a' },
      { tenantId: 'tenant-a', userId: 'person-b' },
    ];
    const executePending = vi.fn()
      .mockRejectedValueOnce(new Error('private scorer output'))
      .mockResolvedValueOnce(2);
    const recovery = new RecoverConfirmedQuestionInsightsUseCase(
      { listPendingConfirmedUsers: async () => users }, { executePending },
    );

    await expect(recovery.execute()).resolves.toEqual({
      usersScanned: 2, finalizedQuestionCount: 2, failedUserCount: 1,
    });
    expect(executePending.mock.calls).toEqual([[users[0]], [users[1]]]);
  });
});
