import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { OutboxPort, MessageSendPayload, MemoryExtractionPayload, FollowUpExecutionPayload, SurveyEvidencePayload, GroupConfirmationPayload, GroupReportPayload } from '@entalent/application';
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
    @InjectQueue(QUEUE_NAMES.GROUP_CONFIRMATION)
    private readonly groupConfirmationQueue: Queue<GroupConfirmationPayload>,
    @InjectQueue(QUEUE_NAMES.GROUP_REPORT)
    private readonly groupReportQueue: Queue<GroupReportPayload>,
  ) {}

  async enqueueMessageSend(payload: MessageSendPayload): Promise<void> {
    await this.messageSendQueue.add('send', {
      messageId: payload.messageId,
      tenantId: payload.tenantId,
      conversationId: payload.conversationId,
      channelType: payload.channelType,
      externalWorkspaceId: payload.externalWorkspaceId,
      externalChannelId: payload.externalChannelId,
      text: payload.text,
      replyToExternalThreadId: payload.replyToExternalThreadId,
    });
  }

  async enqueueMemoryExtraction(payload: MemoryExtractionPayload): Promise<void> {
    await this.memoryExtractionQueue.add('extract', payload);
  }

  async enqueueFollowUpExecution(payload: FollowUpExecutionPayload): Promise<void> {
    const delayMs = Math.max(0, payload.dueAt.getTime() - Date.now());
    await this.followUpQueue.add('execute', payload, { delay: delayMs });
  }

  async enqueueSurveyEvidence(payload: SurveyEvidencePayload): Promise<void> {
    await this.surveyEvidenceQueue.add('evaluate', payload);
  }

  async enqueueGroupConfirmation(payload: GroupConfirmationPayload): Promise<void> {
    await this.groupConfirmationQueue.add('confirm', payload);
  }

  async enqueueGroupReport(payload: GroupReportPayload): Promise<void> {
    await this.groupReportQueue.add('report', payload);
  }
}
