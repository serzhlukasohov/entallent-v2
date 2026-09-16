import { describe, expect, it, vi } from 'vitest';
import type { SaveSurveyEvidenceParams, UpsertAssessmentParams } from '@entalent/application';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildFindPulseCaptureForConversationSql, SurveyRepository } from './survey.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

const persistedEvidence = {
  id: 'evidence-1',
  surveyWindowId: 'window-1',
  surveyQuestionId: 'question-1',
  userId: 'user-1',
  sourceMessageIds: ['message-1'],
  evidenceSummary: 'Knows their goals clearly',
  polarity: 'positive',
  strength: '0.80',
  completeness: '0.75',
  confidence: '0.85',
  evaluatorVersion: 'v1',
  promptVersion: 'v1',
  createdAt: new Date('2026-08-12T16:30:00.000Z'),
};

function createDbMock() {
  const returning = vi.fn().mockResolvedValue([persistedEvidence]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));

  return {
    client: {
      insert,
    },
    calls: {
      insert,
      values,
      returning,
    },
  };
}

function makeRepository(db: ReturnType<typeof createDbMock>) {
  return new SurveyRepository(db as never, {} as never, {} as never);
}

const validEvidenceParams: SaveSurveyEvidenceParams = {
  surveyWindowId: 'window-1',
  surveyQuestionId: 'question-1',
  userId: 'user-1',
  sourceMessageIds: ['message-1'],
  evidenceSummary: 'Knows their goals clearly',
  polarity: 'positive',
  strength: 0.8,
  completeness: 0.75,
  confidence: 0.85,
  evaluatorVersion: 'v1',
  promptVersion: 'v1',
};

