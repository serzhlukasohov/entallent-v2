import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { shouldRequeueStaleActiveEntry } from './pulse-backlog.repository';
import { buildFindNextPendingSql, PulseBacklogRepository } from './pulse-backlog.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

describe('PulseBacklogRepository', () => {
  it('prioritizes pending questions from the covered group ahead of other pending questions', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new PulseBacklogRepository({ client: { execute } } as never);

    await repository.prioritizeQuestionGroup('user-1', 'window-1', 'belonging');

    const query = compileSql(execute.mock.calls[0]?.[0]);
    expect(query.sql).toContain('row_number() over');
    expect(query.sql).toContain('"survey_questions"."question_group" = $1');
    expect(query.sql).toContain('"pulse_backlog"."status" = \'pending\'');
    expect(query.params).toEqual(['belonging', 'user-1', 'window-1']);
  });

  it('deprioritizes pending questions from a skipped group behind other pending questions', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new PulseBacklogRepository({ client: { execute } } as never);

    await repository.deprioritizeQuestionGroup('user-1', 'window-1', 'autonomy');

    const query = compileSql(execute.mock.calls[0]?.[0]);
    expect(query.sql).toContain('row_number() over');
    expect(query.sql).toContain('"survey_questions"."question_group" = $1');
    expect(query.sql).toContain('THEN 1 ELSE 0 END');
    expect(query.sql).toContain('"pulse_backlog"."status" = \'pending\'');
    expect(query.params).toEqual(['autonomy', 'user-1', 'window-1']);
  });

  it('excludes pending questions from groups that already have an active probe', () => {
    const query = compileSql(buildFindNextPendingSql('user-1', 'window-1', false));

    expect(query.sql).toContain('not exists');
    expect(query.sql).toContain("active_backlog.status = 'active'");
    expect(query.sql).toContain('active_question.question_group = survey_questions.question_group');
    expect(query.sql).toContain('"pulse_backlog"."status" = \'pending\'');
  });
});

describe('shouldRequeueStaleActiveEntry', () => {
  it('requeues stale active probes when the user never replied', () => {
    expect(shouldRequeueStaleActiveEntry(false, 0)).toBe(true);
  });

  it('requeues stale active probes when an inbound reply produced no survey evidence', () => {
    expect(shouldRequeueStaleActiveEntry(true, 0)).toBe(true);
  });

  it('keeps stale active probes active when an inbound reply produced evidence', () => {
    expect(shouldRequeueStaleActiveEntry(true, 1)).toBe(false);
  });
});
