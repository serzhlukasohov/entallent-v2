import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  AGENT_RUNTIME_PORT,
  AgentRuntimeModeResolver,
  AgentRuntimeRouter,
  ConversationOrchestrator,
  MafAgentRuntimeClient,
  MafPrimaryAgentRuntime,
  ProactiveCheckInUseCase,
  PulseBacklogService,
  TypeScriptAgentRuntime,
} from '@entalent/application';
import type { Env } from '@entalent/config';
import type {
  AgentRuntimePort,
  AgentRuntimeShadowCandidateRecord,
  MafAgentRuntimeClientOptions,
  MafAgentRuntimeCandidateProvider,
  ProcessMessageRequest,
} from '@entalent/application';
import { ConversationProcessor } from './conversation.processor';
import { ConversationRepository } from './repositories/conversation.repository';
import { OutboxService } from './outbox.service';
import { AiService } from './ai.service';
import { LlmRunRepository } from './llm-run.repository';
import { createLogger } from '@entalent/observability';
import { RuntimeLedgerRepository } from './runtime-ledger.repository';
import {
  ShadowDiagnosticsRepository,
  type RecordShadowDiagnosticsParams,
  type ShadowDiagnosticsJsonValue,
} from './shadow-diagnostics.repository';
import { RuntimeFallbackBarrierService } from './runtime-fallback-barrier.service';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { SurveyModule } from '../survey/survey.module';
import { StyleModule } from '../style/style.module';
import { SafetyModule } from '../safety/safety.module';
import { FeatureFlagModule } from '../feature-flags/feature-flag.module';
import { FeatureFlagRepository } from '../feature-flags/feature-flag.repository';
import { RuntimeControlFlagRepository } from '../feature-flags/runtime-control-flag.repository';
import { MemoryRepository } from '../memory/repositories/memory.repository';
import { GoalRepository } from '../memory/repositories/goal.repository';
import { RiskSignalRepository } from '../safety/repositories/risk-signal.repository';
import { EscalationStubService } from '../safety/escalation-stub.service';
import { SurveyRepository } from '../survey/repositories/survey.repository';
import { ScheduledActionRepository } from '../followup/repositories/scheduled-action.repository';
import { StyleProfileRepository } from '../style/repositories/style-profile.repository';
import { QUEUE_NAMES } from '../queue/queue.module';

