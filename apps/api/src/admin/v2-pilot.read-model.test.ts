import { describe, expect, it, vi } from 'vitest';
import {
  projectPilotCycle, projectPilotPeople, selectCurrentPilotCohort, V2PilotReadModel,
} from './v2-pilot.read-model';

const TENANT = '7d1e0163-6d53-4713-bd24-254690cc5090';
const CLOSED = {
  cohortId: '9b5d3697-229c-4243-9481-bd6f1456faec',
  periodStart: new Date('2026-10-06T17:00:00Z'),
  periodEnd: new Date('2026-10-08T17:00:00Z'),
};
const ACTIVE = {
  cohortId: 'aa069583-240e-4ef1-bd5a-d45fabdde17a',
  periodStart: new Date('2026-10-09T10:00:00Z'),
  periodEnd: new Date('2026-10-14T17:00:00Z'),
};
const DURING_ACTIVE = new Date('2026-10-11T19:15:00Z');

function personRow(userId: string, outcome: string | null) {
  return {
    userId, displayName: userId, inbound: 3, stableKey: 'autonomy_control_work', title: 'Control',
    group: 'autonomy', workingStatus: outcome ? 'confirmed' : 'collecting', ready: !outcome,
    workingSummary: null, finalSummary: null, outcome, score: outcome ? '70' : null,
  };
}

