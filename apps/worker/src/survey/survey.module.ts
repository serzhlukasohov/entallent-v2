import { PulseLanguageRepository } from './repositories/pulse-language.repository';
import { AnalyticalRenditionRepository } from './repositories/analytical-rendition.repository';
import { DatabaseService } from '../database/database.service';
import { FormPulseReportUseCase } from '@entalent/application';
import { PulseSlackTransport } from '@entalent/channel-slack';
import { decryptField } from '@entalent/crypto-utils';
import { PulseReportLifecycleRepository } from './repositories/pulse-report-lifecycle.repository';
import { PulseReportRecipientRepository } from './repositories/pulse-report-recipient.repository';
import { PulseReportSnapshotRepository } from './repositories/pulse-report-snapshot.repository';
import { PulseReportDeliveryRepository } from './repositories/pulse-report-delivery.repository';
import { PulseReportDeliveryService } from './pulse-report-delivery.service';
import { BuildPulseReportUseCase } from '@entalent/application';
import { PulseReportNarrativeAdapter } from '@entalent/ai-openai';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import { PulseReportPresentationRepository } from './repositories/pulse-report-presentation.repository';
import { PulseReportSlackAssemblyService } from './pulse-report-slack-assembly.service';
import {
  PreparePulseReportInputsUseCase,
  SettlePulseReportInputsUseCase,
} from '@entalent/application';
import { PulseReportInputRepository } from './repositories/pulse-report-input.repository';
import { PulseReportSettlementRepository } from './repositories/pulse-report-settlement.repository';
import { PulseReportHistoryRepository } from './repositories/pulse-report-history.repository';
import { PulseReportProgressRepository } from './repositories/pulse-report-progress.repository';
import { BeginPulseReportFinalFormationUseCase } from '@entalent/application';
import { PulseReportFinalScheduleRepository } from './repositories/pulse-report-final-schedule.repository';
import { EngagementAnswerRepository } from './repositories/engagement-answer.repository';
import { CaptureEngagementAnswerUseCase } from '@entalent/application';
import { PulseReportScopeRepository } from './repositories/pulse-report-scope.repository';
import { ReportingPermissionRepository } from './repositories/reporting-permission.repository';
import { ReportingRightsRepository } from './repositories/reporting-rights.repository';
import { ReportingRightsProcessor } from './reporting-rights.processor';
import { ApplyReportingRightsAdmissionUseCase, WithdrawReportingPermissionUseCase } from '@entalent/application';
import { Module } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PULSE_REPORT_LIFECYCLE_QUEUE_NAME } from '@entalent/contracts';
import { PulseReportActivationRepository } from './repositories/pulse-report-activation.repository';
import {
  PulseReportLifecycleProductionDriver,
  PulseReportLifecycleWorker,
} from './pulse-report-lifecycle.worker';
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
      // RPT-09 employee rights path.
      { name: QUEUE_NAMES.REPORTING_RIGHTS },
      // RPT-10: registered, but inert unless PULSE_REPORTS_ENABLED and DB activation controls both allow.
      { name: PULSE_REPORT_LIFECYCLE_QUEUE_NAME },
    ),
  ],
  providers: [
    PulseLanguageRepository,
    AnalyticalRenditionRepository,
    PulseReportPresentationRepository,
    {
      provide: PulseReportLifecycleRepository,
      useFactory: (
        db: DatabaseService,
        inputs: PreparePulseReportInputsUseCase,
        p: PulseReportPresentationRepository,
        s: PulseReportFinalScheduleRepository,
      ) => new PulseReportLifecycleRepository(db, inputs, p, s),
      inject: [
        DatabaseService,
        PreparePulseReportInputsUseCase,
        PulseReportPresentationRepository,
        PulseReportFinalScheduleRepository,
      ],
    },
    {
      provide: PulseReportRecipientRepository,
      useFactory: (db: DatabaseService, c: ConfigService<Env, true>) =>
        new PulseReportRecipientRepository(db, (encrypted) => {
          const credentials = JSON.parse(
            decryptField(encrypted, c.get('FIELD_ENCRYPTION_KEY', { infer: true })),
          ) as { botToken?: string };
          if (!credentials.botToken) throw new Error('pulse_missing_bot_token');
          return credentials.botToken;
        }),
      inject: [DatabaseService, ConfigService],
    },
    { provide: PulseSlackTransport, useFactory: () => new PulseSlackTransport() },
    {
      provide: PulseReportSnapshotRepository,
      useFactory: (
        db: DatabaseService,
        p: PulseReportPresentationRepository,
        r: PulseReportRecipientRepository,
        t: PulseSlackTransport,
      ) => new PulseReportSnapshotRepository(db, p, r, t),
      inject: [
        DatabaseService,
        PulseReportPresentationRepository,
        PulseReportRecipientRepository,
        PulseSlackTransport,
      ],
    },
    {
      provide: PulseReportDeliveryRepository,
      useFactory: (
        db: DatabaseService,
        p: PulseReportPresentationRepository,
        r: PulseReportRecipientRepository,
        t: PulseSlackTransport,
      ) => new PulseReportDeliveryRepository(db, p, r, t),
      inject: [
        DatabaseService,
        PulseReportPresentationRepository,
        PulseReportRecipientRepository,
        PulseSlackTransport,
      ],
    },
    {
      provide: FormPulseReportUseCase,
      useFactory: (
        r: PulseReportLifecycleRepository,
        b: BuildPulseReportUseCase,
        s: PulseReportSnapshotRepository,
      ) => new FormPulseReportUseCase(r, b, s),
      inject: [
        PulseReportLifecycleRepository,
        BuildPulseReportUseCase,
        PulseReportSnapshotRepository,
      ],
    },
    {
      provide: PulseReportDeliveryService,
      useFactory: (r: PulseReportDeliveryRepository) => new PulseReportDeliveryService(r),
      inject: [PulseReportDeliveryRepository],
    },
    PulseReportActivationRepository,
    {
      // Production always passes the DB activation gate; there is no ungated production driver.
      provide: PulseReportLifecycleProductionDriver,
      useFactory: (
        lifecycle: PulseReportLifecycleRepository,
        activation: PulseReportActivationRepository,
        form: FormPulseReportUseCase,
        delivery: PulseReportDeliveryService,
        queue: Queue,
      ) => new PulseReportLifecycleProductionDriver(lifecycle, activation, form, delivery, queue),
      inject: [
        PulseReportLifecycleRepository,
        PulseReportActivationRepository,
        FormPulseReportUseCase,
        PulseReportDeliveryService,
        getQueueToken(PULSE_REPORT_LIFECYCLE_QUEUE_NAME),
      ],
    },
    PulseReportLifecycleWorker,
    {
      provide: PulseReportNarrativeAdapter,
      useFactory: (config: ConfigService<Env, true>) => {
        const endpoint = config.get('AZURE_OPENAI_ENDPOINT', { infer: true });
        return new PulseReportNarrativeAdapter(
          endpoint
            ? {
                azure: true,
                endpoint,
                apiKey: config.get('AZURE_OPENAI_API_KEY', { infer: true })!,
                apiVersion: config.get('AZURE_OPENAI_API_VERSION', { infer: true })!,
                deploymentName: config.get('OPENAI_MODEL_BALANCED', { infer: true }) ?? 'gpt-4o',
              }
            : { apiKey: config.get('OPENAI_API_KEY', { infer: true })! },
        );
      },
      inject: [ConfigService],
    },
    {
      provide: BuildPulseReportUseCase,
      useFactory: (
        repo: PulseReportPresentationRepository,
        inputs: PreparePulseReportInputsUseCase,
        narrative: PulseReportNarrativeAdapter,
        lifecycle: PulseReportLifecycleRepository,
      ) => new BuildPulseReportUseCase(repo, inputs, narrative, lifecycle),
      inject: [
        PulseReportPresentationRepository,
        PreparePulseReportInputsUseCase,
        PulseReportNarrativeAdapter,
        PulseReportLifecycleRepository,
      ],
    },
    {
      provide: PulseReportSlackAssemblyService,
      useFactory: (build: BuildPulseReportUseCase, repo: PulseReportPresentationRepository) =>
        new PulseReportSlackAssemblyService(build, repo),
      inject: [BuildPulseReportUseCase, PulseReportPresentationRepository],
    },
    PulseReportInputRepository,
    PulseReportSettlementRepository,
    PulseReportHistoryRepository,
    PulseReportProgressRepository,
    {
      provide: PreparePulseReportInputsUseCase,
      useFactory: (r: PulseReportInputRepository, h: PulseReportHistoryRepository) =>
        new PreparePulseReportInputsUseCase(r, h),
      inject: [PulseReportInputRepository, PulseReportHistoryRepository],
    },
    {
      provide: SettlePulseReportInputsUseCase,
      useFactory: (r: PulseReportSettlementRepository) => new SettlePulseReportInputsUseCase(r),
      inject: [PulseReportSettlementRepository],
    },
    PulseReportFinalScheduleRepository,
    {
      provide: BeginPulseReportFinalFormationUseCase,
      useFactory: (repo: PulseReportFinalScheduleRepository) =>
        new BeginPulseReportFinalFormationUseCase(repo),
      inject: [PulseReportFinalScheduleRepository],
    },
    EngagementAnswerRepository,
    {
      provide: CaptureEngagementAnswerUseCase,
      useFactory: (repo: EngagementAnswerRepository) => new CaptureEngagementAnswerUseCase(repo),
      inject: [EngagementAnswerRepository],
    },
    PulseReportScopeRepository,
    ReportingPermissionRepository,
    {
      provide: ReportingRightsRepository,
      useFactory: (db: DatabaseService, languages: PulseLanguageRepository) => new ReportingRightsRepository(db, languages),
      inject: [DatabaseService, PulseLanguageRepository],
    },
    {
      provide: WithdrawReportingPermissionUseCase,
      useFactory: (repo: ReportingPermissionRepository) => new WithdrawReportingPermissionUseCase(repo),
      inject: [ReportingPermissionRepository],
    },
    {
      provide: ApplyReportingRightsAdmissionUseCase,
      useFactory: (repo: ReportingRightsRepository, withdraw: WithdrawReportingPermissionUseCase) =>
        new ApplyReportingRightsAdmissionUseCase(repo, withdraw),
      inject: [ReportingRightsRepository, WithdrawReportingPermissionUseCase],
    },
    ReportingRightsProcessor,
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
      // GC round 3 CAP-1: topic selection reads V2 working insights as coverage.
      useFactory: (
        backlogRepo: PulseBacklogRepository,
        surveyRepo: SurveyRepository,
        questionInsightRepo: QuestionInsightRepository,
        engagementRepo: EngagementAnswerRepository,
      ) => new PulseBacklogService(backlogRepo, surveyRepo, questionInsightRepo, engagementRepo),
      inject: [
        PulseBacklogRepository,
        SurveyRepository,
        QuestionInsightRepository,
        EngagementAnswerRepository,
      ],
    },
    {
      provide: SurveyEvidenceExtractionUseCase,
      useFactory: (
        ai: AiService,
        convRepo: ConversationRepository,
        surveyRepo: SurveyRepository,
        pulseBacklogService: PulseBacklogService,
        questionInsightRepo: QuestionInsightRepository,
        engagementCapture: CaptureEngagementAnswerUseCase,
      ) =>
        new SurveyEvidenceExtractionUseCase(
          ai,
          convRepo,
          surveyRepo,
          pulseBacklogService,
          questionInsightRepo,
          engagementCapture,
        ),
      inject: [
        AiService,
        ConversationRepository,
        SurveyRepository,
        PulseBacklogService,
        QuestionInsightRepository,
        CaptureEngagementAnswerUseCase,
      ],
    },
    {
      provide: FinalizeQuestionInsightUseCase,
      useFactory: (questionInsightRepo: QuestionInsightRepository, ai: AiService, languages: PulseLanguageRepository) =>
        new FinalizeQuestionInsightUseCase(questionInsightRepo, ai, ai, languages),
      inject: [QuestionInsightRepository, AiService, PulseLanguageRepository],
    },
    {
      provide: RecoverConfirmedQuestionInsightsUseCase,
      useFactory: (
        questionInsightRepo: QuestionInsightRepository,
        finalizer: FinalizeQuestionInsightUseCase,
      ) => new RecoverConfirmedQuestionInsightsUseCase(questionInsightRepo, finalizer),
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
      useFactory: (surveyRepo: SurveyRepository) => new OpenSurveyReportingCycleUseCase(surveyRepo),
      inject: [SurveyRepository],
    },
    SurveyEvidenceProcessor,
    GroupReportProcessor,
    V2ReportProcessor,
  ],
  exports: [
    ReportingRightsRepository,
    PulseReportLifecycleRepository,
    PulseReportSnapshotRepository,
    PulseReportDeliveryRepository,
    FormPulseReportUseCase,
    PulseReportDeliveryService,
    BuildPulseReportUseCase,
    PulseReportSlackAssemblyService,
    PreparePulseReportInputsUseCase,
    SettlePulseReportInputsUseCase,
    PulseReportHistoryRepository,
    PulseReportFinalScheduleRepository,
    BeginPulseReportFinalFormationUseCase,
    CaptureEngagementAnswerUseCase,
    EngagementAnswerRepository,
    SurveyRepository,
    GroupStateRepository,
    QuestionInsightRepository,
    OpenSurveyReportingCycleUseCase,
    PulseBacklogService,
  ],
})
export class SurveyModule {}
