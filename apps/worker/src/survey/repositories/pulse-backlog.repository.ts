import { Injectable } from '@nestjs/common';
import { eq, and, lt, lte, gt, max, ne, sql, inArray, type SQL } from 'drizzle-orm';
import {
  pulseBacklog,
  surveyQuestions,
  conversations,
  messages,
} from '@entalent/database';
import type {
  PulseBacklogRepositoryPort,
  PulseBacklogRecord,
  ResolvedIgnore,
  SurveyQuestionRecord,
} from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class PulseBacklogRepository implements PulseBacklogRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async initializeIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    questions: SurveyQuestionRecord[],
    coveredQuestionIds: Set<string>,
    coverageSnapshotAt: Date,
  ): Promise<void> {
    if (!questions.length) return;

    const now = new Date();
    const values = questions.map((q, idx) => ({
      surveyWindowId: windowId,
      userId,
      tenantId,
      surveyQuestionId: q.id,
      position: idx + 1,
      status: coveredQuestionIds.has(q.id) ? 'done' : 'pending',
      doneAt: coveredQuestionIds.has(q.id) ? now : null,
    }));

    await this.db.client.insert(pulseBacklog).values(values).onConflictDoNothing();

    const uncoveredQuestionIds = questions
      .filter((question) => !coveredQuestionIds.has(question.id))
      .map((question) => question.id);
    if (!uncoveredQuestionIds.length) return;

    await this.db.client
      .update(pulseBacklog)
      .set({
        status: 'pending',
        evidenceCapturedCount: 0,
        proactiveSentAt: null,
        resultedInCoverage: null,
        doneAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.tenantId, tenantId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.status, 'done'),
          inArray(pulseBacklog.surveyQuestionId, uncoveredQuestionIds),
          lte(pulseBacklog.updatedAt, coverageSnapshotAt),
        ),
      );
  }

  async resolveIgnoredEntries(
    userId: string,
    windowId: string,
    ignoreAfterHours: number,
  ): Promise<ResolvedIgnore[]> {
    const cutoff = new Date(Date.now() - ignoreAfterHours * 3_600_000);

    const activeEntries = await this.db.client
      .select()
      .from(pulseBacklog)
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.status, 'active'),
          lt(pulseBacklog.proactiveSentAt, cutoff),
        ),
      );

    if (!activeEntries.length) return [];

    // Requeue stale probes that either got no response or got no usable survey evidence.
    const toIgnore: typeof activeEntries = [];
    for (const entry of activeEntries) {
      const [inbound] = await this.db.client
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(messages.direction, 'inbound'),
            gt(messages.occurredAt, entry.proactiveSentAt!),
          ),
        )
        .limit(1);

      if (shouldRequeueStaleActiveEntry(Boolean(inbound), entry.evidenceCapturedCount)) {
        toIgnore.push(entry);
      }
    }

    if (!toIgnore.length) return [];

    // Find current max position to place ignored entries at the end
    const [{ maxPos }] = await this.db.client
      .select({ maxPos: max(pulseBacklog.position) })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

    let nextPos = (maxPos ?? 0) + 1;
    const resolved: ResolvedIgnore[] = [];

    for (const entry of toIgnore) {
      const newIgnoreCount = entry.ignoreCount + 1;
      await this.db.client
        .update(pulseBacklog)
        .set({
          status: 'pending',
          position: nextPos,
          ignoreCount: newIgnoreCount,
          resultedInCoverage: null,
          updatedAt: new Date(),
        })
        .where(eq(pulseBacklog.id, entry.id));

      resolved.push({
        questionId: entry.surveyQuestionId,
        newPosition: nextPos,
        ignoreCount: newIgnoreCount,
      });
      nextPos++;
    }

    return resolved;
  }

  async findNextPending(
    userId: string,
    windowId: string,
    engagementOnly: boolean,
    questionGroup?: string,
  ): Promise<PulseBacklogRecord | null> {
    const rows = (await this.db.client.execute(
      buildFindNextPendingSql(userId, windowId, engagementOnly, questionGroup),
    )) as unknown as PulseBacklogRecord[];

    if (!rows.length) return null;
    return rows[0] as PulseBacklogRecord;
  }

  async markActive(
    userId: string,
    windowId: string,
    questionId: string,
    sentAt: Date,
  ): Promise<void> {
    await this.db.client
      .update(pulseBacklog)
      .set({ status: 'active', proactiveSentAt: sentAt, updatedAt: new Date() })
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.surveyQuestionId, questionId),
          eq(pulseBacklog.status, 'pending'),
        ),
      );
  }

  async markDone(
    userId: string,
    windowId: string,
    questionId: string,
    evidenceCapturedCount: number,
  ): Promise<void> {
    await this.db.client
      .update(pulseBacklog)
      .set({
        status: 'done',
        evidenceCapturedCount,
        // Only set resulted_in_coverage=true if a probe was actually sent
        resultedInCoverage: sql`CASE WHEN proactive_sent_at IS NOT NULL THEN true ELSE NULL END`,
        doneAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.surveyQuestionId, questionId),
          ne(pulseBacklog.status, 'done'), // idempotent — don't overwrite already-done entries
        ),
      );
  }

  async prioritizeQuestionGroup(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<void> {
    await this.db.client.execute(sql`
      WITH ranked AS (
        SELECT
          ${pulseBacklog.id} AS id,
          row_number() over (
            ORDER BY
              CASE WHEN ${surveyQuestions.questionGroup} = ${questionGroup} THEN 0 ELSE 1 END,
              ${pulseBacklog.position}
          ) AS new_position
        FROM ${pulseBacklog}
        INNER JOIN ${surveyQuestions}
          ON ${pulseBacklog.surveyQuestionId} = ${surveyQuestions.id}
        WHERE
          ${pulseBacklog.userId} = ${userId}
          AND ${pulseBacklog.surveyWindowId} = ${windowId}
          AND ${pulseBacklog.status} = 'pending'
      )
      UPDATE ${pulseBacklog}
      SET position = ranked.new_position::integer, updated_at = now()
      FROM ranked
      WHERE ${pulseBacklog.id} = ranked.id
    `);
  }

  async deprioritizeQuestionGroup(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<void> {
    await this.db.client.execute(sql`
      WITH ranked AS (
        SELECT
          ${pulseBacklog.id} AS id,
          row_number() over (
            ORDER BY
              CASE WHEN ${surveyQuestions.questionGroup} = ${questionGroup} THEN 1 ELSE 0 END,
              ${pulseBacklog.position}
          ) AS new_position
        FROM ${pulseBacklog}
        INNER JOIN ${surveyQuestions}
          ON ${pulseBacklog.surveyQuestionId} = ${surveyQuestions.id}
        WHERE
          ${pulseBacklog.userId} = ${userId}
          AND ${pulseBacklog.surveyWindowId} = ${windowId}
          AND ${pulseBacklog.status} = 'pending'
      )
      UPDATE ${pulseBacklog}
      SET position = ranked.new_position::integer, updated_at = now()
      FROM ranked
      WHERE ${pulseBacklog.id} = ranked.id
    `);
  }

  async unlockEngagementIfNeeded(
    userId: string,
    tenantId: string,
    windowId: string,
    engagementQuestions: SurveyQuestionRecord[],
  ): Promise<void> {
    if (!engagementQuestions.length) return;

    const [{ maxPos }] = await this.db.client
      .select({ maxPos: max(pulseBacklog.position) })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)));

    let nextPos = (maxPos ?? 0) + 1;

    const sorted = [...engagementQuestions].sort((a, b) => a.displayOrder - b.displayOrder);
    for (const q of sorted) {
      await this.db.client
        .insert(pulseBacklog)
        .values({
          surveyWindowId: windowId,
          userId,
          tenantId,
          surveyQuestionId: q.id,
          position: nextPos++,
          status: 'pending',
        })
        .onConflictDoNothing(); // UNIQUE constraint prevents duplicates — idempotent
    }
  }
}

