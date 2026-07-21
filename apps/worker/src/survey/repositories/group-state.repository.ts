import { Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { surveyGroupStates } from '@entalent/database';
import type { SurveyGroupStateRecord, UpsertGroupStateParams } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class GroupStateRepository {
  constructor(private readonly db: DatabaseService) {}

  async findGroupState(
    userId: string,
    windowId: string,
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord | null> {
    const [row] = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          eq(surveyGroupStates.userId, userId),
          eq(surveyGroupStates.surveyWindowId, windowId),
          eq(surveyGroupStates.questionGroup, questionGroup),
        ),
      )
      .limit(1);
    return row ? mapGroupState(row) : null;
  }

  async findPendingConfirmationGroups(userId: string): Promise<SurveyGroupStateRecord[]> {
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          eq(surveyGroupStates.userId, userId),
          eq(surveyGroupStates.status, 'pending_confirmation'),
        ),
      );
    return rows.map(mapGroupState);
  }

  async upsertGroupState(params: UpsertGroupStateParams): Promise<SurveyGroupStateRecord> {
    const [row] = await this.db.client
      .insert(surveyGroupStates)
      .values({
        surveyWindowId: params.surveyWindowId,
        userId: params.userId,
        tenantId: params.tenantId,
        questionGroup: params.questionGroup,
        status: params.status,
        aiSummary: params.aiSummary,
        employeeScore: params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
        personalRecs: params.personalRecs as never,
        confirmedAt: params.confirmedAt,
        reportSentAt: params.reportSentAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          surveyGroupStates.surveyWindowId,
          surveyGroupStates.userId,
          surveyGroupStates.questionGroup,
        ],
        set: {
          status: params.status,
          aiSummary: params.aiSummary,
          employeeScore:
            params.employeeScore !== undefined ? String(params.employeeScore) : undefined,
          personalRecs: params.personalRecs as never,
          confirmedAt: params.confirmedAt,
          reportSentAt: params.reportSentAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    return mapGroupState(row);
  }

  async findConfirmedGroupStates(
    userIds: string[],
    questionGroup: string,
  ): Promise<SurveyGroupStateRecord[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db.client
      .select()
      .from(surveyGroupStates)
      .where(
        and(
          inArray(surveyGroupStates.userId, userIds),
          eq(surveyGroupStates.questionGroup, questionGroup),
          eq(surveyGroupStates.status, 'confirmed'),
        ),
      );
    return rows.map(mapGroupState);
  }
}

function mapGroupState(row: typeof surveyGroupStates.$inferSelect): SurveyGroupStateRecord {
  return {
    id: row.id,
    surveyWindowId: row.surveyWindowId,
    userId: row.userId,
    tenantId: row.tenantId,
    questionGroup: row.questionGroup,
    status: row.status,
    aiSummary: row.aiSummary,
    employeeScore: row.employeeScore !== null ? Number(row.employeeScore) : null,
    personalRecs: row.personalRecs,
    confirmedAt: row.confirmedAt,
    reportSentAt: row.reportSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
