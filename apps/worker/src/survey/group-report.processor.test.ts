import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class {
    sendMessage = slack.sendMessage;
  },
}));

import { GroupReportProcessor } from './group-report.processor';

beforeEach(() => {
  slack.sendMessage.mockReset();
});

function createSnapshotRepo() {
  return {
    findLatestNonCancelledSnapshot: vi.fn(),
    createPendingSnapshot: vi.fn(),
    recordCancelledSnapshot: vi.fn(),
    markCancelled: vi.fn(),
    markDelivered: vi.fn(),
    markDeliveryUnknown: vi.fn(),
  };
}

function createTeamRepo(managerSlackUserId = 'manager-1') {
  return {
    findTeamById: vi.fn().mockResolvedValue({ managerSlackUserId }),
  };
}

describe('GroupReportProcessor', () => {
  it('passes the canonical cohort scope to the report use case', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: false,
        managerSlackUserId: null,
        message: '',
        teamScore: 0,
        confirmedCount: 4,
      }),
    };
    const workspaceRepo = { findFirstByTenant: vi.fn() };
    const snapshotRepo = createSnapshotRepo();
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(useCase.execute).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
    });
    expect(workspaceRepo.findFirstByTenant).not.toHaveBeenCalled();
    expect(snapshotRepo.createPendingSnapshot).not.toHaveBeenCalled();
  });

  it('passes final report jobs through to the report use case', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: false,
        managerSlackUserId: null,
        message: '',
        teamScore: 0,
        confirmedCount: 0,
      }),
    };
    const workspaceRepo = { findFirstByTenant: vi.fn() };
    const snapshotRepo = createSnapshotRepo();
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
      reportKind: 'final',
    } } as never);

    expect(useCase.execute).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      reportKind: 'final',
    });
  });

  it('fails closed before report generation when a legacy job has no tenant scope', async () => {
    const useCase = { execute: vi.fn() };
    const workspaceRepo = { findFirstByTenant: vi.fn() };
    const snapshotRepo = createSnapshotRepo();
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(useCase.execute).not.toHaveBeenCalled();
    expect(workspaceRepo.findFirstByTenant).not.toHaveBeenCalled();
    expect(snapshotRepo.createPendingSnapshot).not.toHaveBeenCalled();
  });

  it('does not send the same first immutable snapshot twice', async () => {
    slack.sendMessage.mockResolvedValue({
      externalMessageId: '1788719999.000001',
      sentAt: new Date('2026-09-06T17:19:59.000Z'),
    });
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue(null);
    snapshotRepo.createPendingSnapshot
      .mockResolvedValueOnce('snapshot-1')
      .mockResolvedValueOnce(null);
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );
    const job = { id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } };

    await processor.process(job as never);
    await processor.process({ ...job, id: 'job-2' } as never);

    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
    expect(snapshotRepo.markDelivered).toHaveBeenCalledWith(
      'snapshot-1',
      '1788719999.000001',
      new Date('2026-09-06T17:19:59.000Z'),
    );
  });

  it('marks an in-flight Slack exception as delivery_unknown', async () => {
    slack.sendMessage.mockRejectedValue(new Error('timeout'));
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue(null);
    snapshotRepo.createPendingSnapshot.mockResolvedValueOnce('snapshot-1');
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(snapshotRepo.markDeliveryUnknown).toHaveBeenCalledWith(
      'snapshot-1',
      'timeout',
      expect.any(Date),
    );
  });

  it('cancels a pending snapshot when the manager binding changes before delivery', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue(null);
    snapshotRepo.createPendingSnapshot.mockResolvedValueOnce('snapshot-1');
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo('manager-2') as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(snapshotRepo.markCancelled).toHaveBeenCalledWith('snapshot-1', 'manager_target_changed');
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('does not publish a later intermediate snapshot until five distinct inputs changed', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 6,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'],
        sourceGroupStateIds: ['state-1b', 'state-2b', 'state-3b', 'state-4b', 'state-5', 'state-6'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      status: 'delivered',
      contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'],
      sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5', 'state-6'],
    });
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(snapshotRepo.createPendingSnapshot).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('does not publish a later snapshot while prior delivery is unknown', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1b', 'state-2b', 'state-3b', 'state-4b', 'state-5b'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = { findFirstByTenant: vi.fn() };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      status: 'delivery_unknown',
      contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
    });
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(snapshotRepo.createPendingSnapshot).not.toHaveBeenCalled();
    expect(workspaceRepo.findFirstByTenant).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('publishes version two when five distinct reportable inputs changed', async () => {
    slack.sendMessage.mockResolvedValue({
      externalMessageId: '1788720000.000001',
      sentAt: new Date('2026-09-06T17:20:00.000Z'),
    });
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Manager report.',
        teamScore: 82,
        confirmedCount: 6,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'],
        sourceGroupStateIds: ['state-1b', 'state-2b', 'state-3b', 'state-4b', 'state-5b', 'state-6'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      status: 'delivered',
      contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
    });
    snapshotRepo.createPendingSnapshot.mockResolvedValueOnce('snapshot-2');
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
    } } as never);

    expect(snapshotRepo.createPendingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotVersion: 2 }),
    );
    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('publishes the final report after a delivered intermediate snapshot without five changed inputs', async () => {
    slack.sendMessage.mockResolvedValue({
      externalMessageId: '1788720001.000001',
      sentAt: new Date('2026-10-01T00:10:00.000Z'),
    });
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Final manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue({
      snapshotVersion: 1,
      status: 'delivered',
      reportKind: 'intermediate',
      contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
    });
    snapshotRepo.createPendingSnapshot.mockResolvedValueOnce('snapshot-2');
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
      reportKind: 'final',
    } } as never);

    expect(snapshotRepo.createPendingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotVersion: 2,
        payload: expect.objectContaining({ reportKind: 'final' }),
      }),
    );
    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('publishes one final cycle message with only eligible Pulse Index sections', async () => {
    slack.sendMessage.mockResolvedValue({
      externalMessageId: '1788720002.000001',
      sentAt: new Date('2026-10-01T00:20:00.000Z'),
    });
    const useCase = {
      execute: vi.fn(async (input: { questionGroup: string }) => input.questionGroup === 'growth'
        ? {
            shouldSend: true,
            managerSlackUserId: 'manager-1',
            message: 'Final Growth report.\nGrowth action.',
            teamScore: 82,
            confirmedCount: 5,
            contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
            sourceGroupStateIds: ['growth-1', 'growth-2', 'growth-3', 'growth-4', 'growth-5'],
            policyVersion: 'group-report-snapshot-v1',
          }
        : {
            shouldSend: false,
            managerSlackUserId: null,
            message: 'Final Purpose report.',
            teamScore: 0,
            confirmedCount: 4,
            contributorUserIds: [],
            sourceGroupStateIds: [],
            policyVersion: 'group-report-snapshot-v1',
          }),
    };
    const workspaceRepo = {
      findFirstByTenant: vi.fn().mockResolvedValue({
        id: 'workspace-connection-1',
        externalWorkspaceId: 'workspace-1',
        botToken: 'xoxb-test',
      }),
    };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue(null);
    snapshotRepo.createPendingSnapshot.mockResolvedValueOnce('snapshot-cycle-1');
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'cycle',
      questionGroups: ['growth', 'purpose'],
      traceId: 'trace-1',
      reportKind: 'final',
    } } as never);

    expect(useCase.execute).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      reportKind: 'final',
    });
    expect(useCase.execute).toHaveBeenCalledWith({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'purpose',
      reportKind: 'final',
    });
    expect(snapshotRepo.createPendingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        questionGroup: 'cycle',
        snapshotVersion: 1,
        payload: expect.objectContaining({
          reportKind: 'final',
          message: expect.stringContaining('Final Growth report.'),
        }),
      }),
    );
    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
    expect(slack.sendMessage.mock.calls[0][0].text).toContain('Final Growth report.');
    expect(slack.sendMessage.mock.calls[0][0].text).not.toContain('Final Purpose report.');
  });

  it('does not publish a second final report for the same cohort and Pulse Index', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        shouldSend: true,
        managerSlackUserId: 'manager-1',
        message: 'Final manager report.',
        teamScore: 82,
        confirmedCount: 5,
        contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
        sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
        policyVersion: 'group-report-snapshot-v1',
      }),
    };
    const workspaceRepo = { findFirstByTenant: vi.fn() };
    const snapshotRepo = createSnapshotRepo();
    snapshotRepo.findLatestNonCancelledSnapshot.mockResolvedValue({
      snapshotVersion: 2,
      status: 'delivered',
      reportKind: 'final',
      contributorUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      sourceGroupStateIds: ['state-1', 'state-2', 'state-3', 'state-4', 'state-5'],
    });
    const processor = new GroupReportProcessor(
      useCase as never,
      workspaceRepo as never,
      snapshotRepo as never,
      createTeamRepo() as never,
    );

    await processor.process({ id: 'job-1', data: {
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      questionGroup: 'growth',
      traceId: 'trace-1',
      reportKind: 'final',
    } } as never);

    expect(snapshotRepo.createPendingSnapshot).not.toHaveBeenCalled();
    expect(workspaceRepo.findFirstByTenant).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });
});
