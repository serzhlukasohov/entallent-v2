import { beforeEach, describe, expect, it, vi } from 'vitest';

const slack = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('@entalent/channel-slack', () => ({
  SlackAdapter: class { sendMessage = slack.sendMessage; },
}));
vi.mock('@entalent/application', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@entalent/application')>();
  return {
    ...actual,
    selectV2CohortReportInputs: vi.fn(() => ({ eligible: true })),
    buildV2IndexReport: vi.fn(() => ({
      message: 'Safe team aggregate', contributorUserIds: ['a', 'b', 'c', 'd', 'e'],
      sourceQuestionInsightIds: ['1', '2', '3', '4', '5'],
      policyVersion: 'policy-1', calculationVersion: 'equal-weight-1.0.0',
    })),
  };
});

import { V2ReportProcessor } from './v2-report.processor';

const job = { data: {
  tenantId: 'tenant-1', reportingCohortId: 'cohort-1', teamId: 'team-1',
  questionGroup: 'autonomy', reportKind: 'intermediate',
} } as never;

function setup(enabled = true) {
  const inputs = { load: vi.fn().mockResolvedValue({
    teamId: 'team-1', periodEnd: new Date(Date.now() + 86_400_000),
  }) };
  const snapshots = {
    findLatest: vi.fn().mockResolvedValue(null),
    createPending: vi.fn().mockResolvedValue('snapshot-1'),
    markCancelled: vi.fn(), markDelivered: vi.fn(), markDeliveryUnknown: vi.fn(),
  };
  const teams = { findTeamById: vi.fn().mockResolvedValue({ managerSlackUserId: 'D-manager' }) };
  const workspaces = { findFirstByTenant: vi.fn().mockResolvedValue({
    id: 'workspace-1', externalWorkspaceId: 'T-workspace', botToken: 'test-token',
  }) };
  const config = { get: vi.fn((key: string) => key === 'V2_REPORT_SEND_TENANT_ID'
    ? enabled ? 'tenant-1' : undefined : 'equal-weight-1.0.0') };
  const processor = new V2ReportProcessor(
    inputs as never, snapshots as never, teams as never, workspaces as never, config as never,
  );
  return { processor, inputs, snapshots, teams, workspaces };
}

beforeEach(() => slack.sendMessage.mockReset());

describe('V2ReportProcessor', () => {
  it('does not read or send while delivery is disabled', async () => {
    const { processor, inputs, snapshots } = setup(false);
    await processor.process(job);
    expect(inputs.load).not.toHaveBeenCalled();
    expect(snapshots.createPending).not.toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('creates an immutable scoped snapshot before one delivery', async () => {
    const { processor, snapshots } = setup();
    slack.sendMessage.mockResolvedValue({ externalMessageId: '123.456', sentAt: new Date() });
    await processor.process(job);
    expect(snapshots.createPending).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', reportingCohortId: 'cohort-1', teamId: 'team-1',
      questionGroup: 'autonomy', managerSlackChannelId: 'D-manager',
    }));
    expect(slack.sendMessage).toHaveBeenCalledOnce();
    expect(snapshots.markDelivered).toHaveBeenCalledOnce();
  });

  it('cancels before send when the manager target changes', async () => {
    const { processor, teams, snapshots } = setup();
    teams.findTeamById.mockResolvedValueOnce({ managerSlackUserId: 'D-manager' })
      .mockResolvedValueOnce({ managerSlackUserId: 'D-other' });
    await processor.process(job);
    expect(snapshots.markCancelled).toHaveBeenCalledWith('snapshot-1', 'v2_report_scope_or_target_changed');
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('marks ambiguous Slack delivery unknown and never retries the snapshot', async () => {
    const { processor, snapshots } = setup();
    slack.sendMessage.mockImplementationOnce(async () => { throw new Error('timeout'); });
    await processor.process(job);
    expect(snapshots.markDeliveryUnknown).toHaveBeenCalledWith('snapshot-1', expect.any(Date));
    expect(snapshots.findLatest).toHaveBeenCalledTimes(1);
    snapshots.findLatest.mockResolvedValueOnce({ status: 'delivery_unknown' });
    await processor.process(job);
    expect(slack.sendMessage).toHaveBeenCalledOnce();
  });
});
