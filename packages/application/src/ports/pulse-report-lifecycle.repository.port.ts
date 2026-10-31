import type { BuildPulseReportRequest, PulseAssemblyLease } from '@entalent/contracts';
export interface PulseReportLifecycleRepositoryPort {
  observe(request: BuildPulseReportRequest): Promise<{ status: string; obligationId?: string }>;
  claim(tenantId: string, obligationId: string): Promise<PulseAssemblyLease | null>;
  load(tenantId: string, obligationId: string, token: number): Promise<PulseAssemblyLease | null>;
  readonly renewalIntervalMs?: number;
  renew?(lease: PulseAssemblyLease): Promise<boolean>;
  validate(lease: PulseAssemblyLease): Promise<boolean>;
  rebaseHistory?(lease: PulseAssemblyLease): Promise<PulseAssemblyLease | null>;
  defer(lease: PulseAssemblyLease, reason: string): Promise<void>;
}
