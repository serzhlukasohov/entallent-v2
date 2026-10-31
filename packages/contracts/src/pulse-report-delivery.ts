import { z } from 'zod';
import type {
  BuildPulseReportRequest,
  PulseAssemblyContext,
  PulsePreparedSection,
} from './pulse-report-presentation';
export const PULSE_DELIVERY_CONTRACT = 'pulse-delivery-v1' as const;
export const PULSE_REPORT_LIFECYCLE_QUEUE = 'pulse-report-lifecycle' as const;
export const PulseLifecycleJobSchema = z
  .object({
    tenantId: z.string().uuid(),
    obligationId: z.string().uuid(),
    action: z.enum(['form', 'deliver']),
  })
  .strict();
export type PulseLifecycleJob = z.infer<typeof PulseLifecycleJobSchema>;
export type PulseObligationStatus =
  | 'observing'
  | 'assembling'
  | 'snapshot_ready'
  | 'delivering'
  | 'delivered'
  | 'pending'
  | 'blocked'
  | 'canceled'
  | 'reconciliation_required';
export interface PulseAssemblyLease {
  tenantId: string;
  obligationId: string;
  token: number;
  request: BuildPulseReportRequest;
  context: PulseAssemblyContext;
  sections: PulsePreparedSection[];
}
/** Restricted exact transport binding; never part of the recipient presentation. */
export interface PulseRecipientBinding {
  tenantId: string;
  scopeId: string;
  personId: string;
  userId: string;
  accountId: string;
  accountRevision: number;
  workspaceConnectionId: string;
  workspaceRevision: number;
  workspaceId: string;
  slackUserId: string;
  channelId: string;
  botUserId: string;
  proofId: string;
}
export type PulseRecipientCandidate = Omit<PulseRecipientBinding, 'channelId' | 'botUserId' | 'proofId'>;
export type PulseTransportOutcome =
  | { status: 'accepted'; channel: string; timestamp: string }
  | {
      status: 'definitely_not_sent';
      reason: 'local_not_invoked' | 'rate_limited' | 'provider_rejected';
      retryAfterSeconds?: number;
      retryable: boolean;
    }
  | {
      status: 'unknown';
      reason:
        | 'timeout'
        | 'network'
        | 'unverified_response'
        | 'unclassified_error'
        | 'database_ambiguity'
        | 'abandoned_attempt';
    };
export interface PulseBindingProof {
  workspaceId: string;
  botUserId: string;
  channelId: string;
  slackUserId: string;
  privateDm: true;
}
export const PulseReconciliationSchema = z
  .object({
    tenantId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    attemptId: z.string().uuid(),
    token: z.number().int().positive(),
    operator: z
      .object({
        actorId: z.string().min(1).max(128),
        tenantId: z.string().uuid(),
        snapshotId: z.string().uuid(),
        authorizationRef: z.string().min(1).max(256),
      })
      .strict(),
    reason: z.string().min(1).max(500),
    evidenceRef: z.string().min(1).max(256),
    decision: z.enum(['confirmed_delivered', 'confirmed_not_sent', 'remain_unknown']),
    evidence: z
      .object({
        kind: z.enum(['provider_receipt', 'definitive_nonpublication', 'inconclusive']),
        channel: z.string().optional(),
        timestamp: z
          .string()
          .regex(/^\d{10,}\.\d{6}$/)
          .optional(),
        bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
        ownerTerminated: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.operator.tenantId !== v.tenantId || v.operator.snapshotId !== v.snapshotId)
      c.addIssue({ code: z.ZodIssueCode.custom, message: 'operator_scope_mismatch' });
    if (
      v.decision === 'confirmed_delivered' &&
      (v.evidence.kind !== 'provider_receipt' || !v.evidence.channel || !v.evidence.timestamp)
    )
      c.addIssue({ code: z.ZodIssueCode.custom, message: 'positive_evidence_required' });
    if (
      v.decision === 'confirmed_not_sent' &&
      (v.evidence.kind !== 'definitive_nonpublication' || !v.evidence.ownerTerminated)
    )
      c.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'definitive_evidence_and_terminated_owner_required',
      });
  });
export type PulseReconciliation = z.infer<typeof PulseReconciliationSchema>;
