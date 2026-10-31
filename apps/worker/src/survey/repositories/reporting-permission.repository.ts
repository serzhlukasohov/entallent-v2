import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { validateReportingWithdrawal, type ReportingPermissionRepositoryPort, type WithdrawReportingPermissionInput } from '@entalent/application';
import { lockPulseReportSubject, people, surveyQuestionConfirmationBundles, surveyQuestionWorkingInsights, surveyQuestionInsights, surveyReportInsightRevisions, surveyReportQuestionLineages, surveyReportingLineageExclusions, surveyReportingPermissions, surveyReportingWithdrawalRequests, surveyV2ReportSnapshots, withPulseReportSerializableRetry } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ReportingPermissionRepository implements ReportingPermissionRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  async withdraw(input: WithdrawReportingPermissionInput) {
    validateReportingWithdrawal(input);
    return withPulseReportSerializableRetry(() => this.db.client.transaction(async (tx) => {
      // READ COMMITTED is deliberate: a waiter must see revisions committed by the
      // preceding subject-lock holder, rather than a pre-wait SERIALIZABLE snapshot.
      await lockPulseReportSubject(tx, input.tenantId, input.userId);
      const [person] = await tx.select({ id: people.id }).from(people).where(and(eq(people.tenantId, input.tenantId), eq(people.id, input.personId)));
      if (!person || input.personId !== input.userId) throw new Error('reporting_rights_subject_mismatch');
      const lineageIds = input.target.kind === 'partial_reporting' ? [...input.target.lineageIds].sort() : [];
      const [existing] = await tx.select().from(surveyReportingWithdrawalRequests).where(and(eq(surveyReportingWithdrawalRequests.tenantId, input.tenantId), eq(surveyReportingWithdrawalRequests.requestId, input.requestId)));
      if (existing) {
        if (existing.userId !== input.userId || existing.personId !== input.personId || existing.targetKind !== input.target.kind
          || JSON.stringify(existing.lineageIds) !== JSON.stringify(lineageIds) || existing.provenanceKind !== input.provenance.kind
          || existing.verificationId !== input.provenance.verificationId || existing.receivedAt.getTime() !== input.provenance.receivedAt.getTime()) throw new Error('reporting_rights_idempotency_conflict');
        return { requestId: input.requestId, permissionRevision: existing.permissionRevision, replayed: true };
      }
      if (lineageIds.length) {
        const lineages = await tx.select({ id: surveyReportQuestionLineages.id }).from(surveyReportQuestionLineages).where(and(eq(surveyReportQuestionLineages.tenantId, input.tenantId), eq(surveyReportQuestionLineages.userId, input.userId), inArray(surveyReportQuestionLineages.id, lineageIds))).orderBy(surveyReportQuestionLineages.id);
        if (lineages.length !== lineageIds.length) throw new Error('reporting_rights_lineage_subject_mismatch');
      }
      const [permission] = await tx.select().from(surveyReportingPermissions).where(and(eq(surveyReportingPermissions.tenantId, input.tenantId), eq(surveyReportingPermissions.userId, input.userId))).for('update');
      const revision = (permission?.revision ?? 0) + 1;
      const fullDenied = permission?.fullReportingDenied || input.target.kind === 'full_reporting';
      const state = { revision, fullReportingDenied: fullDenied, deniedAt: permission?.deniedAt ?? (fullDenied ? input.provenance.receivedAt : null) };
      if (permission) await tx.update(surveyReportingPermissions).set(state).where(and(eq(surveyReportingPermissions.tenantId, input.tenantId), eq(surveyReportingPermissions.userId, input.userId)));
      else await tx.insert(surveyReportingPermissions).values({ tenantId: input.tenantId, userId: input.userId, ...state });
      await tx.insert(surveyReportingWithdrawalRequests).values({ tenantId: input.tenantId, userId: input.userId, personId: input.personId, requestId: input.requestId, targetKind: input.target.kind, lineageIds, provenanceKind: input.provenance.kind, verificationId: input.provenance.verificationId, receivedAt: input.provenance.receivedAt, permissionRevision: revision });
      if (lineageIds.length) await tx.insert(surveyReportingLineageExclusions).values(lineageIds.map((lineageId) => ({ tenantId: input.tenantId, userId: input.userId, lineageId, requestId: input.requestId, excludedAt: input.provenance.receivedAt }))).onConflictDoNothing();
      // Subject -> private working rows -> analytical revisions is the shared lock order.
      const working = await tx.execute(sql`select working.id, working.confirmation_bundle_id from survey_question_working_insights working
        join survey_windows cycle_window on cycle_window.id = working.survey_window_id and cycle_window.tenant_id = working.tenant_id and cycle_window.user_id = working.user_id
        left join survey_cycle_scoring_policies cycle on cycle.tenant_id = cycle_window.tenant_id and cycle.survey_definition_id = cycle_window.survey_definition_id and cycle.period_start = cycle_window.period_start and cycle.period_end = cycle_window.period_end
        left join survey_report_question_lineages lineage on lineage.tenant_id = working.tenant_id and lineage.user_id = working.user_id and lineage.cycle_scoring_policy_id = cycle.id and lineage.survey_question_id = working.survey_question_id and lineage.question_version = working.question_version
        where working.tenant_id = ${input.tenantId}::uuid and working.user_id = ${input.userId}::uuid
          and working.status in ('collecting', 'pending_confirmation', 'pending_clarification', 'confirmed')
          and ${input.target.kind === 'full_reporting' ? sql`true` : sql`lineage.id = any(ARRAY[${sql.join(lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}])`}
        order by working.id for update of working`) as unknown as { id: string; confirmation_bundle_id: string | null }[];
      if (working.length) await tx.update(surveyQuestionWorkingInsights).set({ status: 'no_data', readyForConfirmation: false,
        workingSummary: null, confirmedSemanticSummary: null, sourceMessageIds: [], purgedAt: new Date(), updatedAt: new Date(),
      }).where(inArray(surveyQuestionWorkingInsights.id, working.map((row) => row.id)));
      for (const bundleId of [...new Set(working.flatMap((row) => row.confirmation_bundle_id ? [row.confirmation_bundle_id] : []))].sort()) {
        const pending = await tx.select({ id: surveyQuestionWorkingInsights.id }).from(surveyQuestionWorkingInsights).where(and(
          eq(surveyQuestionWorkingInsights.tenantId, input.tenantId), eq(surveyQuestionWorkingInsights.userId, input.userId),
          eq(surveyQuestionWorkingInsights.confirmationBundleId, bundleId), inArray(surveyQuestionWorkingInsights.status, ['pending_confirmation', 'pending_clarification']),
        )).limit(1);
        // Reporting exclusion settles work; the original shown content and delivery identity retain their normal retention lifetime.
        if (!pending.length) await tx.update(surveyQuestionConfirmationBundles).set({ status: 'resolved' }).where(and(
          eq(surveyQuestionConfirmationBundles.id, bundleId), eq(surveyQuestionConfirmationBundles.tenantId, input.tenantId),
          eq(surveyQuestionConfirmationBundles.userId, input.userId), inArray(surveyQuestionConfirmationBundles.status, ['pending_delivery', 'awaiting_confirmation']),
        ));
      }
      // Lock analytical revisions in stable order, after the shared subject state. No private text is read.
      const affected = await tx.select({ id: surveyQuestionInsights.id }).from(surveyQuestionInsights)
        .leftJoin(surveyReportInsightRevisions, eq(surveyReportInsightRevisions.insightId, surveyQuestionInsights.id))
        .where(and(eq(surveyQuestionInsights.tenantId, input.tenantId), eq(surveyQuestionInsights.userId, input.userId),
          input.target.kind === 'partial_reporting' ? inArray(surveyReportInsightRevisions.lineageId, lineageIds) : undefined))
        .orderBy(surveyQuestionInsights.id);
      const affectedIds = affected.map((row) => row.id);
      if (affectedIds.length) {
        await tx.execute(sql`select id from survey_question_insights where tenant_id = ${input.tenantId}::uuid and id in (${sql.join(affectedIds.map((id) => sql`${id}::uuid`), sql`, `)}) order by id for update`);
        await tx.update(surveyQuestionInsights).set({ withdrawnAt: input.provenance.receivedAt }).where(and(eq(surveyQuestionInsights.tenantId, input.tenantId), inArray(surveyQuestionInsights.id, affectedIds), sql`${surveyQuestionInsights.withdrawnAt} is null`));
      }
      await tx.execute(sql`update pulse_backlog backlog set status='done',done_at=clock_timestamp(),updated_at=clock_timestamp()
        from survey_windows w join survey_report_window_bindings binding on binding.survey_window_id=w.id and binding.tenant_id=w.tenant_id
        join survey_report_question_lineages lineage on lineage.cycle_scoring_policy_id=binding.cycle_scoring_policy_id
          and lineage.tenant_id=w.tenant_id and lineage.user_id=w.user_id and lineage.answer_kind='numeric_1_10_integer'
        where backlog.survey_window_id=w.id and backlog.tenant_id=w.tenant_id and backlog.user_id=w.user_id
          and backlog.survey_question_id=lineage.survey_question_id
          and backlog.tenant_id=${input.tenantId}::uuid and backlog.user_id=${input.userId}::uuid and backlog.status in ('pending','active')
          and ${input.target.kind === 'full_reporting' ? sql`true` : sql`lineage.id = any(ARRAY[${sql.join(lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}])`}`);
      await tx.execute(sql`update survey_engagement_capture_events set status='withdrawn'
        where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid and status='accepted'
          and ${input.target.kind === 'full_reporting' ? sql`true` : sql`lineage_id = any(ARRAY[${sql.join(lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}])`}`);
      await tx.execute(sql`delete from survey_engagement_answer_revisions
        where tenant_id=${input.tenantId}::uuid and user_id=${input.userId}::uuid
          and ${input.target.kind === 'full_reporting' ? sql`true` : sql`lineage_id = any(ARRAY[${sql.join(lineageIds.map((id) => sql`${id}::uuid`), sql`, `)}])`}`);

      // Unknown/attempted and delivered publications retain payload, identity and reconciliation evidence.
      await tx.update(surveyV2ReportSnapshots).set({ status: 'cancelled', failureReason: 'reporting_permission_withdrawn', statusUpdatedAt: new Date() }).where(and(
        eq(surveyV2ReportSnapshots.tenantId, input.tenantId), eq(surveyV2ReportSnapshots.status, 'pending'),
        sql`${surveyV2ReportSnapshots.deliveryAttemptedAt} is null`, sql`${surveyV2ReportSnapshots.slackExternalMessageId} is null`,
        sql`coalesce(${surveyV2ReportSnapshots.failureReason}, '') <> 'delivery_unknown'`,
        input.target.kind === 'full_reporting'
          ? sql`(${input.userId}::uuid = any(${surveyV2ReportSnapshots.contributorUserIds}) or exists(select 1 from survey_reporting_cohorts cohort where cohort.id = ${surveyV2ReportSnapshots.reportingCohortId} and cohort.tenant_id = ${input.tenantId}::uuid and ${input.userId}::uuid = any(cohort.roster_user_ids)))`
          : (affectedIds.length ? sql`${surveyV2ReportSnapshots.sourceQuestionInsightIds} && ARRAY[${sql.join(affectedIds.map((id) => sql`${id}::uuid`), sql`, `)}]` : sql`false`),
      ));
      return { requestId: input.requestId, permissionRevision: revision, replayed: false };
    }, { isolationLevel: 'read committed' }));
  }
}
