import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SurveyEvidenceExtractionUseCase, GroupReportUseCase, PulseBacklogService } from '@entalent/application';
import type { OutboxPort, GroupConfirmationPayload } from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
import { GroupConfirmationProcessor } from './group-confirmation.processor';
import { GroupReportProcessor } from './group-report.processor';
import { SurveyRepository } from './repositories/survey.repository';
import { GroupStateRepository } from './repositories/group-state.repository';
import { TeamRepository } from './repositories/team.repository';
import { PulseBacklogRepository } from './repositories/pulse-backlog.repository';
import { ConversationRepository } from '../conversation/repositories/conversation.repository';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';
import { AiService } from '../conversation/ai.service';
import { DatabaseModule } from '../database/database.module';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SURVEY_EVIDENCE },
      { name: QUEUE_NAMES.GROUP_CONFIRMATION },
      { name: QUEUE_NAMES.GROUP_REPORT },
    ),
  ],
  providers: [
    AiService,
    ConversationRepository,
    WorkspaceConnectionRepository,
    GroupStateRepository,
    TeamRepository,
    SurveyRepository,
    PulseBacklogRepository,
    {
      provide: PulseBacklogService,
      useFactory: (backlogRepo: PulseBacklogRepository, surveyRepo: SurveyRepository) =>
        new PulseBacklogService(backlogRepo, surveyRepo),
      inject: [PulseBacklogRepository, SurveyRepository],
    },
    {
      provide: 'SurveyOutboxAdapter',
      useFactory: (queue: Queue<GroupConfirmationPayload>): OutboxPort => ({
        enqueueGroupConfirmation: async (p) => { await queue.add('confirm', p); },
        enqueueMessageSend: async () => {},
        enqueueMemoryExtraction: async () => {},
        enqueueFollowUpExecution: async () => {},
        enqueueSurveyEvidence: async () => {},
        enqueueGroupReport: async () => {},
      }),
      inject: [getQueueToken(QUEUE_NAMES.GROUP_CONFIRMATION)],
    },
    {
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (ai: AiService, convRepo: ConversationRepository, surveyRepo: SurveyRepository, outbox: OutboxPort) =>
        new SurveyEvidenceExtractionUseCase(ai, convRepo, surveyRepo, outbox),
      inject: [AiService, ConversationRepository, SurveyRepository, 'SurveyOutboxAdapter'],
    },
    {
      provide: GroupReportUseCase,
      useFactory: (surveyRepo: SurveyRepository, ai: AiService) =>
        new GroupReportUseCase(surveyRepo, ai),
      inject: [SurveyRepository, AiService],
    },
    SurveyEvidenceProcessor,
    GroupConfirmationProcessor,
    GroupReportProcessor,
  ],
  exports: [SurveyRepository, PulseBacklogService],
})
export class SurveyModule {}
