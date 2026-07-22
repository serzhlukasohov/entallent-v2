import { Injectable } from '@nestjs/common';
import { eq, and, lt, gt, asc, max, ne, sql } from 'drizzle-orm';
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
  ): Promise<void> {
    // Check if already initialized — any row for this user/window means it's done
    const [existing] = await this.db.client
      .select({ id: pulseBacklog.id })
      .from(pulseBacklog)
      .where(and(eq(pulseBacklog.userId, userId), eq(pulseBacklog.surveyWindowId, windowId)))
      .limit(1);

    if (existing) return;

    if (!questions.length) return;

    const values = questions.map((q, idx) => ({
      surveyWindowId: windowId,
      userId,
      tenantId,
      surveyQuestionId: q.id,
      position: idx + 1,
      status: coveredQuestionIds.has(q.id) ? 'done' : 'pending',
      doneAt: coveredQuestionIds.has(q.id) ? new Date() : null,
    }));

    await this.db.client.insert(pulseBacklog).values(values).onConflictDoNothing();
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

    // For each active entry, check if user sent ANY inbound message after the probe
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

      if (!inbound) toIgnore.push(entry);
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
  ): Promise<PulseBacklogRecord | null> {
    const groupFilter = engagementOnly
      ? eq(surveyQuestions.questionGroup, 'engagement')
      : ne(surveyQuestions.questionGroup, 'engagement');

    const rows = await this.db.client
      .select({
        id: pulseBacklog.id,
        surveyWindowId: pulseBacklog.surveyWindowId,
        userId: pulseBacklog.userId,
        tenantId: pulseBacklog.tenantId,
        surveyQuestionId: pulseBacklog.surveyQuestionId,
        position: pulseBacklog.position,
        status: pulseBacklog.status,
        ignoreCount: pulseBacklog.ignoreCount,
        proactiveSentAt: pulseBacklog.proactiveSentAt,
        evidenceCapturedCount: pulseBacklog.evidenceCapturedCount,
        resultedInCoverage: pulseBacklog.resultedInCoverage,
        doneAt: pulseBacklog.doneAt,
      })
      .from(pulseBacklog)
      .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
      .where(
        and(
          eq(pulseBacklog.userId, userId),
          eq(pulseBacklog.surveyWindowId, windowId),
          eq(pulseBacklog.status, 'pending'),
          groupFilter,
        ),
      )
      .orderBy(asc(pulseBacklog.position))
      .limit(1);

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
