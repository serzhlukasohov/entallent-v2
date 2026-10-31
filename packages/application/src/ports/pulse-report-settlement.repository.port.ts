import type { PulseInputRequest, PulseSettlementResult } from '@entalent/contracts';
export interface PulseReportSettlementRepositoryPort {
  observe(input: PulseInputRequest): Promise<PulseSettlementResult>;
}
