import { describe, expect, it, vi } from 'vitest';
import {
  projectPilotCycle, projectPilotPeople, projectPilotQaTeamSignals, projectPilotTeamSignals, selectCurrentPilotCohort, V2PilotReadModel,
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
    userId, displayName: userId, inbound: 3, lastInboundAt: null, stableKey: 'autonomy_control_work', title: 'Control',
    group: 'autonomy', workingStatus: outcome ? 'confirmed' : 'collecting', ready: !outcome,
    workingSummary: null, finalSummary: null, outcome, score: outcome ? '70' : null,
  };
}

function signalRow(summary: string, outcome = 'scored', score: string | null = '64') {
  return {
    stableKey: 'autonomy_control_work', title: 'Control', group: 'autonomy', summary, outcome, score,
    direction: 'mixed', severity: 'moderate', rootCause: 'autonomy',
  };
}

describe('V2 pilot operator projection', () => {
  it('rejects unscoped private QA reads and never projects source IDs', async () => {
    const readModel = new V2PilotReadModel({} as never);
    await expect(readModel.getPeople('bad-tenant', '9b5d3697-229c-4243-9481-bd6f1456faec'))
      .rejects.toThrow('UUIDs');
    const result = projectPilotPeople(CLOSED, [{
      userId: 'qa-user', displayName: 'QA', inbound: 1, lastInboundAt: null, stableKey: 'autonomy_control_work',
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

  it('validates Team Signals input before querying', async () => {
    const execute = vi.fn();
    const readModel = new V2PilotReadModel({ client: { execute } } as never);
    await expect(readModel.getTeamSignals('bad-tenant', undefined)).rejects.toThrow('UUIDs');
    await expect(readModel.getTeamSignals(TENANT, 'not-a-uuid')).rejects.toThrow('UUIDs');
    expect(execute).not.toHaveBeenCalled();
    execute.mockResolvedValueOnce([]);
    await expect(readModel.getTeamSignals(TENANT, undefined)).rejects.toThrow('No V2 pilot cohort');
  });

  it('serves Team Signals for the running cohort by default without identity joins', async () => {
    vi.useFakeTimers({ now: DURING_ACTIVE, toFake: ['Date'] });
    try {
      const execute = vi.fn()
        .mockResolvedValueOnce([CLOSED, ACTIVE])
        .mockResolvedValueOnce([signalRow('Team wants clearer priorities')]);
      const readModel = new V2PilotReadModel({ client: { execute } } as never);

      const current = await readModel.getTeamSignals(TENANT, undefined);
      expect(current).toMatchObject({ cohortId: ACTIVE.cohortId, state: 'active' });
      expect(current.signals).toEqual([expect.objectContaining({ summary: 'Team wants clearer priorities', score: 64 })]);
      const query = JSON.stringify(execute.mock.calls[1]?.[0]);
      expect(query).toContain(ACTIVE.cohortId);
      expect(query).not.toContain(CLOSED.cohortId);
      // Same population as the people view: frozen roster, participant-confirmed rows only.
      expect(query).toMatch(/unnest\(c\.roster_user_ids\)/);
      expect(query).toMatch(/i\.working_insight_id IS NOT NULL/);
      expect(query).not.toContain('channel_accounts');
      expect(query.slice(0, query.indexOf('FROM'))).not.toContain('user_id');

      execute.mockResolvedValueOnce([CLOSED, ACTIVE]).mockResolvedValueOnce([]);
      const closed = await readModel.getTeamSignals(TENANT, CLOSED.cohortId);
      expect(closed).toMatchObject({ cohortId: CLOSED.cohortId, state: 'closed', signals: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('projects Team Signals without private fields and keeps a missing score null', () => {
    const result = projectPilotTeamSignals(ACTIVE, [
      { ...signalRow('Generalized summary'), userId: 'qa-user', displayName: 'Serhii',
        surveyWindowId: 'window-id', workingInsightId: 'working-id', sourceMessageIds: ['source-id'],
        workingSummary: 'private working text' } as never,
      signalRow('Not enough evidence', 'insufficient_evidence', null),
    ], DURING_ACTIVE);
    expect(result.signals[0]).toEqual({
      stableKey: 'autonomy_control_work', title: 'Control', group: 'autonomy', summary: 'Generalized summary',
      outcome: 'scored', score: 64, direction: 'mixed', severity: 'moderate', rootCause: 'autonomy',
    });
    expect(result.signals[1]).toMatchObject({ outcome: 'insufficient_evidence', score: null });
    const json = JSON.stringify(result);
    for (const leaked of ['qa-user', 'Serhii', 'window-id', 'working-id', 'source-id', 'private working text']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('projects the latest inbound time per person and no insight id', () => {
    const result = projectPilotPeople(ACTIVE, [
      { ...personRow('anna', 'scored'), lastInboundAt: new Date('2026-10-11T08:30:00Z'), insightId: 'insight-anna' } as never,
      { ...personRow('anna', null), stableKey: 'autonomy_pace' },
      personRow('vera', null),
    ], DURING_ACTIVE);
    expect(result.people.map((person) => [person.userId, person.lastInboundAt])).toEqual([
      ['anna', '2026-10-11T08:30:00.000Z'], ['vera', null],
    ]);
    expect(JSON.stringify(result)).not.toContain('insight');
  });

  it('keeps the de-identified Team Signals query and projection free of authors and insight ids', async () => {
    const execute = vi.fn().mockResolvedValueOnce([ACTIVE]).mockResolvedValueOnce([
      { ...signalRow('Summary'), insightId: 'insight-1', userId: 'qa-user', displayName: 'Anna' },
    ]);
    const readModel = new V2PilotReadModel({ client: { execute } } as never);
    const result = await readModel.getTeamSignals(TENANT, ACTIVE.cohortId);
    expect(result.signals[0]).not.toHaveProperty('insightId');
    expect(result.signals[0]).not.toHaveProperty('author');
    expect(JSON.stringify(result)).not.toMatch(/insight-1|qa-user|Anna/);
    const query = JSON.stringify(execute.mock.calls[1]?.[0]);
    const selectList = query.slice(0, query.indexOf('FROM'));
    expect(selectList).not.toContain('user_id');
    expect(selectList).not.toContain('insightId');
    expect(selectList).not.toMatch(/\bi(nsight)?\.id\b/);
  });

  it('serves QA Team Signals with the author from the roster and the linked Slack name', async () => {
    const execute = vi.fn().mockResolvedValueOnce([ACTIVE]).mockResolvedValueOnce([
      { ...signalRow('Summary'), userId: 'anna-id', displayName: 'Anna Smirnova' },
    ]);
    const readModel = new V2PilotReadModel({ client: { execute } } as never);
    await expect(readModel.getQaTeamSignals('bad-tenant', undefined)).rejects.toThrow('UUIDs');
    const result = await readModel.getQaTeamSignals(TENANT, ACTIVE.cohortId);
    expect(result.cohortId).toBe(ACTIVE.cohortId);
    expect(result.signals[0]).toMatchObject({
      summary: 'Summary', score: 64, author: { userId: 'anna-id', displayName: 'Anna Smirnova' },
    });
    const query = JSON.stringify(execute.mock.calls[1]?.[0]);
    expect(query).toContain(ACTIVE.cohortId);
    expect(query).toMatch(/unnest\(c\.roster_user_ids\) WITH ORDINALITY/);
    expect(query).toContain('channel_accounts');
    expect(query).toContain("'Participant ' || member.position");
    expect(query).toMatch(/i\.working_insight_id IS NOT NULL/);
  });

  it('projects QA Team Signals with the author and drops injected private fields', () => {
    const result = projectPilotQaTeamSignals(ACTIVE, [
      { ...signalRow('Generalized summary'), userId: 'anna-id', displayName: 'Anna',
        sourceMessageIds: ['source-id'], workingSummary: 'private working text', insightId: 'insight-1' } as never,
    ], DURING_ACTIVE);
    expect(result.signals[0]).toEqual({
      stableKey: 'autonomy_control_work', title: 'Control', group: 'autonomy', summary: 'Generalized summary',
      outcome: 'scored', score: 64, direction: 'mixed', severity: 'moderate', rootCause: 'autonomy',
      author: { userId: 'anna-id', displayName: 'Anna' },
    });
    expect(JSON.stringify(result)).not.toMatch(/source-id|private working text|insight-1/);
  });
});