type MafPrimaryAgentRuntimeOptions = {
  conversationRepo: ConversationRepository;
  outbox: OutboxService;
  mafRuntime: MafAgentRuntimeCandidateProvider;
  featureFlags?: FeatureFlagRepository;
  riskSignalRepo?: RiskSignalRepository;
  escalation?: EscalationStubService;
  scheduledActionRepo?: ScheduledActionRepository;
  runtimeLedger: RuntimeLedgerRepository;
};

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
      provide: AGENT_RUNTIME_PORT,
      useFactory: (
        typeScriptRuntime: TypeScriptAgentRuntime,
        conversationRepo: ConversationRepository,
        outbox: OutboxService,
        featureFlags: FeatureFlagRepository,
        riskSignalRepo: RiskSignalRepository,
        escalation: EscalationStubService,
        runtimeLedger: RuntimeLedgerRepository,
        runtimeFallbackBarrier: RuntimeFallbackBarrierService,
        scheduledActionRepo: ScheduledActionRepository,
        memoryRepo: MemoryRepository,
        goalRepo: GoalRepository,
        shadowDiagnosticsRepo: ShadowDiagnosticsRepository,
        runtimeControls: RuntimeControlFlagRepository,
        config: ConfigService<Env, true>,
      ): AgentRuntimePort => {
        const logger = createLogger(AgentRuntimeRouter.name);
        const modeResolver = new AgentRuntimeModeResolver(runtimeControls);
        const mafRuntime = createMafAgentRuntimeClientFromEnv({
          AGENT_SERVICE_INTERNAL_URL: config.get('AGENT_SERVICE_INTERNAL_URL', { infer: true }),
          AGENT_SERVICE_URL: config.get('AGENT_SERVICE_URL', { infer: true }),
          AGENT_SERVICE_TIMEOUT_MS: config.get('AGENT_SERVICE_TIMEOUT_MS', { infer: true }),
          INTERNAL_SERVICE_AUTH_SECRET: config.get('INTERNAL_SERVICE_AUTH_SECRET', { infer: true }),
        });

        const runtimeAttemptByRequest = new Map<string, string>();
        const makeAttemptKey = (request: ProcessMessageRequest): string =>
          `${request.tenantId}:${request.requestId}:${request.eventId}:${request.messageId}:${request.runtimeAttempt}`;

        const rememberAttempt = (request: ProcessMessageRequest, runtimeAttemptId: string): void => {
          if (!hasRuntimeLedgerFields(request)) {
            return;
          }
          runtimeAttemptByRequest.set(makeAttemptKey(request), runtimeAttemptId);
        };

        const consumeAttempt = (request: ProcessMessageRequest): string | undefined => {
          if (!hasRuntimeLedgerFields(request)) {
            return undefined;
          }
          const key = makeAttemptKey(request);
          const attemptId = runtimeAttemptByRequest.get(key);
          if (!attemptId) {
            return undefined;
          }
          runtimeAttemptByRequest.delete(key);
          return attemptId;
        };

        const clearAttempt = (request: ProcessMessageRequest): void => {
          if (!hasRuntimeLedgerFields(request)) {
            return;
          }
          runtimeAttemptByRequest.delete(makeAttemptKey(request));
        };

        const recordShadowCandidate = async (record: AgentRuntimeShadowCandidateRecord): Promise<void> => {
          const params = toShadowDiagnosticsParams(record);
          if (!params) {
            return;
          }

          await shadowDiagnosticsRepo.recordShadowDiagnostics(params);
          clearAttempt(record.request);
        };

        const mafPrimaryRuntime = new MafPrimaryAgentRuntime(
          conversationRepo,
          outbox,
          mafRuntime,
          featureFlags,
          riskSignalRepo,
          escalation,
          scheduledActionRepo,
          memoryRepo,
          goalRepo,
          async ({ request, candidate, runtimeAttemptId }) => {
            const targetRuntimeAttemptId = runtimeAttemptId
              ?? (hasRuntimeLedgerFields(request) ? runtimeAttemptByRequest.get(makeAttemptKey(request)) : undefined);
            if (!targetRuntimeAttemptId) {
              return;
            }

            await runtimeLedger.recordCandidateReceived(targetRuntimeAttemptId);
            await runtimeLedger.recordActionsValidated(targetRuntimeAttemptId);
            await runtimeLedger.recordActionEnvelopes({
              tenantId: request.tenantId,
              runtimeAttemptId: targetRuntimeAttemptId,
              actions: candidate.proposedActions,
            });
            await runtimeLedger.markActionsCommitted(targetRuntimeAttemptId);
          },
        );

        return new AgentRuntimeRouter(typeScriptRuntime, {
          evaluateMode: (request) => modeResolver.resolveDecision(request),
          recordDecision: async (request, decision) => {
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

            rememberAttempt(request, attempt.id);
            return { runtimeAttemptId: attempt.id };
          },
          recordFailure: async (request, _decision, error) => {
            const attemptId = consumeAttempt(request);
            if (!attemptId) {
              return;
            }
            await runtimeLedger.markFailed(attemptId, toRuntimeFailureReason(error));
          },
          recordPrimaryFailure: async ({ request, diagnostic, runtimeAttemptId }) => {
            clearAttempt(request);
            if (!runtimeAttemptId) {
              return;
            }

            await runtimeLedger.markFailed(runtimeAttemptId, toRuntimeFailureReason(new Error(diagnostic.reasonCode)));
          },
          recordPrimarySuccess: async ({ request, runtimeAttemptId }) => {
            clearAttempt(request);
            if (!runtimeAttemptId) {
              return;
            }

            await runtimeLedger.markReplyCommitted(runtimeAttemptId);
          },
          recordShadowCandidate,
          executeFallback: (request, fallback) => runtimeFallbackBarrier.executeFallbackIfAllowed(request, fallback),
          mafRuntime,
          mafPrimaryRuntime,
          logger: {
            info: (message, context) => logger.info(message, context),
            warn: (message, context) => logger.warn(message, context),
          },
        });
      },
      inject: [
        TypeScriptAgentRuntime,
        ConversationRepository,
        OutboxService,
        FeatureFlagRepository,
        RiskSignalRepository,
        EscalationStubService,
        RuntimeLedgerRepository,
        RuntimeFallbackBarrierService,
        ScheduledActionRepository,
        MemoryRepository,
        GoalRepository,
        ShadowDiagnosticsRepository,
        RuntimeControlFlagRepository,
        ConfigService,
      ],
    },
    {
      provide: TypeScriptAgentRuntime,
      useFactory: (orchestrator: ConversationOrchestrator) => new TypeScriptAgentRuntime(orchestrator),
      inject: [ConversationOrchestrator],
    },
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
    RuntimeLedgerRepository,
    RuntimeFallbackBarrierService,
    ShadowDiagnosticsRepository,
  ],
})
export class ConversationModule {}