describe('V2 pilot operator projection', () => {
  it('rejects unscoped private QA reads and never projects source IDs', async () => {
    const readModel = new V2PilotReadModel({} as never);
    await expect(readModel.getPeople('bad-tenant', '9b5d3697-229c-4243-9481-bd6f1456faec'))
      .rejects.toThrow('UUIDs');
    const result = projectPilotPeople(CLOSED, [{
      userId: 'qa-user', displayName: 'QA', inbound: 1, stableKey: 'autonomy_control_work',
      title: 'Control', group: 'autonomy', workingStatus: 'confirmed', ready: false,
      workingSummary: 'erased private text', finalSummary: 'Generalized summary',
      outcome: 'scored', score: '73', sourceMessageIds: ['source-id'],
    } as never]);
    expect(result.people[0]?.questions[0]).toMatchObject({
      status: 'scored', workingSummary: null, finalSummary: 'Generalized summary', score: 73,
    });
    expect(JSON.stringify(result)).not.toContain('source-id');
    expect(JSON.stringify(result)).not.toContain('erased private text');
  });

  it('requires an explicit tenant and approved cohort list before querying', async () => {
    const readModel = new V2PilotReadModel({} as never);
    await expect(readModel.getStatus('bad-tenant', 'eb12c97a-b298-4694-918f-1d9a971bc504'))
      .rejects.toThrow('tenantId');
    await expect(readModel.getStatus('7d1e0163-6d53-4713-bd24-254690cc5090', ''))
      .rejects.toThrow('cohortIds');
    await expect(readModel.getStatus(
      '7d1e0163-6d53-4713-bd24-254690cc5090',
      'eb12c97a-b298-4694-918f-1d9a971bc504,eb12c97a-b298-4694-918f-1d9a971bc504',
    )).rejects.toThrow('cohortIds');
  });

  it('returns only cohort metadata even when a database row has private fields', () => {
    const row = {
      cohortId: 'eb12c97a-b298-4694-918f-1d9a971bc504',
      definitionVersion: 'v2-policy-1.0.0',
      scoringPolicyVersion: '1.0.0',
      periodStart: new Date('2026-10-04T13:30:00Z'),
      periodEnd: new Date('2026-10-04T17:30:00Z'),
      rosterSize: 5,
      managerTargetConfigured: true,
      participants: 2,
      inbound: 10,
      processed: 10,
      lastInboundAt: null,
      windows: 2,
      readyMeanings: 0,
      completeGroups: 0,
      noDataMeanings: 7,
      bundles: 0,
      awaitingBundles: 0,
      resolvedBundles: 0,
      deliveredDisclosures: 1,
      deliveredBundles: 1,
      autonomyVerdicts: 1,
      autonomyScoredParticipants: 1,
      finalScored: 0,
      finalInsufficient: 0,
      reportSnapshots: 0,
      sentReports: 0,
      employeeName: 'private name',
      messageText: 'private message',
      score: 42,
    };

    const result = projectPilotCycle(row, []);
    expect(result.participants).toBe(2);
    expect(result.noDataMeanings).toBe(7);
    expect(result.autonomyScoredParticipants).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/private name|private message|"score":42/);
    expect(result).not.toHaveProperty('employeeName');
    expect(result).not.toHaveProperty('messageText');
    expect(result).not.toHaveProperty('score');
  });

  it('selects the running cohort, not the older closed cohort that has more data', () => {
    // The closed cohort is listed first and would win any "most data" or
    // "latest completed" heuristic; only the period decides.
    const cohorts = [CLOSED, ACTIVE];
    expect(selectCurrentPilotCohort(cohorts, DURING_ACTIVE)?.cohortId).toBe(ACTIVE.cohortId);
    // No running cohort: the latest started one stands in and is never upcoming.
    const upcoming = { ...ACTIVE, cohortId: 'bb069583-240e-4ef1-bd5a-d45fabdde17a',
      periodStart: new Date('2026-10-20T10:00:00Z'), periodEnd: new Date('2026-10-25T10:00:00Z') };
    expect(selectCurrentPilotCohort([CLOSED, upcoming], DURING_ACTIVE)?.cohortId).toBe(CLOSED.cohortId);
    expect(selectCurrentPilotCohort([upcoming], DURING_ACTIVE)).toBeNull();
  });

  it('serves people for the active cohort by default and labels a closed cohort as closed', async () => {
    vi.useFakeTimers({ now: DURING_ACTIVE, toFake: ['Date'] });
    try {
      const execute = vi.fn()
        .mockResolvedValueOnce([CLOSED, ACTIVE])
        .mockResolvedValueOnce([personRow('serhii', 'scored'), personRow('illia', 'scored')]);
      const readModel = new V2PilotReadModel({ client: { execute } } as never);

      const current = await readModel.getPeople(TENANT, undefined);
      expect(current).toMatchObject({ cohortId: ACTIVE.cohortId, state: 'active',
        periodStart: '2026-10-09T10:00:00.000Z', periodEnd: '2026-10-14T17:00:00.000Z' });
      expect(current.people.map((person) => person.userId)).toEqual(['serhii', 'illia']);
      expect(JSON.stringify(execute.mock.calls[1]?.[0])).toContain(ACTIVE.cohortId);
      expect(JSON.stringify(execute.mock.calls[1]?.[0])).not.toContain(CLOSED.cohortId);

      execute.mockResolvedValueOnce([CLOSED, ACTIVE]).mockResolvedValueOnce([personRow('ed', 'scored')]);
      const closed = await readModel.getPeople(TENANT, CLOSED.cohortId);
      expect(closed).toMatchObject({ cohortId: CLOSED.cohortId, state: 'closed' });

      execute.mockResolvedValueOnce([]);
      await expect(readModel.getPeople(TENANT, undefined)).rejects.toThrow('No V2 pilot cohort');
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the status view to started tenant cohorts and marks only the running one active', async () => {
    vi.useFakeTimers({ now: DURING_ACTIVE, toFake: ['Date'] });
    try {
      const cycleRow = (cohort: typeof CLOSED) => ({ ...cohort, definitionVersion: 'v2', scoringPolicyVersion: '1.0.0' });
      const execute = vi.fn()
        .mockResolvedValueOnce([ACTIVE, CLOSED])
        .mockResolvedValueOnce([cycleRow(ACTIVE), cycleRow(CLOSED)])
        .mockResolvedValue([]);
      const readModel = new V2PilotReadModel({ client: { execute } } as never);
      const result = await readModel.getStatus(TENANT, undefined);
      expect(result.cycles.map((cycle) => [cycle.cohortId, cycle.state])).toEqual([
        [ACTIVE.cohortId, 'active'], [CLOSED.cohortId, 'closed'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
