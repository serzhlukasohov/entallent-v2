import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  ConversationOrchestrator,
  ProactiveCheckInUseCase,
  PulseBacklogService,
} from '@entalent/application';
import { AiService } from './ai.service';
import { ConversationProcessor } from './conversation.processor';
import { LlmRunRepository } from './llm-run.repository';
import { OutboxService } from './outbox.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { DatabaseModule } from '../database/database.module';
import { FeatureFlagModule } from '../feature-flags/feature-flag.module';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { GoalRepository } from '../memory/repositories/goal.repository';
import { MemoryRepository } from '../memory/repositories/memory.repository';
import { MemoryModule } from '../memory/memory.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { EscalationStubService } from '../safety/escalation-stub.service';
import { RiskSignalRepository } from '../safety/repositories/risk-signal.repository';
import { SafetyModule } from '../safety/safety.module';
import { StyleProfileRepository } from '../style/repositories/style-profile.repository';
import { StyleModule } from '../style/style.module';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { SurveyModule } from '../survey/survey.module';

@Module({
  imports: [
    DatabaseModule,
    MemoryModule,
    SurveyModule,
    StyleModule,
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
        pulseBacklogService: PulseBacklogService,
        styleProfileRepo: StyleProfileRepository,
        goalRepo: GoalRepository,
      ) => new ConversationOrchestrator(
        repo,
        ai,
        outbox,
        memoryRepo,
        surveyRepo,
        riskSignalRepo,
        escalation,
        featureFlags,
        scheduledActionRepo,
        pulseBacklogService,
        styleProfileRepo,
        goalRepo,
      ),
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
        PulseBacklogService,
        StyleProfileRepository,
        GoalRepository,
      ],
    },
    {
      provide: ProactiveCheckInUseCase,
      useFactory: (
        repo: ConversationRepository,
        ai: AiService,
        outbox: OutboxService,
        memoryRepo: MemoryRepository,
        pulseBacklogService: PulseBacklogService,
        featureFlags: FeatureFlagRepository,
      ) => new ProactiveCheckInUseCase(
        repo,
        ai,
        outbox,
        memoryRepo,
        pulseBacklogService,
        featureFlags,
      ),
      inject: [
        ConversationRepository,
        AiService,
        OutboxService,
        MemoryRepository,
        PulseBacklogService,
        FeatureFlagRepository,
      ],
    },
    ConversationProcessor,
    LlmRunRepository,
  ],
})
export class ConversationModule {}
