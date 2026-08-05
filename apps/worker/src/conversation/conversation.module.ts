import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  AGENT_RUNTIME_PORT,
  AgentRuntimeModeResolver,
  AgentRuntimeRouter,
  ConversationOrchestrator,
  ProactiveCheckInUseCase,
  PulseBacklogService,
  TypeScriptAgentRuntime,
} from '@entalent/application';
import { createLogger } from '@entalent/observability';
import { ConversationProcessor } from './conversation.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { AiService } from './ai.service';
import { LlmRunRepository } from './llm-run.repository';
import { RuntimeFallbackBarrierService } from './runtime-fallback-barrier.service';
import { RuntimeLedgerRepository } from './runtime-ledger.repository';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { SurveyModule } from '../survey/survey.module';
import { StyleModule } from '../style/style.module';
import { SafetyModule } from '../safety/safety.module';
import { FeatureFlagModule } from '../feature-flags/feature-flag.module';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { RuntimeControlFlagRepository } from '../feature-flags/runtime-control-flag.repository';
import { MemoryRepository } from '../memory/repositories/memory.repository';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { RiskSignalRepository } from '../safety/repositories/risk-signal.repository';
import { EscalationStubService } from '../safety/escalation-stub.service';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { StyleProfileRepository } from '../style/repositories/style-profile.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

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
      ) => new ConversationOrchestrator(repo, ai, outbox, memoryRepo, surveyRepo, riskSignalRepo, escalation, featureFlags, scheduledActionRepo, pulseBacklogService, styleProfileRepo),
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
      ],
    },
    {
      provide: TypeScriptAgentRuntime,
      useFactory: (orchestrator: ConversationOrchestrator) => new TypeScriptAgentRuntime(orchestrator),
      inject: [ConversationOrchestrator],
    },
    {
      provide: AGENT_RUNTIME_PORT,
      useFactory: (
        typeScriptRuntime: TypeScriptAgentRuntime,
        runtimeControls: RuntimeControlFlagRepository,
        runtimeLedger: RuntimeLedgerRepository,
        runtimeFallbackBarrier: RuntimeFallbackBarrierService,
      ) => {
        const logger = createLogger(AgentRuntimeRouter.name);
        const modeResolver = new AgentRuntimeModeResolver(runtimeControls);
        return new AgentRuntimeRouter(typeScriptRuntime, {
          evaluateMode: (request) => modeResolver.resolveDecision(request),
          recordDecision: async (request, decision) => {
            if (!hasRuntimeLedgerFields(request)) {
              return;
            }

            await runtimeLedger.recordStartedAttempt({
              tenantId: request.tenantId,
              requestId: request.requestId,
              eventId: request.eventId,
              messageId: request.messageId,
              runtimeAttempt: request.runtimeAttempt,
              traceId: request.traceId,
              runtimeMode: decision.mode,
            });
          },
          recordFailure: async (request, decision, error) => {
            if (!hasRuntimeLedgerFields(request)) {
              return;
            }

            const attempt = await runtimeLedger.recordStartedAttempt({
              tenantId: request.tenantId,
              requestId: request.requestId,
              eventId: request.eventId,
              messageId: request.messageId,
              runtimeAttempt: request.runtimeAttempt,
              traceId: request.traceId,
              runtimeMode: decision.mode,
            });
            await runtimeLedger.markFailed(attempt.id, toRuntimeFailureReason(error));
          },
          executeFallback: (request, fallback) => runtimeFallbackBarrier.executeFallbackIfAllowed(request, fallback),
          logger: {
            info: (message, context) => logger.info(message, context),
            warn: (message, context) => logger.warn(message, context),
          },
        });
      },
      inject: [
        TypeScriptAgentRuntime,
        RuntimeControlFlagRepository,
        RuntimeLedgerRepository,
        RuntimeFallbackBarrierService,
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
      ) => new ProactiveCheckInUseCase(repo, ai, outbox, memoryRepo, pulseBacklogService, featureFlags),
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
    RuntimeFallbackBarrierService,
    RuntimeLedgerRepository,
  ],
})
export class ConversationModule {}

function hasRuntimeLedgerFields<T extends {
  requestId?: string;
  eventId?: string;
  runtimeAttempt?: number;
}>(request: T): request is T & {
  requestId: string;
  eventId: string;
  runtimeAttempt: number;
} {
  return (
    typeof request.requestId === 'string' &&
    typeof request.eventId === 'string' &&
    typeof request.runtimeAttempt === 'number'
  );
}

export function toRuntimeFailureReason(error: unknown): string {
  if (error instanceof Error && runtimeFailureReasonCodes.has(error.message)) {
    return error.message;
  }

  return 'runtime_failed';
}

const runtimeFailureReasonCodes = new Set<string>([
  'fallback_barrier_unknown',
  'fallback_closed_after_actions_committed',
  'fallback_closed_after_reply_committed',
  'runtime_dependency_failed',
  'runtime_duplicate_request',
  'runtime_timeout',
  'runtime_unavailable',
  'runtime_unsafe_partial_result',
  'runtime_validation_error',
]);
