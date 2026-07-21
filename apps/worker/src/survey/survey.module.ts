import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SurveyEvidenceExtractionUseCase, GroupReportUseCase } from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
import { GroupConfirmationProcessor } from './group-confirmation.processor';
import { GroupReportProcessor } from './group-report.processor';
import { SurveyRepository } from './repositories/survey.repository';
import { GroupStateRepository } from './repositories/group-state.repository';
import { TeamRepository } from './repositories/team.repository';
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
    {
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (ai: AiService, convRepo: ConversationRepository, surveyRepo: SurveyRepository) =>
        new SurveyEvidenceExtractionUseCase(ai, convRepo, surveyRepo),
      inject: [AiService, ConversationRepository, SurveyRepository],
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
  exports: [SurveyRepository],
})
export class SurveyModule {}
