import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SurveyEvidenceExtractionUseCase, GroupReportUseCase, PulseBacklogService } from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
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
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (
        ai: AiService,
        convRepo: ConversationRepository,
        surveyRepo: SurveyRepository,
        pulseBacklogService: PulseBacklogService,
      ) => new SurveyEvidenceExtractionUseCase(ai, convRepo, surveyRepo, pulseBacklogService),
      inject: [AiService, ConversationRepository, SurveyRepository, PulseBacklogService],
    },
    {
      provide: GroupReportUseCase,
      useFactory: (surveyRepo: SurveyRepository, ai: AiService) =>
        new GroupReportUseCase(surveyRepo, ai),
      inject: [SurveyRepository, AiService],
    },
    SurveyEvidenceProcessor,
    GroupReportProcessor,
  ],
  exports: [SurveyRepository, PulseBacklogService],
})
export class SurveyModule {}
