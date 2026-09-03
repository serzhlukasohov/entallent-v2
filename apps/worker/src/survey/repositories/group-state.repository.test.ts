import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { GroupStateRepository } from './group-state.repository';

function createSelectDbMock(rows: unknown[] = []) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    client: { select },
    calls: { select, from, innerJoin, where },
  };
}

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

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
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      confirmationPromptMessageId: 'outbound-1',
      aiSummary: null,
    }));
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id" is null');
    expect(query.sql).toContain('"survey_group_states"."updated_at"');
    expect(query.sql).toContain('"messages"."conversation_id"');
    expect(query.sql).toContain("'confirmationSummary'");
    expect(query.sql).toContain("'outbound'");
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
    const query = compileSql(where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."tenant_id"');
    expect(query.sql).toContain('"survey_group_states"."user_id"');
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id"');
    expect(query.params).toContain('awaiting_confirmation');
    expect(query.params).toContain('outbound-a');
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
    })).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'confirmed',
      reportingDisclosureShownAt: shownAt,
      confirmationMessageId: 'message-1',
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

    await repository.findConfirmedGroupStates(['user-1'], 'engagement');

    const query = compileSql(db.calls.where.mock.calls[0]?.[0]);
    expect(query.sql).toContain('"survey_group_states"."confirmed_at" is not null');
    expect(query.sql).toContain('"survey_group_states"."reporting_disclosure_version" is not null');
    expect(query.sql).toContain('btrim("survey_group_states"."reporting_disclosure_version") <>');
    expect(query.sql).toContain('"survey_group_states"."reporting_disclosure_shown_at" is not null');
    expect(query.sql).toContain('"survey_group_states"."confirmation_message_id" is not null');
    expect(query.sql).toContain('"survey_group_states"."confirmation_prompt_message_id" is not null');
    expect(query.sql).toContain('"survey_group_states"."ai_summary" is not null');
    expect(query.sql).toContain(
      '"survey_group_states"."reporting_disclosure_shown_at" < "survey_group_states"."confirmed_at"',
    );
    expect(query.params).toEqual(['user-1', 'engagement', 'confirmed']);
  });


});
