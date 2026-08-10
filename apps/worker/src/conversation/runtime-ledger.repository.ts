import { Injectable, Logger } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { runtimeActions, runtimeAttempts } from '@entalent/database';
import type { DbRuntimeAction, DbRuntimeAttempt } from '@entalent/database';
import type { RuntimeActionProposal } from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';

export type RuntimeLedgerPhase =
  | 'started'
  | 'candidate_received'
  | 'actions_validated'
  | 'actions_committed'
  | 'reply_committed'
  | 'failed';

export type RuntimeLedgerMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_primary' | 'maf_disabled';

export interface RecordStartedAttemptParams {
  tenantId: string;
  requestId: string;
  eventId: string;
  messageId: string;
  runtimeAttempt: number;
  traceId: string;
  runtimeMode: RuntimeLedgerMode;
}

export interface TransitionAttemptPhaseParams {
  runtimeAttemptId: string;
  phase: RuntimeLedgerPhase;
  failureReason?: string;
}

export interface RecordActionEnvelopesParams {
  tenantId: string;
  runtimeAttemptId: string;
  actions: RuntimeActionProposal[];
}

export interface FindAttemptByDurableKeyParams {
  tenantId: string;
  requestId: string;
  eventId: string;
  messageId: string;
  runtimeAttempt: number;
}

export interface RuntimeFallbackAttemptState {
  id: string;
  traceId: string;
  runtimeMode: string;
  runtimeAttempt: number;
  phase: string;
  failureReason: string | null;
}

@Injectable()
export class RuntimeLedgerRepository {
  private readonly logger = new Logger(RuntimeLedgerRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async recordStartedAttempt(params: RecordStartedAttemptParams): Promise<DbRuntimeAttempt> {
    const runtimeMode = normalizeRuntimeModeForInsert(params.runtimeMode);
    if (!runtimeMode) {
      this.logger.warn('Runtime ledger start attempt rejected: invalid runtime mode', {
        runtimeMode: params.runtimeMode,
        tenantId: params.tenantId,
        requestId: params.requestId,
        eventId: params.eventId,
        messageId: params.messageId,
        runtimeAttempt: params.runtimeAttempt,
      });
      throw new Error('runtime_attempt_invalid_mode');
    }

    const now = new Date();
    const [attempt] = await this.db.client
      .insert(runtimeAttempts)
      .values({
        tenantId: params.tenantId,
        requestId: params.requestId,
        eventId: params.eventId,
        messageId: params.messageId,
        runtimeAttempt: params.runtimeAttempt,
        traceId: params.traceId,
        runtimeMode,
        phase: 'started',
        failureReason: null,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          runtimeAttempts.tenantId,
          runtimeAttempts.requestId,
          runtimeAttempts.eventId,
          runtimeAttempts.messageId,
          runtimeAttempts.runtimeAttempt,
        ],
      })
      .returning();

    if (attempt) {
      return attempt;
    }

    const [existingAttempt] = await this.db.client
      .select()
      .from(runtimeAttempts)
      .where(
        and(
          eq(runtimeAttempts.tenantId, params.tenantId),
          eq(runtimeAttempts.requestId, params.requestId),
          eq(runtimeAttempts.eventId, params.eventId),
          eq(runtimeAttempts.messageId, params.messageId),
          eq(runtimeAttempts.runtimeAttempt, params.runtimeAttempt),
        ),
      )
      .limit(1);

    if (!existingAttempt) {
      throw new Error('runtime_attempt_record_failed');
    }

    return existingAttempt;
  }

  async findAttemptByDurableKey(params: FindAttemptByDurableKeyParams): Promise<RuntimeFallbackAttemptState | null> {
    const [attempt] = await this.db.client
      .select({
        id: runtimeAttempts.id,
        traceId: runtimeAttempts.traceId,
        runtimeMode: runtimeAttempts.runtimeMode,
        runtimeAttempt: runtimeAttempts.runtimeAttempt,
        phase: runtimeAttempts.phase,
        failureReason: runtimeAttempts.failureReason,
      })
      .from(runtimeAttempts)
      .where(
        and(
          eq(runtimeAttempts.tenantId, params.tenantId),
          eq(runtimeAttempts.requestId, params.requestId),
          eq(runtimeAttempts.eventId, params.eventId),
          eq(runtimeAttempts.messageId, params.messageId),
          eq(runtimeAttempts.runtimeAttempt, params.runtimeAttempt),
        ),
      )
      .limit(1);

    return attempt ?? null;
  }