export interface CreateMafPrimaryRuntimePortOptions {
  conversationRepo: MafPrimaryAgentRuntimeOptions['conversationRepo'];
  outbox: MafPrimaryAgentRuntimeOptions['outbox'];
  mafRuntime: MafPrimaryAgentRuntimeOptions['mafRuntime'];
  featureFlags?: MafPrimaryAgentRuntimeOptions['featureFlags'];
  riskSignalRepo?: MafPrimaryAgentRuntimeOptions['riskSignalRepo'];
  escalation?: MafPrimaryAgentRuntimeOptions['escalation'];
  scheduledActionRepo?: MafPrimaryAgentRuntimeOptions['scheduledActionRepo'];
  memoryRepo?: MemoryRepository;
  goalRepo?: GoalRepository;
  runtimeLedger: MafPrimaryAgentRuntimeOptions['runtimeLedger'];
}

export function createMafPrimaryRuntimePort(options: CreateMafPrimaryRuntimePortOptions): AgentRuntimePort {
  const mafPrimaryRuntime = new MafPrimaryAgentRuntime(
    options.conversationRepo,
    options.outbox,
    options.mafRuntime,
    options.featureFlags,
    options.riskSignalRepo,
    options.escalation,
    options.scheduledActionRepo,
    options.memoryRepo,
    options.goalRepo,
    async ({ request, candidate, runtimeAttemptId }) => {
      if (!runtimeAttemptId) {
        return;
      }

      await options.runtimeLedger.recordCandidateReceived(runtimeAttemptId);
      await options.runtimeLedger.recordActionsValidated(runtimeAttemptId);
      await options.runtimeLedger.recordActionEnvelopes({
        tenantId: request.tenantId,
        runtimeAttemptId,
        actions: candidate.proposedActions,
      });
      await options.runtimeLedger.markActionsCommitted(runtimeAttemptId);
    },
  );

  return {
    async processMessage(request: ProcessMessageRequest) {
      if (!hasRuntimeLedgerFields(request)) {
        return mafPrimaryRuntime.processMessage(request);
      }

      const attempt = await options.runtimeLedger.recordStartedAttempt({
        tenantId: request.tenantId,
        requestId: request.requestId,
        eventId: request.eventId,
        messageId: request.messageId,
        runtimeAttempt: request.runtimeAttempt,
        traceId: request.traceId,
        runtimeMode: 'maf_primary',
      });

      try {
        const result = await mafPrimaryRuntime.processMessage(request, { runtimeAttemptId: attempt.id });
        await options.runtimeLedger.markReplyCommitted(attempt.id);
        return result;
      } catch (error) {
        await options.runtimeLedger.markFailed(attempt.id, toRuntimeFailureReason(error));
        throw error;
      }
    },
  };
}

export type MafAgentRuntimeClientEnv = {
  AGENT_SERVICE_INTERNAL_URL?: string;
  AGENT_SERVICE_URL?: string;
  AGENT_SERVICE_TIMEOUT_MS?: string;
  INTERNAL_SERVICE_AUTH_SECRET?: string;
};

export function createMafAgentRuntimeClientFromEnv(env: MafAgentRuntimeClientEnv): MafAgentRuntimeClient {
  const resolvedEnv: MafAgentRuntimeClientEnv = {
    AGENT_SERVICE_INTERNAL_URL: normalizeOptionalString(
      env.AGENT_SERVICE_INTERNAL_URL ?? process.env.AGENT_SERVICE_INTERNAL_URL,
    ),
    AGENT_SERVICE_URL: normalizeOptionalString(env.AGENT_SERVICE_URL ?? process.env.AGENT_SERVICE_URL),
    AGENT_SERVICE_TIMEOUT_MS: normalizeOptionalString(env.AGENT_SERVICE_TIMEOUT_MS),
    INTERNAL_SERVICE_AUTH_SECRET: normalizeOptionalString(env.INTERNAL_SERVICE_AUTH_SECRET),
  };

  const runtimeFetch = resolveRuntimeFetch();
  const serviceUrlConfig = resolveAgentServiceUrl(resolvedEnv);
  const timeoutConfig = parseAgentServiceTimeout(resolvedEnv.AGENT_SERVICE_TIMEOUT_MS);
  if (process.env.MAF_DEBUG_RUNTIME_CONFIG === '1') {
    console.log(
      '[debug] runtime-config',
      JSON.stringify({
        AGENT_SERVICE_INTERNAL_URL: resolvedEnv.AGENT_SERVICE_INTERNAL_URL,
        AGENT_SERVICE_URL: resolvedEnv.AGENT_SERVICE_URL,
        AGENT_SERVICE_TIMEOUT_MS: resolvedEnv.AGENT_SERVICE_TIMEOUT_MS,
        serviceUrlConfigKey: serviceUrlConfig.serviceUrlConfigKey,
        hasServiceUrl: Boolean(serviceUrlConfig.serviceUrl),
        hasFetch: Boolean(runtimeFetch),
        processEnvInternalUrl: process.env.AGENT_SERVICE_INTERNAL_URL ? 'set' : 'missing',
      }),
    );
  }
  return new MafAgentRuntimeClient({
    ...serviceUrlConfig,
    ...timeoutConfig,
    serviceAuthSecret: resolvedEnv.INTERNAL_SERVICE_AUTH_SECRET,
    ...(runtimeFetch ? { fetch: runtimeFetch } : {}),
  });
}

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

