import type { PulseInputRequest, PulseSettlementResult } from '@entalent/contracts';
import type { PulseReportSettlementRepositoryPort } from '../ports/pulse-report-settlement.repository.port';
/** Deliberately has no processing, queue or provider dependency. */
export class SettlePulseReportInputsUseCase {
  constructor(private readonly repository: PulseReportSettlementRepositoryPort) {}
  execute(input: PulseInputRequest): Promise<PulseSettlementResult> {
    return this.repository.observe(input);
  }
}
