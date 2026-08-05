import { Injectable } from '@nestjs/common';
import {
  classifyRuntimeFallbackBarrier,
  executeRuntimeFallbackIfAllowed,
  type ProcessMessageRequest,
  type RuntimeFallbackBarrierDecision,
} from '@entalent/application';
import { createLogger } from '@entalent/observability';
import { RuntimeLedgerRepository } from './runtime-ledger.repository';

@Injectable()
export class RuntimeFallbackBarrierService {
  private readonly logger = createLogger(RuntimeFallbackBarrierService.name);

  constructor(private readonly runtimeLedger: RuntimeLedgerRepository) {}

  async executeFallbackIfAllowed<T>(request: ProcessMessageRequest, fallback: () => Promise<T> | T): Promise<T> {
    const decision = await this.classifyForRequest(request);
    return executeRuntimeFallbackIfAllowed({ decision, fallback });
  }

  async classifyForRequest(request: ProcessMessageRequest): Promise<RuntimeFallbackBarrierDecision> {
    try {
      const attempt = await this.runtimeLedger.findAttemptByDurableKey({
        tenantId: request.tenantId,
        requestId: request.requestId ?? '',
        eventId: request.eventId ?? '',
        messageId: request.messageId,
        runtimeAttempt: request.runtimeAttempt ?? 0,
      });
      const decision = classifyRuntimeFallbackBarrier(attempt);
      this.logDecision(request, decision);
      return decision;
    } catch {
      const decision: RuntimeFallbackBarrierDecision = {
        allowed: false,
        barrierStatus: 'unknown',
        reasonCode: 'fallback_barrier_unknown',
        phase: undefined,
        traceId: request.traceId,
        runtimeAttempt: request.runtimeAttempt,
      };
      this.logDecision(request, decision);
      return decision;
    }
  }

  private logDecision(request: ProcessMessageRequest, decision: RuntimeFallbackBarrierDecision): void {
    try {
      this.logger.info('Runtime fallback barrier classified', {
        traceId: decision.traceId ?? request.traceId,
        tenantId: request.tenantId,
        userId: request.userId,
        barrierStatus: decision.barrierStatus,
        reasonCode: decision.reasonCode,
        phase: decision.phase,
        runtimeAttempt: decision.runtimeAttempt ?? request.runtimeAttempt,
      });
    } catch {
      // Fallback decisions must not depend on observability working.
    }
  }
}
