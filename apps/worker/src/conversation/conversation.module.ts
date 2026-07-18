import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationOrchestrator, ProactiveCheckInUseCase } from '@entalent/application';
import { ConversationProcessor } from './conversation.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { AiService } from './ai.service';
import { LlmRunRepository } from './llm-run.repository';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { SurveyModule } from '../survey/survey.module';
import { SafetyModule } from '../safety/safety.module';
import { FeatureFlagModule } from '../feature-flags/feature-flag.module';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { MemoryRepository } from '../memory/repositories/memory.repository';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { RiskSignalRepository } from '../safety/repositories/risk-signal.repository';
import { EscalationStubService } from '../safety/escalation-stub.service';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

@Module({
  imports: [
    DatabaseModule,
    MemoryModule,
    SurveyModule,
    SafetyModule,
    FeatureFlagModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.CONVERSATION },
      { name: QUEUE_NAMES.MESSAGE_SEND },
      { name: QUEUE_NAMES.MEMORY_EXTRACTION },
      { name: QUEUE_NAMES.FOLLOWUP_EXECUTION },
      { name: QUEUE_NAMES.SURVEY_EVIDENCE },
    ),
  ],
  providers: [
    AiService,
    ConversationRepository,
    OutboxService,
    ScheduledActionRepository,
    {
      provide: ConversationOrchestrator,
      useFactory: (
        repo: ConversationRepository,
        ai: AiService,
        outbox: OutboxService,
        memoryRepo: MemoryRepository,
        surveyRepo: SurveyRepository,
        riskSignalRepo: RiskSignalRepository,
        escalation: EscalationStubService,
        featureFlags: FeatureFlagRepository,
        scheduledActionRepo: ScheduledActionRepository,
      ) => new ConversationOrchestrator(repo, ai, outbox, memoryRepo, surveyRepo, riskSignalRepo, escalation, featureFlags, scheduledActionRepo),
      inject: [
        ConversationRepository,
        AiService,
        OutboxService,
        MemoryRepository,
        SurveyRepository,
        RiskSignalRepository,
        EscalationStubService,
        FeatureFlagRepository,
        ScheduledActionRepository,
      ],
    },
    {
      provide: ProactiveCheckInUseCase,
      useFactory: (
        repo: ConversationRepository,
        ai: AiService,
        outbox: OutboxService,
        memoryRepo: MemoryRepository,
        surveyRepo: SurveyRepository,
        featureFlags: FeatureFlagRepository,
      ) => new ProactiveCheckInUseCase(repo, ai, outbox, memoryRepo, surveyRepo, featureFlags),
      inject: [
        ConversationRepository,
        AiService,
        OutboxService,
        MemoryRepository,
        SurveyRepository,
        FeatureFlagRepository,
      ],
    },
    ConversationProcessor,
    LlmRunRepository,
  ],
})
export class ConversationModule {}
