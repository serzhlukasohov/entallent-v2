import type {
  PulseBindingProof,
  PulseRecipientCandidate,
  PulseTransportOutcome,
  PulseReconciliation,
} from '@entalent/contracts';
export interface PulseReportTransportPort {
  prove(
    input: PulseRecipientCandidate,
    credential: string,
    existingChannelId?: string,
  ): Promise<PulseBindingProof | null>;
  post(credential: string, channelId: string, body: unknown): Promise<PulseTransportOutcome>;
}
export interface PulseReportDeliveryPort {
  deliverNext(tenantId: string, snapshotId: string): Promise<{ status: string }>;
  reconcile(command: PulseReconciliation): Promise<{ status: string }>;
}