describe('SurveyRepository', () => {
  it('scopes all pulse capture provenance to owned earlier inbound messages in one conversation', () => {
    const beforeOccurredAt = new Date('2026-09-03T10:00:00.000Z');
    const query = compileSql(buildFindPulseCaptureForConversationSql({
      tenantId: 'tenant-1',
      userId: 'user-1',
      conversationId: 'conversation-1',
      beforeOccurredAt,
    }));

    expect(query.sql).toContain('"survey_windows"."tenant_id"');
    expect(query.sql).toContain('"survey_windows"."user_id"');
    expect(query.sql).toContain('select count(*)::integer');
    expect(query.sql).toContain('evidence_source.id = any');
    expect(query.sql).toContain('evidence_source.tenant_id');
    expect(query.sql).toContain('evidence_source.user_id');
    expect(query.sql).toContain('evidence_source.conversation_id');
    expect(query.sql).toContain("evidence_source.direction = 'inbound'");
    expect(query.sql).toContain('evidence_source.deleted_at is null');
    expect(query.sql).toContain('evidence_source.occurred_at <');
    expect(query.sql).toContain('= cardinality("survey_evidence"."source_message_ids")');
    expect(query.sql).toContain('coalesce(cardinality("survey_evidence"."source_message_ids"), 0) > 0');
    expect(query.sql).toContain('provenance_message.id = any');
    expect(query.sql).toContain("confirmation_prompt.metadata->'confirmationSourceMessageIds' ? provenance_message.id::text");
    expect(query.sql).toContain('confirmation_prompt.tenant_id');
    expect(query.sql).toContain('confirmation_prompt.user_id');
    expect(query.sql).toContain('confirmation_prompt.conversation_id');
    expect(query.sql).toContain("confirmation_prompt.direction = 'outbound'");
    expect(query.sql).toContain('confirmation_prompt.deleted_at is null');
    expect(query.sql).toContain('"survey_evidence"."superseded_at" is null');
    expect(query.params).toEqual(expect.arrayContaining([
      'tenant-1', 'user-1', 'conversation-1', beforeOccurredAt,
    ]));
  });

  it('maps final lifecycle only with exact prompt provenance and otherwise fails closed', async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        evidenceId: 'e-1', evidenceSummary: 'Working summary', questionGroup: 'growth',
        sourceMessageIds: ['m-1'], groupStatus: 'confirmed', hasFinalProvenance: false,
        confirmationSummary: 'Legacy final summary',
      },
      {
        evidenceId: 'e-2', evidenceSummary: 'Working two', questionGroup: 'belonging',
        sourceMessageIds: ['m-2'], groupStatus: 'confirmed', hasFinalProvenance: true,
        confirmationSummary: 'Exact confirmed summary',
      },
      {
        evidenceId: 'e-2b', evidenceSummary: 'Another working row', questionGroup: 'belonging',
        sourceMessageIds: ['m-2b'], groupStatus: 'confirmed', hasFinalProvenance: true,
        confirmationSummary: 'Exact confirmed summary',
      },
      {
        evidenceId: 'e-3', evidenceSummary: 'Working three', questionGroup: 'purpose',
        sourceMessageIds: ['m-3'], groupStatus: 'withdrawn', hasFinalProvenance: true,
        confirmationSummary: 'Exact withdrawn summary',
      },
      {
        evidenceId: 'e-4', evidenceSummary: 'Working four', questionGroup: 'autonomy',
        sourceMessageIds: ['m-4'], groupStatus: 'report_sent', hasFinalProvenance: true,
        confirmationSummary: 'Exact reported summary',
      },
    ]);
    const repository = new SurveyRepository({ client: { execute } } as never, {} as never, {} as never);

    await expect(repository.findPulseCaptureForConversation({
      tenantId: 'tenant-1', userId: 'user-1', conversationId: 'conversation-1',
      beforeOccurredAt: new Date('2026-09-03T10:00:00.000Z'),
    })).resolves.toEqual([
      {
        evidenceSummary: 'Working summary', questionGroup: 'growth',
        sourceMessageIds: ['m-1'], status: 'temporary',
      },
      {
        evidenceSummary: 'Exact confirmed summary', questionGroup: 'belonging',
        sourceMessageIds: ['m-2', 'm-2b'], status: 'confirmed',
      },
      {
        evidenceSummary: 'Exact withdrawn summary', questionGroup: 'purpose',
        sourceMessageIds: ['m-3'], status: 'withdrawn',
      },
      {
        evidenceSummary: 'Exact reported summary', questionGroup: 'autonomy',
        sourceMessageIds: ['m-4'], status: 'confirmed',
      },
    ]);
  });

  it('freezes sorted distinct rosters in one cycle-opening transaction', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const openedAt = new Date('2026-07-01T00:00:00.000Z');
    const cohort = {
      id: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', surveyDefinitionId: 'definition-1',
      periodStart, periodEnd, rosterUserIds: ['user-1', 'user-2'], openedAt,
    };
    const definitionLimit = vi.fn().mockResolvedValue([{ id: 'definition-1' }]);
    const membershipWhere = vi.fn().mockResolvedValue([
      { teamId: 'team-1', userId: 'user-2' },
      { teamId: 'team-1', userId: 'user-1' },
      { teamId: 'team-1', userId: 'user-2' },
    ]);
    const membershipChain: Record<string, ReturnType<typeof vi.fn>> = {
      innerJoin: vi.fn(),
      where: membershipWhere,
    };
    membershipChain['innerJoin']!.mockReturnValue(membershipChain);
    const cohortOrderBy = vi.fn().mockResolvedValue([cohort]);
    const select = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: definitionLimit })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) })) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ teamId: 'team-1' }]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => membershipChain) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: cohortOrderBy })) })) });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const tx = { select, insert: vi.fn(() => ({ values })) };
    const transaction = vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx));
    const repository = new SurveyRepository(
      { client: { transaction } } as never,
      {} as never,
      {} as never,
    );

    await expect(repository.openReportingCycle({
      tenantId: 'tenant-1', surveyDefinitionId: 'definition-1', periodStart, periodEnd, openedAt,
    })).resolves.toEqual([cohort]);

    expect(transaction).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith([expect.objectContaining({
      teamId: 'team-1',
      rosterUserIds: ['user-1', 'user-2'],
    })]);
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    const eligibilityQuery = compileSql(membershipWhere.mock.calls[0]?.[0]);
    expect(eligibilityQuery.sql).toContain("\"users\".\"consent_state\"->'surveyEnabled' = 'true'::jsonb");
    expect(eligibilityQuery.sql).toContain('other_membership.team_id <> "team_memberships"."team_id"');
    expect(eligibilityQuery.params.filter((value) => value instanceof Date)).toEqual([]);
  });

  it('does not recompute a cycle after its first cohort was persisted', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const openedAt = new Date('2026-07-01T00:00:00.000Z');
    const cohort = {
      id: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', surveyDefinitionId: 'definition-1',
      periodStart, periodEnd, rosterUserIds: ['user-1'], openedAt,
    };
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: 'definition-1' }]) })) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([cohort]) })) })),
      });
    const tx = { select, insert: vi.fn() };
    const transaction = vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx));
    const repository = new SurveyRepository({ client: { transaction } } as never, {} as never, {} as never);

    await expect(repository.openReportingCycle({
      tenantId: 'tenant-1', surveyDefinitionId: 'definition-1', periodStart, periodEnd, openedAt,
    })).resolves.toEqual([cohort]);

    expect(tx.insert).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('finds closed cohorts that are ready for final report enqueueing', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const cohort = {
      id: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', surveyDefinitionId: 'definition-1',
      periodStart, periodEnd, rosterUserIds: ['user-1'], openedAt: periodStart,
    };
    const orderBy = vi.fn().mockResolvedValue([cohort]);
    const where = vi.fn((_value: unknown) => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const repository = new SurveyRepository({ client: { select } } as never, {} as never, {} as never);

    await expect(repository.findReportingCohortsReadyForFinalReports({
      tenantId: 'tenant-1',
      surveyDefinitionId: 'definition-1',
      now: periodEnd,
    })).resolves.toEqual([cohort]);

    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_reporting_cohorts"."tenant_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."survey_definition_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."period_end" <=');
    expect(query.params).toEqual(['tenant-1', 'definition-1', periodEnd.toISOString()]);
    expect(orderBy).toHaveBeenCalledOnce();
  });

  it('expires only unconfirmed temporary group states from closed cohorts', async () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const returning = vi.fn().mockResolvedValue([{ id: 'state-1' }, { id: 'state-2' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new SurveyRepository({ client: { update } } as never, {} as never, {} as never);

    await expect(repository.expireTemporaryGroupStatesForClosedCohorts({
      tenantId: 'tenant-1',
      surveyDefinitionId: 'definition-1',
      now,
    })).resolves.toBe(2);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'expired',
      aiSummary: null,
      employeeScore: null,
      personalRecs: null,
      deidentificationDecision: null,
      confirmationPromptMessageId: null,
      confirmedAt: null,
      reportingDisclosureVersion: null,
      reportingDisclosureShownAt: null,
      confirmationMessageId: null,
      withdrawnAt: null,
      withdrawalMessageId: null,
    }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."tenant_id"');
    expect(query.sql).toContain('"survey_group_states"."status" in');
    expect(query.sql).toContain('"survey_windows"."reporting_cohort_id" = "survey_reporting_cohorts"."id"');
    expect(query.sql).toContain('"survey_windows"."user_id" = "survey_group_states"."user_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."tenant_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."survey_definition_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."period_end" <=');
    expect(query.params).toEqual([
      'tenant-1',
      'in_progress',
      'pending_confirmation',
      'awaiting_confirmation',
      'tenant-1',
      'tenant-1',
      'definition-1',
      now.toISOString(),
    ]);
    expect(returning).toHaveBeenCalledWith(expect.objectContaining({ id: expect.anything() }));
  });

  it('fails instead of pretending a tenant without configured teams opened a cycle', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const openedAt = new Date('2026-07-01T00:00:00.000Z');
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ id: 'definition-1' }]) })) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) })) })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      });
    const tx = { select };
    const transaction = vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx));
    const repository = new SurveyRepository({ client: { transaction } } as never, {} as never, {} as never);

    await expect(repository.openReportingCycle({
      tenantId: 'tenant-1', surveyDefinitionId: 'definition-1', periodStart, periodEnd, openedAt,
    })).rejects.toThrow('survey_reporting_cycle_has_no_teams');
  });

  it('reuses the persisted cycle roster on a new employee survey window', async () => {
    const frozenRoster = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'];
    const selectedRows = [[], [{ id: 'definition-1' }], [{
      id: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', surveyDefinitionId: 'definition-1',
      periodStart: new Date('2026-07-01T00:00:00.000Z'), periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      rosterUserIds: frozenRoster, openedAt: new Date('2026-07-01T00:00:00.000Z'),
    }]];
    const limit = vi.fn(() => Promise.resolve(selectedRows.shift() ?? []));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const returning = vi.fn().mockResolvedValue([{
      id: 'window-1', tenantId: 'tenant-1', userId: 'user-1', surveyDefinitionId: 'definition-1',
      periodType: 'quarter', periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'), reportingCohortId: 'cohort-1', reportingTeamId: 'team-1',
      reportingRosterUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'], status: 'active',
    }]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (run: (tx: { insert: typeof insert }) => Promise<unknown>) => run({ insert }));
    const teamRepo = {
      findTeamByMemberId: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        teamName: 'Platform',
        managerSlackUserId: null,
        activeTeamSize: 5,
        memberUserIds: frozenRoster,
        reportingCohortId: null,
        reportingSurveyDefinitionId: null,
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
      }),
    };
    const repository = new SurveyRepository(
      { client: { select, transaction } } as never,
      {} as never,
      teamRepo as never,
    );

    await expect(repository.findOrCreateActiveWindow('user-1', 'tenant-1'))
      .resolves.toMatchObject({
        reportingTeamId: 'team-1',
        reportingCohortId: 'cohort-1',
        reportingRosterUserIds: frozenRoster,
      });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      reportingCohortId: 'cohort-1',
      reportingTeamId: 'team-1',
      reportingRosterUserIds: frozenRoster,
    }));
  });

  it('rolls a stale legacy window into the already-open canonical cohort', async () => {
    const legacyWindow = {
      id: 'window-legacy', tenantId: 'tenant-1', userId: 'user-1', surveyDefinitionId: 'definition-1',
      periodType: 'quarter', periodStart: new Date('2026-04-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-30T23:59:59.999Z'), reportingTeamId: null,
      reportingRosterUserIds: [], status: 'active',
    };
    const cohort = {
      id: 'cohort-1', tenantId: 'tenant-1', teamId: 'team-1', surveyDefinitionId: 'definition-1',
      periodStart: new Date('2026-07-01T00:00:00.000Z'), periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      rosterUserIds: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5'],
      openedAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const selectedRows = [[legacyWindow], [{ id: 'definition-1' }], [cohort]];
    const limit = vi.fn(() => Promise.resolve(selectedRows.shift() ?? []));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const createdWindow = {
      ...legacyWindow,
      id: 'window-current',
      periodStart: cohort.periodStart,
      periodEnd: cohort.periodEnd,
      reportingCohortId: cohort.id,
      reportingTeamId: cohort.teamId,
      reportingRosterUserIds: cohort.rosterUserIds,
    };
    const returning = vi.fn().mockResolvedValue([createdWindow]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (run: (tx: {
      update: typeof update;
      insert: typeof insert;
    }) => Promise<unknown>) => run({ update, insert }));
    const teamRepo = {
      findTeamByMemberId: vi.fn().mockResolvedValue({
        teamId: 'team-1',
        tenantId: 'tenant-1',
        teamName: 'Platform',
        managerSlackUserId: null,
        activeTeamSize: 5,
        memberUserIds: cohort.rosterUserIds,
        reportingCohortId: null,
        reportingSurveyDefinitionId: null,
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
      }),
    };
    const repository = new SurveyRepository(
      { client: { select, transaction } } as never,
      {} as never,
      teamRepo as never,
    );

    await expect(repository.findOrCreateActiveWindow('user-1', 'tenant-1'))
      .resolves.toMatchObject({ reportingCohortId: 'cohort-1', reportingTeamId: 'team-1' });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ reportingCohortId: 'cohort-1' }));
  });

  it('rolls a transferred employee into a current-team window outside the open cohort', async () => {
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-10-01T00:00:00.000Z');
    const existing = {
      id: 'window-old', tenantId: 'tenant-1', userId: 'user-1', surveyDefinitionId: 'definition-1',
      periodType: 'quarter', periodStart, periodEnd, reportingCohortId: 'cohort-old',
      reportingTeamId: 'team-old', reportingRosterUserIds: ['user-1', 'user-2'], status: 'active',
    };
    const oldCohort = {
      id: 'cohort-old', tenantId: 'tenant-1', teamId: 'team-old', surveyDefinitionId: 'definition-1',
      periodStart, periodEnd, rosterUserIds: ['user-1', 'user-2'], openedAt: periodStart,
    };
    const created = {
      ...existing,
      id: 'window-new',
      reportingCohortId: null,
      reportingTeamId: 'team-new',
      reportingRosterUserIds: [],
    };
    const selectedRows = [[existing], [{ id: 'definition-1' }], [oldCohort]];
    const limit = vi.fn(() => Promise.resolve(selectedRows.shift() ?? []));
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const updateWhere = vi.fn().mockResolvedValue([]);
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));
    const returning = vi.fn().mockResolvedValue([created]);
    const values = vi.fn(() => ({ returning }));
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (run: (tx: {
      update: typeof update;
      insert: typeof insert;
    }) => Promise<unknown>) => run({ update, insert }));
    const teamRepo = {
      findTeamByMemberId: vi.fn().mockResolvedValue({
        teamId: 'team-new',
        tenantId: 'tenant-1',
        teamName: 'New Team',
        managerSlackUserId: null,
        activeTeamSize: 1,
        memberUserIds: ['user-1'],
        reportingCohortId: null,
        reportingSurveyDefinitionId: null,
        reportingPeriodStart: null,
        reportingPeriodEnd: null,
      }),
    };
    const repository = new SurveyRepository(
      { client: { select, transaction } } as never,
      {} as never,
      teamRepo as never,
    );

    await expect(repository.findOrCreateActiveWindow('user-1', 'tenant-1'))
      .resolves.toMatchObject({
        id: 'window-new',
        reportingCohortId: null,
        reportingTeamId: 'team-new',
        reportingRosterUserIds: [],
      });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'closed' }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      reportingCohortId: null,
      reportingTeamId: 'team-new',
      reportingRosterUserIds: [],
    }));
  });

  it('persists evidence with an allowed polarity', async () => {
    const db = createDbMock();
    const repository = makeRepository(db);

    await expect(repository.saveEvidence(validEvidenceParams)).resolves.toMatchObject({
      id: 'evidence-1',
      polarity: 'positive',
      strength: 0.8,
      completeness: 0.75,
      confidence: 0.85,
    });

    expect(db.calls.insert).toHaveBeenCalledTimes(1);
    expect(db.calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        polarity: 'positive',
        strength: '0.8',
        completeness: '0.75',
        confidence: '0.85',
      }),
    );
  });

  it('rejects unsupported polarity before inserting evidence', async () => {
    const db = createDbMock();
    const repository = makeRepository(db);

    await expect(
      repository.saveEvidence({
        ...validEvidenceParams,
        polarity: 'unclear',
      } as never),
    ).rejects.toThrow('survey_evidence_invalid_polarity');

    expect(db.calls.insert).not.toHaveBeenCalled();
    expect(db.calls.values).not.toHaveBeenCalled();
  });

  it('persists assessment score when an explicit numeric value exists', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const repository = new SurveyRepository({ client: { select, insert } } as never, {} as never, {} as never);

    const params: UpsertAssessmentParams = {
      surveyWindowId: 'window-1',
      surveyQuestionId: 'question-1',
      confidence: 0.9,
      status: 'scored',
      evidenceId: 'evidence-1',
      evaluatorVersion: 'v1',
      score: 7,
    };

    await repository.upsertAssessment(params);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ score: '7' }));
  });

  it('updates an existing assessment with an explicit numeric score', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'assessment-1', evidenceIds: ['evidence-old'] }]);
    const selectWhere = vi.fn(() => ({ limit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const setWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: setWhere }));
    const db = {
      client: {
        select: vi.fn(() => ({ from: selectFrom })),
        update: vi.fn(() => ({ set })),
      },
    };
    const repository = makeRepository(db as never);

    await repository.upsertAssessment({
      surveyWindowId: 'window-1', surveyQuestionId: 'question-1', score: 6,
      confidence: 1, status: 'scored', evidenceId: 'evidence-new', evaluatorVersion: 'v1',
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      score: '6',
      status: 'scored',
      evidenceIds: ['evidence-old', 'evidence-new'],
    }));
  });

  it('does not erase an existing score when a later assessment has no numeric value', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 'assessment-1', evidenceIds: [] }]);
    const selectWhere = vi.fn(() => ({ limit }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const db = {
      client: {
        select: vi.fn(() => ({ from: selectFrom })),
        update: vi.fn(() => ({ set })),
      },
    };
    const repository = makeRepository(db as never);

    await repository.upsertAssessment({
      surveyWindowId: 'window-1', surveyQuestionId: 'question-1',
      confidence: 0.9, status: 'scored', evidenceId: 'evidence-new', evaluatorVersion: 'v1',
    });

    expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ score: expect.anything() }));
  });

  it('returns assessment scores as numbers', async () => {
    const where = vi.fn().mockResolvedValue([
      { surveyQuestionId: 'question-1', status: 'scored', score: '7.00' },
      { surveyQuestionId: 'question-2', status: 'partially_covered', score: null },
    ]);
    const from = vi.fn(() => ({ where }));
    const db = { client: { select: vi.fn(() => ({ from })) } };
    const repository = makeRepository(db as never);

    await expect(repository.findAssessmentsForWindow('window-1')).resolves.toEqual([
      { surveyQuestionId: 'question-1', status: 'scored', score: 7 },
      { surveyQuestionId: 'question-2', status: 'partially_covered', score: null },
    ]);
  });
});
