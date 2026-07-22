import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  users,
  surveyWindows,
  surveyAssessments,
  surveyQuestions,
  surveyGroupStates,
  pulseBacklog,
} from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DatabaseService } from '../database/database.service';

const GROUP_ORDER = ['autonomy', 'belonging', 'engagement', 'growth', 'purpose'];

export interface PulseQuestionRow {
  stableKey: string;
  title: string;
  assessmentStatus: string | null;
}

export interface PulseGroupRow {
  questionGroup: string;
  status: string | null;
  employeeScore: number | null;
  confirmedAt: string | null;
  questions: PulseQuestionRow[];
}

export interface PulseEmployeeRow {
  userId: string;
  displayName: string | null;
  groups: PulseGroupRow[];
  backlog: {
    doneCount: number;
    pendingCount: number;
    totalIgnoreCount: number;
    nextQuestion: { stableKey: string; group: string } | null;
  };
}

export interface PulseOverviewResponse {
  tenantId: string;
  generatedAt: string;
  allGroups: string[];
  employees: PulseEmployeeRow[];
}

@Controller('admin/pulse/overview')
@UseGuards(ApiKeyGuard)
export class PulseOverviewController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async getOverview(
    @Query('tenantId') tenantId: string,
  ): Promise<PulseOverviewResponse> {
    const teamUsers = await this.db.client
      .select({ id: users.id, displayName: users.preferredName })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), isNull(users.deletedAt)));

    if (!teamUsers.length) {
      return { tenantId, generatedAt: new Date().toISOString(), allGroups: GROUP_ORDER, employees: [] };
    }

    const [assessmentRows, groupStateRows, questionDefs, backlogRows] = await Promise.all([
      this.db.client
        .select({
          userId: surveyWindows.userId,
          questionId: surveyQuestions.id,
          stableKey: surveyQuestions.stableKey,
          title: surveyQuestions.title,
          questionGroup: surveyQuestions.questionGroup,
          assessmentStatus: surveyAssessments.status,
        })
        .from(surveyAssessments)
        .innerJoin(surveyWindows, eq(surveyAssessments.surveyWindowId, surveyWindows.id))
        .innerJoin(surveyQuestions, eq(surveyAssessments.surveyQuestionId, surveyQuestions.id))
        .where(and(eq(surveyWindows.tenantId, tenantId), eq(surveyWindows.status, 'active'))),

      this.db.client
        .select({
          userId: surveyGroupStates.userId,
          questionGroup: surveyGroupStates.questionGroup,
          status: surveyGroupStates.status,
          employeeScore: surveyGroupStates.employeeScore,
          confirmedAt: surveyGroupStates.confirmedAt,
        })
        .from(surveyGroupStates)
        .where(eq(surveyGroupStates.tenantId, tenantId)),

      this.db.client
        .select({
          id: surveyQuestions.id,
          stableKey: surveyQuestions.stableKey,
          title: surveyQuestions.title,
          questionGroup: surveyQuestions.questionGroup,
        })
        .from(surveyQuestions),

      // 4th query: backlog summary per user/window (scoped to active survey window)
      this.db.client
        .select({
          userId: pulseBacklog.userId,
          surveyWindowId: pulseBacklog.surveyWindowId,
          surveyQuestionId: pulseBacklog.surveyQuestionId,
          status: pulseBacklog.status,
          position: pulseBacklog.position,
          ignoreCount: pulseBacklog.ignoreCount,
          questionGroup: surveyQuestions.questionGroup,
          stableKey: surveyQuestions.stableKey,
        })
        .from(pulseBacklog)
        .innerJoin(surveyQuestions, eq(pulseBacklog.surveyQuestionId, surveyQuestions.id))
        .innerJoin(surveyWindows, eq(pulseBacklog.surveyWindowId, surveyWindows.id))
        .where(
          and(
            eq(pulseBacklog.tenantId, tenantId),
            eq(surveyWindows.status, 'active'),
          ),
        ),
    ]);

    // Index: userId → questionGroup → assessment status
    const assessmentIndex = new Map<string, Map<string, string>>();
    for (const row of assessmentRows) {
      if (!assessmentIndex.has(row.userId)) assessmentIndex.set(row.userId, new Map());
      assessmentIndex.get(row.userId)!.set(row.stableKey, row.assessmentStatus);
    }

    // Index: userId → questionGroup → group state
    const stateIndex = new Map<string, Map<string, typeof groupStateRows[0]>>();
    for (const row of groupStateRows) {
      if (!stateIndex.has(row.userId)) stateIndex.set(row.userId, new Map());
      stateIndex.get(row.userId)!.set(row.questionGroup, row);
    }

    // Backlog index: userId → summary
    const backlogIndex = new Map<string, {
      doneCount: number;
      pendingCount: number;
      totalIgnoreCount: number;
      nextQuestion: { stableKey: string; group: string } | null;
    }>();

    for (const u of teamUsers) {
      const userRows = backlogRows.filter((r) => r.userId === u.id);
      if (!userRows.length) {
        backlogIndex.set(u.id, { doneCount: 0, pendingCount: 0, totalIgnoreCount: 0, nextQuestion: null });
        continue;
      }
      const doneCount = userRows.filter((r) => r.status === 'done').length;
      const pendingRows = userRows.filter((r) => r.status === 'pending');
      const totalIgnoreCount = userRows.reduce((sum, r) => sum + r.ignoreCount, 0);
      const nextRow = pendingRows.sort((a, b) => a.position - b.position)[0] ?? null;
      backlogIndex.set(u.id, {
        doneCount,
        pendingCount: pendingRows.length,
        totalIgnoreCount,
        nextQuestion: nextRow
          ? { stableKey: nextRow.stableKey, group: nextRow.questionGroup }
          : null,
      });
    }

    // Questions per group (sorted by stableKey)
    const questionsByGroup = new Map<string, typeof questionDefs>();
    for (const q of questionDefs) {
      if (!q.questionGroup) continue;
      const existing = questionsByGroup.get(q.questionGroup) ?? [];
      existing.push(q);
      questionsByGroup.set(q.questionGroup, existing);
    }

    const employees: PulseEmployeeRow[] = teamUsers.map((u) => {
      const userAssessments = assessmentIndex.get(u.id) ?? new Map();
      const userStates = stateIndex.get(u.id) ?? new Map();

      const groups: PulseGroupRow[] = GROUP_ORDER.map((group) => {
        const state = userStates.get(group) ?? null;
        const qs = (questionsByGroup.get(group) ?? []).map((q) => ({
          stableKey: q.stableKey,
          title: q.title,
          assessmentStatus: userAssessments.get(q.stableKey) ?? null,
        }));

        return {
          questionGroup: group,
          status: state?.status ?? null,
          employeeScore: state?.employeeScore != null ? Number(state.employeeScore) : null,
          confirmedAt: state?.confirmedAt?.toISOString() ?? null,
          questions: qs,
        };
      });

      return {
        userId: u.id,
        displayName: u.displayName,
        groups,
        backlog: backlogIndex.get(u.id) ?? { doneCount: 0, pendingCount: 0, totalIgnoreCount: 0, nextQuestion: null },
      };
    });

    // Only show employees who have at least one assessment or group state
    const active = employees.filter(
      (e) =>
        e.groups.some((g) => g.status !== null || g.questions.some((q) => q.assessmentStatus !== null)),
    );

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      allGroups: GROUP_ORDER,
      employees: active,
    };
  }
}
