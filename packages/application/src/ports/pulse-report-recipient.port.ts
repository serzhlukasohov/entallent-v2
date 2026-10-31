import type {
  PulseRecipientBinding,
  PulseRecipientCandidate,
  PulseBindingProof,
} from '@entalent/contracts';
export interface PulseReportRecipientPort {
  resolve(tenantId: string, scopeId: string): Promise<PulseRecipientCandidate | null>;
  verify(
    candidate: PulseRecipientCandidate,
    proof: PulseBindingProof,
  ): Promise<PulseRecipientBinding | null>;
}
