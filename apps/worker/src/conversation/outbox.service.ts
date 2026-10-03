import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { OutboxPort, MessageSendPayload, MemoryExtractionPayload, FollowUpExecutionPayload, SurveyEvidencePayload, GroupReportPayload, StyleAnalysisPayload, ProfileHydrationPayload } from '@entalent/application';
import { QUEUE_NAMES } from '../queue/queue.module';
import type { MessageSendJob } from '../message-send/message-send.processor';

@Injectable()
export class OutboxService implements OutboxPort {
  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGE_SEND) private readonly messageSendQueue: Queue<MessageSendJob>,
    @InjectQueue(QUEUE_NAMES.MEMORY_EXTRACTION)
    private readonly memoryExtractionQueue: Queue<MemoryExtractionPayload>,
    @InjectQueue(QUEUE_NAMES.FOLLOWUP_EXECUTION)
    private readonly followUpQueue: Queue<FollowUpExecutionPayload>,
    @InjectQueue(QUEUE_NAMES.SURVEY_EVIDENCE)
    private readonly surveyEvidenceQueue: Queue<SurveyEvidencePayload>,
    @InjectQueue(QUEUE_NAMES.GROUP_REPORT)
    private readonly groupReportQueue: Queue<GroupReportPayload>,
    @InjectQueue(QUEUE_NAMES.STYLE_ANALYSIS)
    private readonly styleAnalysisQueue: Queue<StyleAnalysisPayload>,
    @InjectQueue(QUEUE_NAMES.PROFILE_HYDRATION)
    private readonly profileHydrationQueue: Queue<ProfileHydrationPayload>,
  ) {}

  async enqueueMessageSend(payload: MessageSendPayload): Promise<void> {
    await this.messageSendQueue.add('send', {
      messageId: payload.messageId,
      tenantId: payload.tenantId,
      conversationId: payload.conversationId,
      channelType: payload.channelType,
      externalWorkspaceId: payload.externalWorkspaceId,
      externalChannelId: payload.externalChannelId,
      replyToExternalThreadId: payload.replyToExternalThreadId,
    }, { jobId: `message-send-${payload.messageId}` });
  }

  async enqueueMemoryExtraction(payload: MemoryExtractionPayload): Promise<void> {
    await this.memoryExtractionQueue.add('extract', payload, {
      jobId: `memory-extraction-${payload.inboundMessageId}`,
    });
  }

  async enqueueFollowUpExecution(payload: FollowUpExecutionPayload): Promise<void> {
    const delayMs = Math.max(0, payload.dueAt.getTime() - Date.now());
    await this.followUpQueue.add('execute', payload, {
      delay: delayMs,
      jobId: `follow-up-${payload.scheduledActionId}-${payload.dueAt.getTime()}`,
    });
  }

  async enqueueSurveyEvidence(payload: SurveyEvidencePayload): Promise<void> {
    await this.surveyEvidenceQueue.add('evaluate', payload, {
      jobId: `survey-evidence-${payload.inboundMessageId}`,
    });
  }

  async enqueueGroupReport(payload: GroupReportPayload): Promise<void> {
    await this.groupReportQueue.add('report', payload,
      payload.sourceGroupStateId ? { jobId: `group-report-${payload.sourceGroupStateId}` } : {});
  }

  async enqueueStyleAnalysis(payload: StyleAnalysisPayload): Promise<void> {
    await this.styleAnalysisQueue.add('analyze', payload,
      payload.inboundMessageId ? { jobId: `style-analysis-${payload.inboundMessageId}` } : {});
  }

  async enqueueProfileHydration(payload: ProfileHydrationPayload): Promise<void> {
    await this.profileHydrationQueue.add('hydrate', payload,
      payload.inboundMessageId ? { jobId: `profile-hydration-${payload.inboundMessageId}` } : {});
  }
}
