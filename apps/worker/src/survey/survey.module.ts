import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  GroupReportUseCase,
  FinalizeQuestionInsightUseCase,
  RecoverConfirmedQuestionInsightsUseCase,
  OpenSurveyReportingCycleUseCase,
  ExpireQuestionInsightsAtCutoffUseCase,
  PulseBacklogService,
  SurveyEvidenceExtractionUseCase,
} from '@entalent/application';
import { SurveyEvidenceProcessor } from './survey-evidence.processor';
import { GroupReportProcessor } from './group-report.processor';
import { SurveyRepository } from './repositories/survey.repository';
import { GroupStateRepository } from './repositories/group-state.repository';
import { TeamRepository } from './repositories/team.repository';
import { PulseBacklogRepository } from './repositories/pulse-backlog.repository';
import { GroupReportSnapshotRepository } from './repositories/group-report-snapshot.repository';
import { V2ReportSnapshotRepository } from './repositories/v2-report-snapshot.repository';
import { V2CohortReportInputRepository } from './repositories/v2-cohort-report-input.repository';
import { V2ReportProcessor } from './v2-report.processor';
import { QuestionInsightRepository } from './repositories/question-insight.repository';
import { QuestionCutoffProcessor } from './question-cutoff.processor';
import { SurveyEvidenceIntentRepository } from './repositories/survey-evidence-intent.repository';
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
      { name: QUEUE_NAMES.SURVEY_CUTOFF },
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.GROUP_REPORT },
      { name: QUEUE_NAMES.V2_REPORT },
      { name: QUEUE_NAMES.PROFILE_HYDRATION },
      { name: QUEUE_NAMES.STYLE_ANALYSIS },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
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
    GroupReportSnapshotRepository,
    V2ReportSnapshotRepository,
    V2CohortReportInputRepository,
    QuestionInsightRepository,
    SurveyEvidenceIntentRepository,
    {
      provide: ExpireQuestionInsightsAtCutoffUseCase,
      useFactory: (surveyRepo: SurveyRepository) =>
        new ExpireQuestionInsightsAtCutoffUseCase(surveyRepo),
      inject: [SurveyRepository],
    },
    QuestionCutoffProcessor,
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
        questionInsightRepo: QuestionInsightRepository,
      ) => new SurveyEvidenceExtractionUseCase(
        ai, convRepo, surveyRepo, pulseBacklogService, questionInsightRepo,
      ),
      inject: [AiService, ConversationRepository, SurveyRepository, PulseBacklogService, QuestionInsightRepository],
    },
    {
      provide: FinalizeQuestionInsightUseCase,
      useFactory: (questionInsightRepo: QuestionInsightRepository, ai: AiService) =>
        new FinalizeQuestionInsightUseCase(questionInsightRepo, ai, ai),
      inject: [QuestionInsightRepository, AiService],
    },
    {
      provide: RecoverConfirmedQuestionInsightsUseCase,
      useFactory: (questionInsightRepo: QuestionInsightRepository, finalizer: FinalizeQuestionInsightUseCase) =>
        new RecoverConfirmedQuestionInsightsUseCase(questionInsightRepo, finalizer),
      inject: [QuestionInsightRepository, FinalizeQuestionInsightUseCase],
    },
    {
      provide: GroupReportUseCase,
      useFactory: (surveyRepo: SurveyRepository, ai: AiService) =>
        new GroupReportUseCase(surveyRepo, ai),
      inject: [SurveyRepository, AiService],
    },
    {
      provide: OpenSurveyReportingCycleUseCase,
      useFactory: (surveyRepo: SurveyRepository) =>
        new OpenSurveyReportingCycleUseCase(surveyRepo),
      inject: [SurveyRepository],
    },
    SurveyEvidenceProcessor,
    GroupReportProcessor,
    V2ReportProcessor,
  ],
  exports: [
    SurveyRepository,
    GroupStateRepository,
    QuestionInsightRepository,
    OpenSurveyReportingCycleUseCase,
    PulseBacklogService,
  ],
})
export class SurveyModule {}