  async transitionAttemptPhase(params: TransitionAttemptPhaseParams): Promise<DbRuntimeAttempt> {
    const [currentAttempt] = await this.db.client
      .select()
      .from(runtimeAttempts)
      .where(eqRuntimeAttemptId(params.runtimeAttemptId))
      .limit(1);

    if (!currentAttempt) {
      throw new Error('runtime_attempt_not_found');
    }

    if (!isRuntimeLedgerPhase(currentAttempt.phase)) {
      throw new Error('runtime_attempt_phase_invalid');
    }

    if (!canAdvancePhase(currentAttempt.phase, params.phase)) {
      return currentAttempt;
    }

    const [attempt] = await this.db.client
      .update(runtimeAttempts)
      .set({
        phase: params.phase,
        failureReason: params.failureReason ?? null,
        updatedAt: new Date(),
      })
      .where(eqRuntimeAttemptId(params.runtimeAttemptId))
      .returning();

    if (!attempt) {
      throw new Error('runtime_attempt_not_found');
    }

    return attempt;
  }

  async recordCandidateReceived(runtimeAttemptId: string): Promise<DbRuntimeAttempt> {
    return this.transitionAttemptPhase({
      runtimeAttemptId,
      phase: 'candidate_received',
    });
  }

  async recordActionsValidated(runtimeAttemptId: string): Promise<DbRuntimeAttempt> {
    return this.transitionAttemptPhase({
      runtimeAttemptId,
      phase: 'actions_validated',
    });
  }

  async markActionsCommitted(runtimeAttemptId: string): Promise<DbRuntimeAttempt> {
    return this.transitionAttemptPhase({
      runtimeAttemptId,
      phase: 'actions_committed',
    });
  }

  async markReplyCommitted(runtimeAttemptId: string): Promise<DbRuntimeAttempt> {
    return this.transitionAttemptPhase({
      runtimeAttemptId,
      phase: 'reply_committed',
    });
  }

  async markFailed(runtimeAttemptId: string, failureReason: string): Promise<DbRuntimeAttempt> {
    return this.transitionAttemptPhase({
      runtimeAttemptId,
      phase: 'failed',
      failureReason,
    });
  }

  async recordActionEnvelopes(params: RecordActionEnvelopesParams): Promise<DbRuntimeAction[]> {
    if (params.actions.length === 0) {
      return [];
    }

    for (const action of params.actions) {
      assertCanonicalActionEnvelope(action);
    }

    const now = new Date();
    return this.db.client.transaction(async (tx) => {
      const [attempt] = await tx
        .select()
        .from(runtimeAttempts)
        .where(and(eq(runtimeAttempts.id, params.runtimeAttemptId), eq(runtimeAttempts.tenantId, params.tenantId)))
        .limit(1);

      if (!attempt) {
        throw new Error('runtime_attempt_not_found');
      }

      const rows: DbRuntimeAction[] = [];

      for (const action of params.actions) {
        const [existingAction] = await tx
          .select()
          .from(runtimeActions)
          .where(
            and(
              eq(runtimeActions.runtimeAttemptId, params.runtimeAttemptId),
              or(
                eq(runtimeActions.actionId, action.actionId),
                eq(runtimeActions.idempotencyKey, action.idempotencyKey),
              ),
            ),
          )
          .limit(1);

        const values = {
          tenantId: params.tenantId,
          runtimeAttemptId: params.runtimeAttemptId,
          actionId: action.actionId,
          aggregateType: action.aggregateType,
          actionType: action.actionType,
          idempotencyKey: action.idempotencyKey,
          payload: action.payload,
          validationResult: action.validationResult,
          executionStatus: action.executionStatus,
          commitMarker: action.commitMarker,
          updatedAt: now,
        };

        if (existingAction) {
          const [row] = await tx
            .update(runtimeActions)
            .set(values)
            .where(eq(runtimeActions.id, existingAction.id))
            .returning();

          if (!row) {
            throw new Error('runtime_action_record_failed');
          }

          rows.push(row);
          continue;
        }

        const [row] = await tx
          .insert(runtimeActions)
          .values(values)
          .onConflictDoUpdate({
            target: [runtimeActions.runtimeAttemptId, runtimeActions.idempotencyKey],
            set: values,
          })
          .returning();

        if (!row) {
          throw new Error('runtime_action_record_failed');
        }

        rows.push(row);
      }

      return rows;
    });
  }
}

function eqRuntimeAttemptId(runtimeAttemptId: string) {
  return eq(runtimeAttempts.id, runtimeAttemptId);
}

function assertCanonicalActionEnvelope(action: RuntimeActionProposal): void {
  assertActionLifecycle(action);
  assertActionShape(action);
}

function assertActionLifecycle(action: RuntimeActionProposal): void {
  if (action.executionStatus === 'committed') {
    if (action.validationResult.status !== 'valid' || action.commitMarker === null) {
      throw new Error('runtime_action_lifecycle_invalid');
    }
    return;
  }

  if (action.commitMarker !== null) {
    throw new Error('runtime_action_lifecycle_invalid');
  }
}

