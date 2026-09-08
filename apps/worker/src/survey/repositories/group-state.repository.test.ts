import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { GroupStateRepository } from './group-state.repository';

function createSelectDbMock(rows: unknown[] = []) {
  const where = vi.fn().mockResolvedValue(rows);
  const chain: { where: typeof where; innerJoin: ReturnType<typeof vi.fn> } = {
    where,
    innerJoin: vi.fn(),
  };
  chain.innerJoin.mockReturnValue(chain);
  const from = vi.fn(() => chain);
  const select = vi.fn(() => ({ from }));

  return {
    client: { select },
    calls: { select, from, innerJoin: chain.innerJoin, where },
  };
}

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

const acceptedDeidentificationDecision = {
  status: 'accepted' as const,
  policyVersion: 'deidentification-v1' as const,
  reasons: [] as [],
};

describe('GroupStateRepository', () => {
  it('stages one exact outbound receipt only while the group is still pending', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);
    const stage = (repository as unknown as {
      stageGroupConfirmation?: (params: Record<string, unknown>) => Promise<boolean>;
    }).stageGroupConfirmation;

    expect(stage).toEqual(expect.any(Function));
    await expect(stage!.call(repository, {
      surveyWindowId: 'window-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      expectedUpdatedAt: new Date('2026-09-03T09:59:00.000Z'),
      confirmationPromptMessageId: 'outbound-1',
      deidentificationDecision: acceptedDeidentificationDecision,
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      confirmationPromptMessageId: 'outbound-1',
      aiSummary: null,
      deidentificationDecision: acceptedDeidentificationDecision,
    }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id" is null');
    expect(query.sql).toContain('"survey_group_states"."updated_at"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain("'confirmationSummary'");
    expect(query.sql).toContain("'deidentificationDecision'");
    expect(query.sql).toContain("'outbound'");
    expect(query.params).toContain('pending_confirmation');
  });

  it('records a typed de-identification rejection on the pending group state', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);
    const rejected = {
      status: 'rejected' as const,
      policyVersion: 'deidentification-v1' as const,
      reasons: ['known_identifier' as const],
    };

    await expect(repository.recordGroupDeidentificationDecision({
      surveyWindowId: 'window-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      expectedUpdatedAt: new Date('2026-09-03T09:59:00.000Z'),
      deidentificationDecision: rejected,
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      deidentificationDecision: rejected,
    }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id" is null');
    expect(query.params).toContain('pending_confirmation');
  });

  it('activates only the current matching delivered outbound receipt', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);
    const activate = (repository as unknown as {
      activateDeliveredConfirmation?: (params: Record<string, unknown>) => Promise<boolean>;
    }).activateDeliveredConfirmation;

    expect(activate).toEqual(expect.any(Function));
    await expect(activate!.call(repository, {
      confirmationPromptMessageId: 'outbound-1',
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      deliveredAt: new Date('2026-09-03T10:00:00.000Z'),
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_confirmation' }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id"');
    expect(query.sql).toContain('"messages"."sent_at"');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.sql).toContain('"messages"."user_id" = "survey_group_states"."user_id"');
    expect(query.sql).toContain('"survey_group_states"."deidentification_decision"->>\'status\' = \'accepted\'');
    expect(query.sql).toContain('"messages"."metadata"->\'deidentificationDecision\'->>\'status\' = \'accepted\'');
    expect(query.sql).toContain('jsonb_array_length("survey_group_states"."deidentification_decision"->\'reasons\') = 0');
    expect(query.sql).toContain('jsonb_array_length("messages"."metadata"->\'deidentificationDecision\'->\'reasons\') = 0');
    expect(query.params).toContain('pending_confirmation');
  });

  it('transitions only a row that is still awaiting confirmation', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);

    await expect(repository.transitionAwaitingGroupState({
      surveyWindowId: 'window-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      confirmationPromptMessageId: 'outbound-a',
      status: 'pending_confirmation',
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending_confirmation' }));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ deidentificationDecision: null }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."tenant_id"');
    expect(query.sql).toContain('"survey_group_states"."user_id"');
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id"');
    expect(query.params).toContain('awaiting_confirmation');
    expect(query.params).toContain('outbound-a');
  });

  it('withdraws an awaiting confirmation only through exact delivered prompt and inbound reply', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);
    const withdrawnAt = new Date('2026-09-03T10:05:00.000Z');

    await expect(repository.withdrawGroupState({
      surveyWindowId: 'window-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      confirmationPromptMessageId: 'outbound-a',
      conversationId: 'conversation-1',
      withdrawalMessageId: 'inbound-1',
      withdrawnAt,
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'withdrawn',
      withdrawnAt,
      withdrawalMessageId: 'inbound-1',
      aiSummary: null,
      deidentificationDecision: null,
    }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"messages"."sent_at" <');
    expect(query.sql).toContain('"messages"."occurred_at"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.params).toContain('outbound-a');
    expect(query.params).toContain('inbound-1');
  });

  it('reopens a correction only when the exact inbound follows the expected delivered prompt', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);

    await expect(repository.transitionAwaitingGroupState({
      surveyWindowId: 'window-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      confirmationPromptMessageId: 'outbound-a',
      status: 'in_progress',
      conversationId: 'conversation-1',
      responseMessageId: 'inbound-1',
      responseOccurredAt: new Date('2026-09-03T10:05:00.000Z'),
    })).resolves.toBe(true);

    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"messages"."sent_at" <');
    expect(query.sql).toContain('"messages"."occurred_at"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.params).toContain('outbound-a');
    expect(query.params).toContain('inbound-1');
  });

  it('confirms only while the displayed summary still matches the interpreted summary', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'group-state-1' }]);
    const where = vi.fn((_value: unknown) => ({ returning }));
    const set = vi.fn((_value: unknown) => ({ where }));
    const update = vi.fn(() => ({ set }));
    const repository = new GroupStateRepository({ client: { update } } as never);
    const confirmedAt = new Date('2026-09-03T10:05:00.000Z');
    const shownAt = new Date('2026-09-03T10:00:00.000Z');

    await expect(repository.confirmGroupState({
      surveyWindowId: 'window-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      questionGroup: 'engagement',
      confirmationPromptMessageId: 'outbound-1',
      expectedConfirmationSummary: 'Summary A',
      employeeScore: 8,
      confirmedAt,
      reportingDisclosureVersion: 'reporting-disclosure-v1',
      reportingDisclosureShownAt: shownAt,
      confirmationMessageId: 'message-1',
      deidentificationDecision: acceptedDeidentificationDecision,
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'confirmed',
      reportingDisclosureShownAt: shownAt,
      confirmationMessageId: 'message-1',
      deidentificationDecision: acceptedDeidentificationDecision,
    }));
    const updateValues = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateValues['aiSummary']).toBe('Summary A');
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."tenant_id"');
    expect(query.sql).toContain('"survey_group_states"."user_id"');
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."occurred_at"');
    expect(query.sql).toContain('"messages"."sent_at"');
    expect(query.sql).toContain('"messages"."sent_at" <');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id"');
    expect(query.sql).toContain("'confirmationSummary'");
    expect(query.sql).toContain("'deidentificationDecision'");
    expect(query.params).toContain('awaiting_confirmation');
    expect(query.params).toContain('Summary A');
  });

  it.each([
    ['findPendingConfirmationGroups', 'pending_confirmation'],
    ['findAwaitingConfirmationGroups', 'awaiting_confirmation'],
  ] as const)('%s scopes the lookup by tenant and user', async (method, status) => {
    const db = createSelectDbMock();
    const repository = new GroupStateRepository(db as never);

    await (repository[method] as (...args: string[]) => Promise<unknown>)(
      'user-1',
      'tenant-1',
      ...(method === 'findAwaitingConfirmationGroups' ? ['conversation-1'] : []),
    );

    const query = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."user_id"');
    expect(query.sql).toContain('"survey_group_states"."tenant_id"');
    expect(query.params).toContain('user-1');
    expect(query.params).toContain('tenant-1');
    expect(query.params).toContain(status);
  });

  it('loads an awaiting summary only through its delivered scoped outbound receipt', async () => {
    const db = createSelectDbMock();
    const repository = new GroupStateRepository(db as never);

    await repository.findAwaitingConfirmationGroups('user-1', 'tenant-1', 'conversation-1');

    expect(db.calls.innerJoin).toHaveBeenCalled();
    const query = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain('"messages"."sent_at" is not null');
    expect(query.sql).toContain('"messages"."deleted_at" is null');
    expect(query.sql).toContain("'confirmationSummary'");
    expect(query.params).toContain('conversation-1');
  });

  it('does not offer another pending group while this user has a staged receipt', async () => {
    const db = createSelectDbMock();
    const repository = new GroupStateRepository(db as never);

    await repository.findPendingConfirmationGroups('user-1', 'tenant-1');

    const query = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('not exists');
    expect(query.sql).toContain('active.confirmation_prompt_message_id is not null');
    expect(query.sql).toContain("active.status in ('pending_confirmation', 'awaiting_confirmation')");
  });

  it('requires complete ordered disclosure proof before returning confirmed rows', async () => {
    const db = createSelectDbMock();
    const repository = new GroupStateRepository(db as never);

    await repository.findConfirmedGroupStates({
      reportingCohortId: 'cohort-1',
      tenantId: 'tenant-1',
      teamId: 'team-1',
      rosterUserIds: ['user-1'],
      questionGroup: 'engagement',
    });

    const query = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_windows"."reporting_cohort_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."team_id"');
    expect(query.sql).toContain('"survey_reporting_cohorts"."roster_user_ids"');
    expect(query.sql).toContain('report_user.tenant_id');
    expect(query.sql).toContain('report_user.deleted_at is null');
    expect(query.sql).toContain("report_user.consent_state->'surveyEnabled' = 'true'::jsonb");
    expect(query.sql).toContain('current_membership.team_id = "survey_reporting_cohorts"."team_id"');
    expect(query.sql).toContain('other_membership.team_id <> current_membership.team_id');
    expect(query.params).toContain('cohort-1');
    expect(query.sql).toContain('"survey_group_states"."confirmed_at" is not null');
    expect(query.sql).toContain('"survey_group_states"."confirmed_at" >= "survey_reporting_cohorts"."period_start"');
    expect(query.sql).toContain('"survey_group_states"."confirmed_at" < "survey_reporting_cohorts"."period_end"');
    expect(query.sql).toContain('"survey_group_states"."reporting_disclosure_version" is not null');
    expect(query.sql).toContain('btrim("survey_group_states"."reporting_disclosure_version") <>');
    expect(query.sql).toContain('"survey_group_states"."reporting_disclosure_shown_at" is not null');
    expect(query.sql).toContain('"survey_group_states"."confirmation_message_id" is not null');
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id" is not null');
    expect(query.sql).toContain('"survey_group_states"."withdrawn_at" is null');
    expect(query.sql).toContain('"survey_group_states"."ai_summary" is not null');
    expect(query.sql).toContain('"survey_group_states"."deidentification_decision"->>\'status\' = \'accepted\'');
    expect(query.sql).toContain('"survey_group_states"."deidentification_decision"->>\'policyVersion\'');
    expect(query.sql).toContain('jsonb_array_length("survey_group_states"."deidentification_decision"->\'reasons\') = 0');
    expect(query.sql).toContain('jsonb_array_length(displayed.metadata->\'deidentificationDecision\'->\'reasons\') = 0');
    expect(query.sql).toContain(
      '"survey_group_states"."reporting_disclosure_shown_at" < "survey_group_states"."confirmed_at"',
    );
    expect(query.params).toEqual(expect.arrayContaining([
      'tenant-1',
      'team-1',
      'user-1',
      'engagement',
      'confirmed',
      'deidentification-v1',
    ]));
  });

  it('maps malformed accepted de-identification decisions to null', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    const db = createSelectDbMock([{
      groupState: {
        id: 'group-state-1',
        surveyWindowId: 'window-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        questionGroup: 'engagement',
        status: 'awaiting_confirmation',
        aiSummary: null,
        employeeScore: null,
        personalRecs: null,
        deidentificationDecision: {
          status: 'accepted',
          policyVersion: 'deidentification-v1',
          reasons: ['known_identifier'],
        },
        confirmedAt: null,
        reportingDisclosureVersion: null,
        reportingDisclosureShownAt: null,
        confirmationMessageId: null,
        confirmationPromptMessageId: 'outbound-1',
        reportSentAt: null,
        createdAt: now,
        updatedAt: now,
      },
      confirmationSummary: 'Summary',
    }]);
    const repository = new GroupStateRepository(db as never);

    await expect(repository.findAwaitingConfirmationGroups('user-1', 'tenant-1', 'conversation-1'))
      .resolves.toEqual([
        expect.objectContaining({ deidentificationDecision: null }),
      ]);
  });


});
