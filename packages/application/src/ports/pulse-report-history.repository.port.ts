import type { PulseCompletedFinal } from '@entalent/contracts';
export interface PulseReportHistoryRepositoryPort {
  completed(tenantId: string, historyKey: string): Promise<PulseCompletedFinal[]>;
}