function assertActionShape(action: RuntimeActionProposal): void {
  if (
    typeof action.actionId !== 'string' ||
    action.actionId === '' ||
    typeof action.idempotencyKey !== 'string' ||
    action.idempotencyKey === ''
  ) {
    throw new Error('runtime_action_canonical_invalid');
  }

  assertValidationResultShape(action.validationResult);
  assertCommitMarkerShape(action.commitMarker);

  if (action.aggregateType === 'memory' && action.actionType === 'save_memory') {
    if (
      !isRecord(action.payload) ||
      typeof action.payload['memoryCandidateId'] !== 'string' ||
      action.payload['memoryCandidateId'] === ''
    ) {
      throw new Error('runtime_action_canonical_invalid');
    }
    return;
  }

  if (action.aggregateType === 'follow_up' && action.actionType === 'schedule_follow_up') {
    if (
      !isRecord(action.payload) ||
      typeof action.payload['executeAt'] !== 'string' ||
      typeof action.payload['intent'] !== 'string' ||
      typeof action.payload['deduplicationKey'] !== 'string' ||
      action.payload['executeAt'] === '' ||
      action.payload['intent'] === '' ||
      action.payload['deduplicationKey'] === ''
    ) {
      throw new Error('runtime_action_canonical_invalid');
    }
    return;
  }

  if (action.aggregateType === 'goal' && action.actionType === 'update_goal') {
    if (!isRecord(action.payload) || !isRecord(action.payload['changes'])) {
      throw new Error('runtime_action_canonical_invalid');
    }
    if (action.payload['goalId'] !== undefined && typeof action.payload['goalId'] !== 'string') {
      throw new Error('runtime_action_canonical_invalid');
    }
    for (const value of Object.values(action.payload['changes'])) {
      assertRuntimeJsonValue(value, 0);
    }
    return;
  }

  throw new Error('runtime_action_canonical_invalid');
}

function assertValidationResultShape(value: unknown): void {
  if (!isRecord(value) || !isRuntimeActionValidationStatus(value['status']) || !Array.isArray(value['reasonCodes'])) {
    throw new Error('runtime_action_canonical_invalid');
  }

  if (!value['reasonCodes'].every((reasonCode) => typeof reasonCode === 'string')) {
    throw new Error('runtime_action_canonical_invalid');
  }

  if (value['message'] !== undefined && typeof value['message'] !== 'string') {
    throw new Error('runtime_action_canonical_invalid');
  }
}

function assertCommitMarkerShape(value: unknown): void {
  if (value === null) {
    return;
  }

  if (
    !isRecord(value) ||
    typeof value['committedAt'] !== 'string' ||
    typeof value['referenceId'] !== 'string' ||
    value['committedAt'] === '' ||
    value['referenceId'] === ''
  ) {
    throw new Error('runtime_action_canonical_invalid');
  }
}

function isRuntimeActionValidationStatus(value: unknown): value is 'pending' | 'valid' | 'invalid' {
  return value === 'pending' || value === 'valid' || value === 'invalid';
}

function assertRuntimeJsonValue(value: unknown, depth: number): void {
  if (depth > 64) {
    throw new Error('runtime_action_canonical_invalid');
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('runtime_action_canonical_invalid');
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertRuntimeJsonValue(item, depth + 1);
    }
    return;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      assertRuntimeJsonValue(item, depth + 1);
    }
    return;
  }

  throw new Error('runtime_action_canonical_invalid');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRuntimeLedgerPhase(value: string): value is RuntimeLedgerPhase {
  return runtimeLedgerPhaseRanks[value as RuntimeLedgerPhase] !== undefined;
}

function canAdvancePhase(current: RuntimeLedgerPhase, next: RuntimeLedgerPhase): boolean {
  if (current === next) {
    return true;
  }

  if (current === 'failed' || current === 'reply_committed') {
    return false;
  }

  if (current === 'actions_committed' && next !== 'reply_committed') {
    return false;
  }

  if (next === 'failed') {
    return runtimeLedgerPhaseRanks[current] < runtimeLedgerPhaseRanks.actions_committed;
  }

  return runtimeLedgerPhaseRanks[next] > runtimeLedgerPhaseRanks[current];
}

const runtimeLedgerPhaseRanks: Record<RuntimeLedgerPhase, number> = {
  started: 0,
  candidate_received: 1,
  actions_validated: 2,
  actions_committed: 3,
  reply_committed: 4,
  failed: 4,
};

const runtimeModeAliases: Record<string, RuntimeLedgerMode> = {
  ts: 'typescript',
  typescript: 'typescript',
  shadow: 'maf_shadow',
  canary: 'maf_canary',
  primary: 'maf_primary',
  disabled: 'maf_disabled',
};

function normalizeRuntimeModeForInsert(runtimeMode: RuntimeLedgerMode): RuntimeLedgerMode | null {
  const normalized = runtimeMode.trim().toLowerCase();

  if (runtimeModeAliases[normalized]) {
    return runtimeModeAliases[normalized];
  }

  if (
    normalized === 'typescript' ||
    normalized === 'maf_shadow' ||
    normalized === 'maf_canary' ||
    normalized === 'maf_primary' ||
    normalized === 'maf_disabled'
  ) {
    return normalized as RuntimeLedgerMode;
  }

  return null;
}
