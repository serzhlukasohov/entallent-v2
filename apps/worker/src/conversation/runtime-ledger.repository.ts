import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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

export type RuntimeLedgerMode = 'typescript' | 'maf_shadow' | 'maf_canary' | 'maf_disabled';

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

@Injectable()
export class RuntimeLedgerRepository {
  constructor(private readonly db: Pick<DatabaseService, 'client'>) {}

  async recordStartedAttempt(params: RecordStartedAttemptParams): Promise<DbRuntimeAttempt> {
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
        runtimeMode: params.runtimeMode,
        phase: 'started',
        failureReason: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          runtimeAttempts.tenantId,
          runtimeAttempts.requestId,
          runtimeAttempts.eventId,
          runtimeAttempts.messageId,
          runtimeAttempts.runtimeAttempt,
        ],
        set: {
          traceId: params.traceId,
          runtimeMode: params.runtimeMode,
          phase: 'started',
          failureReason: null,
          updatedAt: now,
        },
      })
      .returning();

    if (!attempt) {
      throw new Error('runtime_attempt_record_failed');
    }

    return attempt;
  }

  async transitionAttemptPhase(params: TransitionAttemptPhaseParams): Promise<DbRuntimeAttempt> {
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

    const now = new Date();
    const rows = await Promise.all(
      params.actions.map(async (action) => {
        assertActionLifecycle(action);
        const [row] = await this.db.client
          .insert(runtimeActions)
          .values({
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
          })
          .onConflictDoUpdate({
            target: [runtimeActions.runtimeAttemptId, runtimeActions.idempotencyKey],
            set: {
              actionId: action.actionId,
              aggregateType: action.aggregateType,
              actionType: action.actionType,
              payload: action.payload,
              validationResult: action.validationResult,
              executionStatus: action.executionStatus,
              commitMarker: action.commitMarker,
              updatedAt: now,
            },
          })
          .returning();

        if (!row) {
          throw new Error('runtime_action_record_failed');
        }

        return row;
      }),
    );

    return rows;
  }
}

function eqRuntimeAttemptId(runtimeAttemptId: string) {
  return eq(runtimeAttempts.id, runtimeAttemptId);
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