export function toShadowDiagnosticsParams(
  record: AgentRuntimeShadowCandidateRecord,
): RecordShadowDiagnosticsParams | null {
  if (!record.runtimeAttemptId) {
    return null;
  }

  const candidateDiagnostics = record.candidateResult?.diagnostics;
  const diagnosticReasonCode = record.diagnostic?.reasonCode ?? (
    record.validationStatus === 'valid' ? 'maf_candidate_valid' : 'maf_candidate_invalid'
  );

  return {
    tenantId: record.request.tenantId,
    messageId: record.request.messageId,
    runtimeAttemptId: record.runtimeAttemptId,
    runtimeMode: 'maf_shadow',
    traceId: record.request.traceId,
    runtimeVersion: candidateDiagnostics?.runtimeVersion ?? 'maf-candidate-validation-failed',
    validationStatus: record.validationStatus,
    currentResult: toShadowDiagnosticsJson(record.currentResult),
    candidateResult: toShadowDiagnosticsJson(record.candidateResult ?? { diagnostic: record.diagnostic ?? null }),
    riskComparison: toShadowDiagnosticsJson({
      status: 'not_compared',
      currentSeverity: record.currentResult.risk.severity,
      candidateSeverity: record.candidateResult?.riskAssessment?.severity ?? null,
    }),
    memoryComparison: toShadowDiagnosticsJson({
      status: 'not_compared',
      currentCount: 0,
      candidateCount: record.candidateResult?.memoryCandidates.length ?? 0,
    }),
    actionComparison: toShadowDiagnosticsJson({
      status: 'not_compared',
      candidateCount: record.candidateResult?.proposedActions.length ?? 0,
    }),
    validationDetails: toShadowDiagnosticsJson({
      status: record.validationStatus,
      reasonCode: diagnosticReasonCode,
      reasonCodes: [diagnosticReasonCode],
      invalidFields: record.diagnostic?.invalidFields ?? [],
      missingCanonicalFields: record.diagnostic?.missingCanonicalFields ?? [],
    }),
    latencyMs: candidateDiagnostics?.latencyMs ?? 0,
    modelCallCount: candidateDiagnostics?.modelCalls ?? 0,
    toolCallCount: candidateDiagnostics?.toolCalls ?? 0,
    retryCount: candidateDiagnostics?.retryCount ?? 0,
    estimatedCost: 0,
  };
}

function toShadowDiagnosticsJson(value: unknown): ShadowDiagnosticsJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toShadowDiagnosticsJson(item));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toShadowDiagnosticsJson(item)]),
    );
  }

  return null;
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
  'maf_runtime_configuration_missing',
  'maf_runtime_configuration_invalid',
  'maf_runtime_url_invalid',
  'maf_runtime_boundary_request_invalid',
  'maf_runtime_response_invalid',
  'maf_runtime_http_failed',
  'maf_runtime_fetch_failed',
]);

function resolveAgentServiceUrl(env: MafAgentRuntimeClientEnv): Pick<
  MafAgentRuntimeClientOptions,
  'serviceUrl' | 'serviceUrlConfigKey'
> {
  const internalUrl = normalizeOptionalString(env.AGENT_SERVICE_INTERNAL_URL);
  if (internalUrl) {
    return {
      serviceUrl: internalUrl,
      serviceUrlConfigKey: 'AGENT_SERVICE_INTERNAL_URL',
    };
  }

  const compatibilityUrl = normalizeOptionalString(env.AGENT_SERVICE_URL);
  if (compatibilityUrl) {
    return {
      serviceUrl: compatibilityUrl,
      serviceUrlConfigKey: 'AGENT_SERVICE_URL',
    };
  }

  return {
    serviceUrlConfigKey: 'AGENT_SERVICE_INTERNAL_URL',
  };
}

function parseAgentServiceTimeout(
  timeoutMs: string | undefined,
): Partial<Pick<MafAgentRuntimeClientOptions, 'timeoutMs' | 'invalidConfigKeys'>> {
  const normalized = normalizeOptionalString(timeoutMs);
  if (!normalized) {
    return {};
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { invalidConfigKeys: ['AGENT_SERVICE_TIMEOUT_MS'] };
  }

  return { timeoutMs: parsed };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveRuntimeFetch():
  | ((input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<unknown>)
  | undefined {
  const fetchCandidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof fetchCandidate === 'function' ? (fetchCandidate as typeof globalThis.fetch) : undefined;
}
