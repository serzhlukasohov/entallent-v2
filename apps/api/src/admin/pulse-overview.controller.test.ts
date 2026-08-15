import { describe, expect, it, vi } from 'vitest';
import { PulseOverviewController } from './pulse-overview.controller';

function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn(async () => rows),
  };
}

function fromOnlyQuery(rows: unknown[]) {
  return {
    from: vi.fn(async () => rows),
  };
}

describe('PulseOverviewController', () => {
  it('Manager Pulse dashboard maf_primary regression exposes MAF-created survey state without raw private fields', async () => {
    const db = {
      client: {
        select: vi.fn()
          .mockReturnValueOnce(query([
            { id: 'user-1', preferredName: null },
            { id: 'user-2', preferredName: 'No evidence yet' },
          ]))
          .mockReturnValueOnce(query([
            { userId: 'user-1', displayName: 'Alex' },
            { userId: 'user-2', displayName: 'Blake' },
          ]))
          .mockReturnValueOnce(query([
            {
              userId: 'user-1',
              questionId: 'question-1',
              stableKey: 'role_clarity',
              title: 'Role clarity',
              questionGroup: 'growth',
              assessmentStatus: 'scored',
              evidenceSummary: 'raw MAF evidence must not leak',
            },
          ]))
          .mockReturnValueOnce(query([
            {
              userId: 'user-1',
              questionGroup: 'growth',
              status: 'confirmed',
              employeeScore: '72.50',
              confirmedAt: new Date('2026-08-15T09:00:00.000Z'),
              aiSummary: 'private group summary must not leak',
            },
          ]))
          .mockReturnValueOnce(fromOnlyQuery([
            {
              id: 'question-1',
              stableKey: 'role_clarity',
              title: 'Role clarity',
              questionGroup: 'growth',
            },
          ]))
          .mockReturnValueOnce(query([
            {
              userId: 'user-2',
              surveyWindowId: 'window-1',
              surveyQuestionId: 'question-1',
              status: 'pending',
              position: 1,
              ignoreCount: 2,
              questionGroup: 'growth',
              stableKey: 'role_clarity',
            },
          ])),
      },
    };
    const config = { get: vi.fn(() => 'tenant-1') };
    const controller = new PulseOverviewController(db as never, config as never);

    const response = await controller.getOverview('tenant-1');

    expect(response.employees).toHaveLength(2);
    expect(response.employees[0]).toMatchObject({
      userId: 'user-1',
      displayName: 'Alex',
      groups: expect.arrayContaining([
        expect.objectContaining({
          questionGroup: 'growth',
          status: 'confirmed',
          employeeScore: 72.5,
          confirmedAt: '2026-08-15T09:00:00.000Z',
          questions: [
            {
              stableKey: 'role_clarity',
              title: 'Role clarity',
              assessmentStatus: 'scored',
            },
          ],
        }),
      ]),
    });
    expect(response.employees[1]).toMatchObject({
      userId: 'user-2',
      backlog: {
        doneCount: 0,
        pendingCount: 1,
        totalIgnoreCount: 2,
        nextQuestion: { stableKey: 'role_clarity', group: 'growth' },
      },
    });
    expect(JSON.stringify(response)).not.toContain('raw MAF evidence');
    expect(JSON.stringify(response)).not.toContain('private group summary');
  });
});
