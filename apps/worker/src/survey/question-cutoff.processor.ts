import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  ExpireQuestionInsightsAtCutoffUseCase,
  RecoverConfirmedQuestionInsightsUseCase,
} from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { ConversationJob } from '../conversation/conversation.processor';
import { PulseReportProgressRepository } from './repositories/pulse-report-progress.repository';
import { SurveyRepository } from './repositories/survey.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import type { MessageSendJob } from '../message-send/message-send.processor';
import type {
  FollowUpExecutionPayload,
  GroupReportPayload,
  MemoryExtractionPayload,
  ProfileHydrationPayload,
  StyleAnalysisPayload,
  SurveyEvidencePayload,
} from '@entalent/application';

type ReceiptRetryJob = Pick<
  ConversationJob,
  'messageId' | 'tenantId' | 'userId' | 'conversationId'
>;

const CUTOFF_SCAN_INTERVAL_MS = 5 * 60 * 1000;
const CUTOFF_JOB_ID = 'v2-question-cutoff-recurring';

@Processor(QUEUE_NAMES.SURVEY_CUTOFF)
export class QuestionCutoffProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(QuestionCutoffProcessor.name);

  constructor(
    private readonly cutoff: ExpireQuestionInsightsAtCutoffUseCase,
    private readonly recovery: RecoverConfirmedQuestionInsightsUseCase,
    @InjectQueue(QUEUE_NAMES.SURVEY_CUTOFF) private readonly queue: Queue,
    private readonly surveyRepo: SurveyRepository,
    @InjectQueue(QUEUE_NAMES.CONVERSATION)
    private readonly conversationQueue: Queue<ConversationJob | ReceiptRetryJob>,
    @Optional() private readonly conversationRepo?: ConversationRepository,
    @Optional()
    @InjectQueue(QUEUE_NAMES.MESSAGE_SEND)
    private readonly messageSendQueue?: Queue<MessageSendJob>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.PROFILE_HYDRATION)
    private readonly profileHydrationQueue?: Queue<ProfileHydrationPayload>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.STYLE_ANALYSIS)
    private readonly styleAnalysisQueue?: Queue<StyleAnalysisPayload>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.MEMORY_EXTRACTION)
    private readonly memoryExtractionQueue?: Queue<MemoryExtractionPayload>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.SURVEY_EVIDENCE)
    private readonly surveyEvidenceQueue?: Queue<SurveyEvidencePayload>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.FOLLOWUP_EXECUTION)
    private readonly followUpQueue?: Queue<FollowUpExecutionPayload>,
    @Optional()
    @InjectQueue(QUEUE_NAMES.GROUP_REPORT)
    private readonly groupReportQueue?: Queue<GroupReportPayload>,
    @Optional() private readonly nativeProgress?: PulseReportProgressRepository,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'cutoff',
      {},
      {
        repeat: { every: CUTOFF_SCAN_INTERVAL_MS },
        jobId: CUTOFF_JOB_ID,
        removeOnComplete: true,
      },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'cutoff') throw new Error('v2_question_cutoff_job_invalid');
    let dispatchFailed = false;
    let manualRecoveryCount = 0;
    let unresolvedSendCount = 0;
    let recoveredSendCount = 0;
    const recoveryGeneration = Math.floor(Date.now() / CUTOFF_SCAN_INTERVAL_MS);
    try {
      // Separate lifecycle: readers never invoke this scanner or any queue/provider.
      if (this.nativeProgress)
        for (const row of await this.nativeProgress.recoveryBatch()) {
          const source = {
            tenantId: String(row.tenant_id),
            userId: String(row.user_id),
            conversationId: String(row.conversation_id),
            inboundMessageId: String(row.inbound_receipt_id),
          };
          if (row.failure_code || row.native_verdict === 'blocked') {
            await this.nativeProgress.reconcileOnly(source);
            continue;
          }
          if (
            row.finalization === 'pending' &&
            row.native_verdict === 'applied' &&
            !row.evidence_pending &&
            this.surveyEvidenceQueue
          ) {
            await this.enqueueNativeEvidence('finalize', {
              ...source,
              traceId: String(row.trace_id ?? 'native-finalization'),
              mode: 'finalize_only',
            });
          }
          if (row.committed && row.request_id && this.conversationRepo) {
            if (row.evidence_pending && this.surveyEvidenceQueue)
              await this.enqueueNativeEvidence('extract', {
                ...source,
                traceId: String(row.trace_id),
              });
            // Only a durably committed turn may resume dispatch without regeneration.
            if (row.native_verdict === 'pending' || row.native_verdict === 'claimed')
              await this.conversationQueue.add(
                'conversation',
                {
                  ...source,
                  messageId: source.inboundMessageId,
                  requestId: String(row.request_id),
                  eventId: String(row.event_id),
                  externalWorkspaceId: String(row.external_workspace_id),
                  externalConversationId: String(row.external_conversation_id),
                  traceId: String(row.trace_id),
                },
                { jobId: `native-resume-${source.inboundMessageId}-${recoveryGeneration}` },
              );
            else
              await this.conversationQueue.add(
                'receipt-retry',
                {
                  messageId: source.inboundMessageId,
                  tenantId: source.tenantId,
                  userId: source.userId,
                  conversationId: source.conversationId,
                },
                { jobId: `native-receipt-${source.inboundMessageId}-${recoveryGeneration}` },
              );
          } else if (!(row.finalization === 'pending' && row.native_verdict === 'applied')) {
            const original = await this.conversationQueue.getJob(
              `conversation-${source.inboundMessageId}`,
            );
            const owned =
              original?.data.messageId === source.inboundMessageId &&
              original?.data.tenantId === source.tenantId &&
              original?.data.userId === source.userId &&
              original?.data.conversationId === source.conversationId;
            const state = owned ? await original!.getState() : undefined;
            if (
              state !== 'active' &&
              state !== 'waiting' &&
              state !== 'delayed' &&
              state !== 'waiting-children'
            )
              await this.nativeProgress.reconcileOnly(source);
          }
        }
      if (this.conversationRepo && this.messageSendQueue) {
        const scanAt = new Date();
        let intentCursor: string | undefined;
        let intents: Awaited<ReturnType<ConversationRepository['findRecoverableMessageSends']>>;
        do {
          intents = await this.conversationRepo.findRecoverableMessageSends(scanAt, intentCursor);
          for (const intent of intents) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(intent.tenantId, intent.userId))
              )
                continue;
              await this.messageSendQueue.add(
                'send',
                {
                  messageId: intent.outboundMessageId,
                  tenantId: intent.tenantId,
                  conversationId: intent.conversationId,
                  channelType: intent.channelType,
                  externalWorkspaceId: intent.externalWorkspaceId,
                  externalChannelId: intent.externalConversationId,
                },
                {
                  jobId: `message-send-recovery-${intent.outboundMessageId}-${recoveryGeneration}`,
                },
              );
              await this.conversationRepo.markCommittedDispatchQueued({
                inboundMessageId: intent.inboundMessageId,
                tenantId: intent.tenantId,
                userId: intent.userId,
                conversationId: intent.conversationId,
                kind: 'message_send',
              });
              recoveredSendCount += 1;
            } catch {
              dispatchFailed = true;
            }
          }
          intentCursor = intents.at(-1)?.intentId;
        } while (intents.length === 100);
        unresolvedSendCount = await this.conversationRepo.countUnresolvedMessageSends(scanAt);
      }
      if (this.conversationRepo && this.followUpQueue) {
        let followUpCursor: string | undefined;
        let actions: Awaited<
          ReturnType<ConversationRepository['findRecoverableFollowUpExecutions']>
        >;
        do {
          actions = await this.conversationRepo.findRecoverableFollowUpExecutions(
            new Date(),
            followUpCursor,
          );
          for (const action of actions) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(action.tenantId, action.userId))
              )
                continue;
              const originalId = `follow-up-${action.actionId}-${action.dueAt.getTime()}`;
              const original = await this.followUpQueue.getJob(originalId);
              const originalState = await original?.getState();
              if (
                originalState === 'active' ||
                originalState === 'waiting' ||
                originalState === 'delayed' ||
                originalState === 'waiting-children'
              )
                continue;
              const recoveryId = `follow-up-recovery-${action.actionId}-${action.dueAt.getTime()}`;
              const recovery = await this.followUpQueue.getJob(recoveryId);
              const recoveryState = await recovery?.getState();
              if (
                recoveryState === 'active' ||
                recoveryState === 'waiting' ||
                recoveryState === 'delayed' ||
                recoveryState === 'waiting-children'
              )
                continue;
              await this.followUpQueue.add(
                'execute',
                {
                  scheduledActionId: action.actionId,
                  tenantId: action.tenantId,
                  userId: action.userId,
                  traceId: `recovery-${action.actionId}`,
                  dueAt: action.dueAt,
                },
                {
                  delay: Math.max(0, action.dueAt.getTime() - Date.now()),
                  jobId: original ? recoveryId : originalId,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
            } catch {
              dispatchFailed = true;
            }
          }
          followUpCursor = actions.at(-1)?.actionId;
        } while (actions.length === 100);
      }
      if (this.conversationRepo && this.groupReportQueue) {
        let reportCursor: string | undefined;
        let reports: Awaited<ReturnType<ConversationRepository['findRecoverableGroupReports']>>;
        do {
          reports = await this.conversationRepo.findRecoverableGroupReports(
            new Date(),
            reportCursor,
          );
          for (const report of reports) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(report.tenantId, report.userId))
              )
                continue;
              const original = await this.groupReportQueue.getJob(
                `group-report-${report.sourceGroupStateId}`,
              );
              const originalState = await original?.getState();
              if (
                originalState === 'active' ||
                originalState === 'waiting' ||
                originalState === 'delayed' ||
                originalState === 'waiting-children'
              )
                continue;
              const recoveryId = `group-report-recovery-${report.sourceGroupStateId}`;
              const recovery = await this.groupReportQueue.getJob(recoveryId);
              const recoveryState = await recovery?.getState();
              if (
                recoveryState === 'active' ||
                recoveryState === 'waiting' ||
                recoveryState === 'delayed' ||
                recoveryState === 'waiting-children'
              )
                continue;
              await this.groupReportQueue.add(
                'report',
                {
                  reportingCohortId: report.reportingCohortId,
                  tenantId: report.tenantId,
                  teamId: report.teamId,
                  questionGroup: report.questionGroup,
                  traceId: `group-report-recovery-${report.sourceGroupStateId}`,
                  sourceGroupStateId: report.sourceGroupStateId,
                },
                {
                  jobId: original ? recoveryId : `group-report-${report.sourceGroupStateId}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
            } catch {
              dispatchFailed = true;
            }
          }
          reportCursor = reports.at(-1)?.intentId;
        } while (reports.length === 100);
      }
      if (this.conversationRepo) {
        let dispatchCursor: string | undefined;
        let committed: Awaited<
          ReturnType<ConversationRepository['findCommittedAdmissionsWithUnqueuedDispatches']>
        >;
        do {
          committed =
            (await this.conversationRepo.findCommittedAdmissionsWithUnqueuedDispatches?.(
              new Date(),
              dispatchCursor,
            )) ?? [];
          for (const admission of committed) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(
                  admission.tenantId,
                  admission.userId,
                ))
              )
                continue;
              if (!(await this.requeueCommittedTurn(admission, recoveryGeneration)))
                manualRecoveryCount += 1;
            } catch {
              dispatchFailed = true;
            }
          }
          dispatchCursor = committed.at(-1)?.messageId;
        } while (committed.length === 100);
      }
      if (this.conversationRepo && this.profileHydrationQueue) {
        let profileCursor: string | undefined;
        let profiles: Awaited<
          ReturnType<ConversationRepository['findRecoverableProfileHydrations']>
        >;
        do {
          profiles = await this.conversationRepo.findRecoverableProfileHydrations(
            new Date(),
            profileCursor,
          );
          for (const profile of profiles) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(
                  profile.tenantId,
                  profile.userId,
                ))
              )
                continue;
              const original = await this.profileHydrationQueue.getJob(
                `profile-hydration-${profile.inboundMessageId}`,
              );
              const state = await original?.getState();
              if (
                state === 'active' ||
                state === 'waiting' ||
                state === 'delayed' ||
                state === 'waiting-children'
              )
                continue;
              await this.profileHydrationQueue.add(
                'hydrate',
                {
                  inboundMessageId: profile.inboundMessageId,
                  tenantId: profile.tenantId,
                  userId: profile.userId,
                  channelType: profile.channelType,
                  externalWorkspaceId: profile.externalWorkspaceId,
                  traceId: profile.traceId,
                },
                {
                  jobId: `profile-hydration-recovery-${profile.inboundMessageId}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
              await this.conversationRepo.markCommittedDispatchQueued({
                inboundMessageId: profile.inboundMessageId,
                tenantId: profile.tenantId,
                userId: profile.userId,
                conversationId: profile.conversationId,
                kind: 'profile_hydration',
              });
            } catch {
              dispatchFailed = true;
            }
          }
          profileCursor = profiles.at(-1)?.intentId;
        } while (profiles.length === 100);
      }
      if (this.conversationRepo && this.styleAnalysisQueue) {
        let styleCursor: string | undefined;
        let styles: Awaited<ReturnType<ConversationRepository['findRecoverableStyleAnalyses']>>;
        do {
          styles = await this.conversationRepo.findRecoverableStyleAnalyses(
            new Date(),
            styleCursor,
          );
          for (const style of styles) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(style.tenantId, style.userId))
              )
                continue;
              const original = await this.styleAnalysisQueue.getJob(
                `style-analysis-${style.inboundMessageId}`,
              );
              const state = await original?.getState();
              if (
                state === 'active' ||
                state === 'waiting' ||
                state === 'delayed' ||
                state === 'waiting-children'
              )
                continue;
              await this.styleAnalysisQueue.add(
                'analyze',
                {
                  inboundMessageId: style.inboundMessageId,
                  conversationId: style.conversationId,
                  tenantId: style.tenantId,
                  userId: style.userId,
                  traceId: style.traceId,
                },
                {
                  jobId: `style-analysis-recovery-${style.inboundMessageId}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
              await this.conversationRepo.markCommittedDispatchQueued({
                inboundMessageId: style.inboundMessageId,
                tenantId: style.tenantId,
                userId: style.userId,
                conversationId: style.conversationId,
                kind: 'style_analysis',
              });
            } catch {
              dispatchFailed = true;
            }
          }
          styleCursor = styles.at(-1)?.intentId;
        } while (styles.length === 100);
      }
      if (this.conversationRepo && this.memoryExtractionQueue) {
        let memoryCursor: string | undefined;
        let memories: Awaited<
          ReturnType<ConversationRepository['findRecoverableMemoryExtractions']>
        >;
        do {
          memories = await this.conversationRepo.findRecoverableMemoryExtractions(
            new Date(),
            memoryCursor,
          );
          for (const memory of memories) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(memory.tenantId, memory.userId))
              )
                continue;
              const original = await this.memoryExtractionQueue.getJob(
                `memory-extraction-${memory.inboundMessageId}`,
              );
              const state = await original?.getState();
              if (
                state === 'active' ||
                state === 'waiting' ||
                state === 'delayed' ||
                state === 'waiting-children'
              )
                continue;
              await this.memoryExtractionQueue.add(
                'extract',
                {
                  conversationId: memory.conversationId,
                  userId: memory.userId,
                  tenantId: memory.tenantId,
                  inboundMessageId: memory.inboundMessageId,
                  outboundMessageId: memory.outboundMessageId,
                  traceId: memory.traceId,
                  channelType: memory.channelType,
                  externalConversationId: memory.externalConversationId,
                },
                {
                  jobId: `memory-extraction-recovery-${memory.inboundMessageId}`,
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 1_000 },
                  removeOnComplete: true,
                  removeOnFail: true,
                },
              );
              await this.conversationRepo.markCommittedDispatchQueued({
                inboundMessageId: memory.inboundMessageId,
                tenantId: memory.tenantId,
                userId: memory.userId,
                conversationId: memory.conversationId,
                kind: 'memory_extraction',
              });
            } catch {
              dispatchFailed = true;
            }
          }
          memoryCursor = memories.at(-1)?.intentId;
        } while (memories.length === 100);
      }
      if (this.conversationRepo && this.surveyEvidenceQueue) {
        let evidenceCursor: string | undefined;
        let evidenceIntents: Awaited<
          ReturnType<ConversationRepository['findRecoverableSurveyEvidence']>
        >;
        do {
          evidenceIntents = await this.conversationRepo.findRecoverableSurveyEvidence(
            new Date(),
            evidenceCursor,
          );
          for (const evidence of evidenceIntents) {
            try {
              if (
                !(await this.conversationRepo.isUserRuntimeEligible(
                  evidence.tenantId,
                  evidence.userId,
                ))
              )
                continue;
              const original = await this.surveyEvidenceQueue.getJob(
                `survey-evidence-${evidence.inboundMessageId}`,
              );
              const state = await original?.getState();
              if (
                state === 'active' ||
                state === 'waiting' ||
                state === 'delayed' ||
                state === 'waiting-children'
              )
                continue;
              await this.enqueueNativeEvidence('evaluate', {
                conversationId: evidence.conversationId,
                userId: evidence.userId,
                tenantId: evidence.tenantId,
                inboundMessageId: evidence.inboundMessageId,
                traceId: evidence.traceId,
              });
              await this.conversationRepo.markCommittedDispatchQueued({
                inboundMessageId: evidence.inboundMessageId,
                tenantId: evidence.tenantId,
                userId: evidence.userId,
                conversationId: evidence.conversationId,
                kind: 'survey_evidence',
              });
            } catch {
              dispatchFailed = true;
            }
          }
          evidenceCursor = evidenceIntents.at(-1)?.intentId;
        } while (evidenceIntents.length === 100);
      }
      const pending = await this.surveyRepo.findUndispatchedTimelyQuestionReplies(new Date());
      for (const reply of pending) {
        try {
          await this.conversationQueue.add(
            'process',
            {
              ...reply,
              rapidMessageCoalescing: true,
            },
            { jobId: `conversation-${reply.messageId}` },
          );
          await this.surveyRepo.markQuestionReplyAdmissionQueued(reply.messageId, reply.tenantId);
        } catch {
          dispatchFailed = true;
        }
      }
      let queuedCursor: string | undefined;
      let queuedBatch: Awaited<
        ReturnType<SurveyRepository['findQueuedTimelyQuestionRepliesWithoutReceipt']>
      >;
      do {
        queuedBatch = await this.surveyRepo.findQueuedTimelyQuestionRepliesWithoutReceipt(
          new Date(),
          queuedCursor,
        );
        for (const reply of queuedBatch) {
          try {
            const original = await this.conversationQueue.getJob(`conversation-${reply.messageId}`);
            if (
              !original ||
              original.name !== 'process' ||
              original.data.messageId !== reply.messageId ||
              original.data.tenantId !== reply.tenantId ||
              original.data.userId !== reply.userId ||
              original.data.conversationId !== reply.conversationId
            ) {
              if (!(await this.requeueCommittedTurn(reply, recoveryGeneration)))
                manualRecoveryCount += 1;
              continue;
            }
            const state = await original.getState();
            if (state !== 'completed') {
              if (state === 'failed' || state === 'unknown') {
                if (!(await this.requeueCommittedTurn(reply, recoveryGeneration)))
                  manualRecoveryCount += 1;
              }
              continue;
            }
            await this.conversationQueue.add('receipt-retry', reply, {
              jobId: `receipt-${reply.messageId}`,
              attempts: 10,
              backoff: { type: 'exponential', delay: 1_000 },
            });
          } catch {
            dispatchFailed = true;
          }
        }
        queuedCursor = queuedBatch.at(-1)?.messageId;
      } while (queuedBatch.length === 100);
    } catch {
      dispatchFailed = true;
    }
    let cutoffFailed = false;
    let tenantsProcessed = 0;
    let expiredQuestionCount = 0;
    let overdueReplyCount = 0;
    try {
      const result = await this.cutoff.execute(new Date());
      tenantsProcessed = result.tenantsProcessed;
      expiredQuestionCount = result.expiredQuestionCount;
      overdueReplyCount = result.overdueReplyCount;
    } catch {
      cutoffFailed = true;
    }
    let recoveryFailed = false;
    let recovered = 0;
    try {
      // Native work is owned by the evidence queue; inline recovery only owns legacy windows.
      const result = await this.recovery.execute(this.nativeProgress ? { scope: 'legacy_only' } : undefined);
      recovered = result.finalizedQuestionCount;
      recoveryFailed = result.failedUserCount > 0;
    } catch {
      recoveryFailed = true;
    }
    if (overdueReplyCount > 0) {
      this.logger.warn(
        `Question cutoff deferred: overdue_reply_count=${overdueReplyCount} reason=conversation_processing_pending`,
      );
    }
    if (manualRecoveryCount > 0) {
      this.logger.error(
        `Question cutoff requires manual conversation reconciliation: count=${manualRecoveryCount}`,
      );
    }
    if (unresolvedSendCount > 0) {
      this.logger.error(
        `Outbound sends require delivery reconciliation: count=${unresolvedSendCount}`,
      );
    }
    if (cutoffFailed) throw new Error('v2_question_cutoff_failed');
    if (dispatchFailed) throw new Error('v2_question_reply_dispatch_failed');
    if (recoveryFailed) throw new Error('v2_question_recovery_failed');
    this.logger.log(
      `Question lifecycle completed: recovered=${recovered} sends_requeued=${recoveredSendCount} tenants=${tenantsProcessed} expired=${expiredQuestionCount}`,
    );
  }

  private async enqueueNativeEvidence(name: string, payload: SurveyEvidencePayload): Promise<void> {
    const queue = this.surveyEvidenceQueue!;
    const originalId = `survey-evidence-${payload.inboundMessageId}`;
    const evidenceRecoveryId = `survey-evidence-recovery-${payload.inboundMessageId}`;
    const finalizationId = `native-finalize-${payload.inboundMessageId}`;
    const recoveryId = payload.mode === 'finalize_only' ? finalizationId : evidenceRecoveryId;
    const owns = (job: Job<SurveyEvidencePayload>) =>
      job.data.inboundMessageId === payload.inboundMessageId &&
      job.data.tenantId === payload.tenantId &&
      job.data.userId === payload.userId &&
      job.data.conversationId === payload.conversationId;
    // Also recognize outstanding jobs created by the former generation-based recovery IDs.
    if (typeof queue.getJobs === 'function') {
      const pending = await queue.getJobs(['active', 'waiting', 'delayed', 'waiting-children']);
      if (pending.some(owns)) return;
    }
    let original: Job<SurveyEvidencePayload> | undefined;
    let recovery: Job<SurveyEvidencePayload> | undefined;
    for (const id of [originalId, evidenceRecoveryId, finalizationId]) {
      const job = await queue.getJob(id);
      if (!job) continue;
      if (!owns(job)) throw new Error('pulse_input_recovery_job_scope_mismatch');
      const state = await job.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'waiting-children'
      )
        return;
      if (id === originalId) original = job;
      if (id === recoveryId) recovery = job;
    }
    if (recovery) {
      const state = await recovery.getState();
      if (state === 'completed' || state === 'failed') {
        try {
          await recovery.retry(state);
        } catch (error) {
          const current = await recovery.getState();
          if (
            current !== 'active' &&
            current !== 'waiting' &&
            current !== 'delayed' &&
            current !== 'waiting-children'
          )
            throw error;
        }
        return;
      }
    }
    // Reusing the original ID when it is genuinely absent also fences a concurrent original enqueue.
    await queue.add(name, payload, {
      jobId: !original ? originalId : recoveryId,
      deduplication: { id: `survey-evidence-stage-${payload.inboundMessageId}` },
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  private async requeueCommittedTurn(reply: ReceiptRetryJob, generation: number): Promise<boolean> {
    const admission = await this.conversationRepo?.findCommittedAdmissionForRecovery(reply);
    if (!admission) return false;
    await this.conversationQueue.add(
      'process',
      {
        ...admission,
        rapidMessageCoalescing: true,
      },
      {
        jobId: `conversation-recovery-${reply.messageId}-${generation}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    );
    return true;
  }
}
