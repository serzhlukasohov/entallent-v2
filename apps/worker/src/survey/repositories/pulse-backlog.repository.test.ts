import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { SurveyQuestionRecord } from '@entalent/application';
import {
  buildFindNextPendingSql,
  PulseBacklogRepository,
  shouldRequeueStaleActiveEntry,
} from './pulse-backlog.repository';

function compileSql(value: unknown) {
  return new PgDialect().sqlToQuery(value as SQL);
}

function makeQuestion(id: string): SurveyQuestionRecord {
  return {
    id,
    surveyDefinitionId: 'definition-1',
    stableKey: id,
    title: id,
    canonicalMeaning: id,
    dimension: 'engagement',
    questionGroup: 'autonomy',
    displayOrder: 1,
    positiveIndicators: [],
    negativeIndicators: [],
    probeStrategies: [],
    contraindications: [],
    confidenceThreshold: 0.72,
    completenessThreshold: 0.65,
    minimumEvidenceCount: 2,
    cooldownDays: 14,
    maxFollowUpProbes: 3,
    responseType: 'open_ended',
    version: '1',
  };
}

function createDbMock() {
  const limit = vi.fn().mockResolvedValue([{ id: 'existing-row' }]);
  const selectWhere = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where: selectWhere }));
  const from = vi.fn(() => ({ where: selectWhere, innerJoin }));
  const select = vi.fn(() => ({ from }));
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const updateWhere = vi.fn((_condition: SQL) => Promise.resolve());
  const set = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    client: { select, insert, update },
    calls: { values, onConflictDoNothing, update, set, updateWhere },
  };
}

describe('PulseBacklogRepository', () => {
  it('inserts missing rows and reopens only supplied uncovered done rows', async () => {
    const db = createDbMock();
    const repository = new PulseBacklogRepository(db as never);
    const coverageSnapshotAt = new Date('2026-08-30T12:00:00.000Z');

    await repository.initializeIfNeeded(
      'user-1',
      'tenant-1',
      'window-1',
      [makeQuestion('q-uncovered'), makeQuestion('q-covered')],
      new Set(['q-covered']),
      coverageSnapshotAt,
    );

    expect(db.calls.values).toHaveBeenCalledWith([
      expect.objectContaining({
        surveyQuestionId: 'q-uncovered',
        position: 1,
        status: 'pending',
        doneAt: null,
      }),
      expect.objectContaining({
        surveyQuestionId: 'q-covered',
        position: 2,
        status: 'done',
        doneAt: expect.any(Date),
      }),
    ]);
    expect(db.calls.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.calls.set).toHaveBeenCalledWith({
      status: 'pending',
      evidenceCapturedCount: 0,
      proactiveSentAt: null,
      resultedInCoverage: null,
      doneAt: null,
      updatedAt: expect.any(Date),
    });

    const query = compileSql(db.calls.updateWhere.mock.calls[0]![0]);
    expect(query.sql).toContain('"pulse_backlog"."status" = $4');
    expect(query.sql).toContain('"pulse_backlog"."updated_at" <= $6');
    expect(query.params).toEqual([
      'user-1',
      'tenant-1',
      'window-1',
      'done',
      'q-uncovered',
      '2026-08-30T12:00:00.000Z',
    ]);
  });

  it('does not issue a reconciliation update when every supplied question is covered', async () => {
    const db = createDbMock();
    const repository = new PulseBacklogRepository(db as never);

    await repository.initializeIfNeeded(
      'user-1',
      'tenant-1',
      'window-1',
      [makeQuestion('q-covered')],
      new Set(['q-covered']),
      new Date('2026-08-30T12:00:00.000Z'),
    );

    expect(db.calls.onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.calls.update).not.toHaveBeenCalled();
  });

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
    expect(query.sql).toContain('"survey_questions"."display_order" asc');
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
