import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  conversations,
  llmRuns,
  memoryItems,
  messages,
  pulseBacklog,
  riskSignals,
  scheduledActions,
  surveyAssessments,
  surveyEvidence,
  surveyGroupStates,
  surveyWindows,
  userGoals,
  users,
  userStyleProfiles,
} from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface UserResetResult {
  conversations: number;
  messages: number;
  memoryItems: number;
  userGoals: number;
  scheduledActions: number;
  riskSignals: number;
  surveyWindows: number;
  surveyAssessments: number;
  surveyEvidence: number;
  surveyGroupStates: number;
  pulseBacklog: number;
  userStyleProfiles: number;
  llmRuns: number;
}

interface UserResetParams {
  tenantId: string;
  userId: string;
  deleteConversationHistory?: boolean;
}
type ResetRow = UserResetResult & { userFound: boolean };

@Injectable()
export class UserResetService {
  constructor(private readonly db: DatabaseService) {}

  async resetUser(params: UserResetParams): Promise<UserResetResult> {
    const deleteConversationHistory = params.deleteConversationHistory ?? true;
    const rows = await this.db.client.execute(sql`
      WITH target_user AS (
        SELECT id, tenant_id
        FROM ${users}
        WHERE ${users.id} = ${params.userId}
          AND ${users.tenantId} = ${params.tenantId}
        FOR UPDATE
      ), deleted_scheduled_actions AS (
        DELETE FROM ${scheduledActions} a USING target_user u
        WHERE a.user_id = u.id AND a.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_user_goals AS (
        DELETE FROM ${userGoals} g USING target_user u
        WHERE ${deleteConversationHistory}
          AND g.user_id = u.id
          AND g.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_memory_items AS (
        DELETE FROM ${memoryItems} m USING target_user u
        WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_risk_signals AS (
        DELETE FROM ${riskSignals} r USING target_user u
        WHERE ${deleteConversationHistory}
          AND r.user_id = u.id
          AND r.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_style_profiles AS (
        DELETE FROM ${userStyleProfiles} s USING target_user u
        WHERE ${deleteConversationHistory}
          AND s.user_id = u.id
          AND s.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_llm_runs AS (
        DELETE FROM ${llmRuns} l USING target_user u
        WHERE ${deleteConversationHistory}
          AND l.user_id = u.id
          AND l.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_pulse_backlog AS (
        DELETE FROM ${pulseBacklog} b USING target_user u
        WHERE b.user_id = u.id AND b.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_survey_evidence AS (
        DELETE FROM ${surveyEvidence} e USING ${surveyWindows} w, target_user u
        WHERE e.survey_window_id = w.id
          AND w.user_id = u.id
          AND w.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_survey_group_states AS (
        DELETE FROM ${surveyGroupStates} g USING target_user u
        WHERE g.user_id = u.id AND g.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_survey_assessments AS (
        DELETE FROM ${surveyAssessments} a USING ${surveyWindows} w, target_user u
        WHERE a.survey_window_id = w.id AND w.user_id = u.id AND w.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_survey_windows AS (
        DELETE FROM ${surveyWindows} w USING target_user u
        WHERE ${deleteConversationHistory}
          AND w.user_id = u.id
          AND w.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_messages AS (
        DELETE FROM ${messages} m USING target_user u
        WHERE ${deleteConversationHistory}
          AND m.user_id = u.id
          AND m.tenant_id = u.tenant_id
        RETURNING 1
      ), deleted_conversations AS (
        DELETE FROM ${conversations} c USING target_user u
        WHERE ${deleteConversationHistory}
          AND c.user_id = u.id
          AND c.tenant_id = u.tenant_id
        RETURNING 1
      )
      SELECT
        EXISTS(SELECT 1 FROM target_user) AS "userFound",
        (SELECT count(*)::int FROM deleted_conversations) AS "conversations",
        (SELECT count(*)::int FROM deleted_messages) AS "messages",
        (SELECT count(*)::int FROM deleted_memory_items) AS "memoryItems",
        (SELECT count(*)::int FROM deleted_user_goals) AS "userGoals",
        (SELECT count(*)::int FROM deleted_scheduled_actions) AS "scheduledActions",
        (SELECT count(*)::int FROM deleted_risk_signals) AS "riskSignals",
        (SELECT count(*)::int FROM deleted_survey_windows) AS "surveyWindows",
        (SELECT count(*)::int FROM deleted_survey_assessments) AS "surveyAssessments",
        (SELECT count(*)::int FROM deleted_survey_evidence) AS "surveyEvidence",
        (SELECT count(*)::int FROM deleted_survey_group_states) AS "surveyGroupStates",
        (SELECT count(*)::int FROM deleted_pulse_backlog) AS "pulseBacklog",
        (SELECT count(*)::int FROM deleted_style_profiles) AS "userStyleProfiles",
        (SELECT count(*)::int FROM deleted_llm_runs) AS "llmRuns"
    `) as unknown as ResetRow[];

    const row = rows[0];
    if (!row?.userFound) {
      throw new NotFoundException(`User ${params.userId} not found for tenant ${params.tenantId}`);
    }

    const { userFound, ...result } = row;
    void userFound;
    return result;
  }
}