export function shouldRequeueStaleActiveEntry(
  hasInboundAfterProbe: boolean,
  evidenceCapturedCount: number,
): boolean {
  return !hasInboundAfterProbe || evidenceCapturedCount <= 0;
}

export function buildFindNextPendingSql(
  userId: string,
  windowId: string,
  engagementOnly: boolean,
  questionGroup?: string,
): SQL {
  const groupFilter = questionGroup
    ? sql`${surveyQuestions.questionGroup} = ${questionGroup}`
    : engagementOnly
    ? sql`${surveyQuestions.questionGroup} = 'engagement'`
    : sql`${surveyQuestions.questionGroup} <> 'engagement'`;

  return sql`
    select
      ${pulseBacklog.id} as "id",
      ${pulseBacklog.surveyWindowId} as "surveyWindowId",
      ${pulseBacklog.userId} as "userId",
      ${pulseBacklog.tenantId} as "tenantId",
      ${pulseBacklog.surveyQuestionId} as "surveyQuestionId",
      ${pulseBacklog.position} as "position",
      ${pulseBacklog.status} as "status",
      ${pulseBacklog.ignoreCount} as "ignoreCount",
      ${pulseBacklog.proactiveSentAt} as "proactiveSentAt",
      ${pulseBacklog.evidenceCapturedCount} as "evidenceCapturedCount",
      ${pulseBacklog.resultedInCoverage} as "resultedInCoverage",
      ${pulseBacklog.doneAt} as "doneAt"
    from ${pulseBacklog}
    inner join ${surveyQuestions}
      on ${pulseBacklog.surveyQuestionId} = ${surveyQuestions.id}
    where ${pulseBacklog.userId} = ${userId}
      and ${pulseBacklog.surveyWindowId} = ${windowId}
      and ${pulseBacklog.status} = 'pending'
      and ${groupFilter}
      and not exists (
        select 1
        from pulse_backlog active_backlog
        inner join survey_questions active_question
          on active_backlog.survey_question_id = active_question.id
        where active_backlog.user_id = ${userId}
          and active_backlog.survey_window_id = ${windowId}
          and active_backlog.status = 'active'
          and active_question.question_group = survey_questions.question_group
      )
    order by ${pulseBacklog.position} asc, ${surveyQuestions.displayOrder} asc
    limit 1
  `;
}
