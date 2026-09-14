import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserResetService } from './user-reset.service';

const TENANT_ID = '7d1e0163-6d53-4713-bd24-254690cc5090';
const USER_ID = '9d1e0163-6d53-4713-bd24-254690cc5090';

const resultRow = {
  userFound: true,
  conversations: 1,
  messages: 2,
  memoryItems: 3,
  userGoals: 4,
  scheduledActions: 5,
  riskSignals: 6,
  surveyWindows: 7,
  surveyAssessments: 8,
  surveyEvidence: 9,
  surveyGroupStates: 10,
  pulseBacklog: 11,
  userStyleProfiles: 12,
  llmRuns: 13,
};

describe('UserResetService', () => {
  it('returns reset row counts without exposing the lookup flag', async () => {
    const execute = vi.fn().mockResolvedValue([resultRow]);
    const service = new UserResetService({ client: { execute } } as never);

    await expect(service.resetUser({ tenantId: TENANT_ID, userId: USER_ID })).resolves.toEqual({
      conversations: 1,
      messages: 2,
      memoryItems: 3,
      userGoals: 4,
      scheduledActions: 5,
      riskSignals: 6,
      surveyWindows: 7,
      surveyAssessments: 8,
      surveyEvidence: 9,
      surveyGroupStates: 10,
      pulseBacklog: 11,
      userStyleProfiles: 12,
      llmRuns: 13,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects resets outside the requested tenant', async () => {
    const execute = vi.fn().mockResolvedValue([{ ...resultRow, userFound: false }]);
    const service = new UserResetService({ client: { execute } } as never);

    await expect(service.resetUser({ tenantId: TENANT_ID, userId: USER_ID })).rejects.toThrow(
      NotFoundException,
    );
  });
});
