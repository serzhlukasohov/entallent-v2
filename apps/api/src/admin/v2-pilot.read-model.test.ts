import { describe, expect, it } from 'vitest';
import { projectPilotCycle, V2PilotReadModel } from './v2-pilot.read-model';

describe('V2 pilot operator projection', () => {
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
    expect(JSON.stringify(result)).not.toMatch(/private name|private message|"score":42/);
    expect(result).not.toHaveProperty('employeeName');
    expect(result).not.toHaveProperty('messageText');
    expect(result).not.toHaveProperty('score');
  });
});
