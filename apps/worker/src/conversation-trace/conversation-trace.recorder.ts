import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { OrchestrateInput, OrchestrateResult } from '@entalent/application';
import {
  buildReportTurn,
  describeError,
  describeOutcome,
  serializeTracedTurn,
  TRACED_TURN_SCHEMA_VERSION,
} from '@entalent/conversation-trace';
import { ConversationTraceRepository } from './conversation-trace.repository';
import { AmbientTraceSink, TurnCapture, TurnTraceContext } from './turn-capture';

/** How long a tenant's switch is trusted before it is read again. */
const FLAG_TTL_MS = 30_000;
/** Longest wait for pending trace writes at shutdown; the job queue never waits for them. */
const SHUTDOWN_FLUSH_MS = 2_000;

type FlagState = { enabled: boolean; expiresAt: number };

/**
 * Records conversation turns of tenants with the `conversation_trace` switch on (SPEC CAP-6).
 * Tracing is diagnostic only: the switch is never awaited before the turn, the capture lives in
 * the job's async context, and the encrypted row is written after the turn settles, without the
 * job waiting for it. Every failure on this path is logged as a fixed code and swallowed.
 */
@Injectable()
export class ConversationTraceRecorder implements OnApplicationShutdown {
  readonly context = new TurnTraceContext();
  readonly sink = new AmbientTraceSink(this.context);
  private readonly logger = new Logger(ConversationTraceRecorder.name);
  private readonly flags = new Map<string, FlagState>();
  private readonly flagLookups = new Map<string, Promise<boolean>>();
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly repository: ConversationTraceRepository) {}

  /** Runs one turn, capturing it when the tenant may be traced; the turn's outcome is passed through untouched. */
  async traceTurn(input: OrchestrateInput, run: () => Promise<OrchestrateResult>): Promise<OrchestrateResult> {
    let capture: TurnCapture | null = null;
    let enabled: boolean | Promise<boolean> = false;
    try {
      enabled = this.switchFor(input.tenantId);
      if (enabled !== false) capture = new TurnCapture(input);
    } catch {
      this.logger.warn('conversation_trace_start_failed');
    }
    // `run` is called exactly once on every path, outside any trace error handling.
    if (!capture) return run();

    let result: OrchestrateResult;
    try {
      result = await this.context.run(capture, run);
    } catch (error) {
      this.finish(capture, enabled, null, error);
      throw error;
    }
    this.finish(capture, enabled, result, null);
    return result;
  }

  /** Resolves when every trace write started so far has finished (tests, shutdown). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.race([this.flush(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_FLUSH_MS).unref())]);
  }

  private switchFor(tenantId: string): boolean | Promise<boolean> {
    const cached = this.flags.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.enabled;
    const inFlight = this.flagLookups.get(tenantId);
    if (inFlight) return inFlight;
    const lookup = this.repository.isTracingEnabled(tenantId).then(
      (enabled) => enabled,
      () => {
        this.logger.warn('conversation_trace_flag_lookup_failed');
        return false;
      },
    ).then((enabled) => {
      this.flags.set(tenantId, { enabled, expiresAt: Date.now() + FLAG_TTL_MS });
      this.flagLookups.delete(tenantId);
      return enabled;
    });
    this.flagLookups.set(tenantId, lookup);
    return lookup;
  }

  private finish(
    capture: TurnCapture,
    enabled: boolean | Promise<boolean>,
    result: OrchestrateResult | null,
    error: unknown,
  ): void {
    try {
      const completedAt = new Date();
      if (result) capture.recordFinal('decision', 'turn outcome', describeOutcome(result, capture.generationAttempts > 0));
      else capture.recordFinal('error', 'orchestrate', describeError(error));
      capture.close();
      const write = this.persist(capture, enabled, result, error, completedAt)
        .catch(() => this.logger.warn('conversation_trace_store_failed'))
        .finally(() => this.pending.delete(write));
      this.pending.add(write);
    } catch {
      this.logger.warn('conversation_trace_finish_failed');
    }
  }

  private async persist(
    capture: TurnCapture,
    enabled: boolean | Promise<boolean>,
    result: OrchestrateResult | null,
    error: unknown,
    completedAt: Date,
  ): Promise<void> {
    // Yield first: building and encrypting the payload must not run inside the job's own tick.
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!await enabled) return;
    const payloadJson = serializeTracedTurn({
      userMessage: capture.userMessage,
      trace: capture.droppedEvents > 0
        ? [...capture.events, { turn: 1, kind: 'warning', name: 'trace truncated', summary: `${capture.droppedEvents} events dropped` }]
        : capture.events,
      turn: result
        ? buildReportTurn(1, result, capture.lastGeneration, { ...capture.effects, generationAttempts: capture.generationAttempts })
        : null,
      error: result ? null : describeError(error),
      stateBefore: capture.stateBefore.state,
    });
    await this.repository.insert({
      tenantId: capture.input.tenantId,
      userId: capture.input.userId,
      conversationId: capture.input.conversationId,
      inboundMessageId: capture.input.messageId,
      outboundMessageId: result?.outboundMessageId ?? null,
      traceId: capture.input.traceId ?? null,
      status: result ? 'completed' : 'failed',
      schemaVersion: TRACED_TURN_SCHEMA_VERSION,
      payloadJson,
      startedAt: capture.startedAt,
      completedAt,
    });
  }
}
