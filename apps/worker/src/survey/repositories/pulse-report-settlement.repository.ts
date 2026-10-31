import { Injectable } from '@nestjs/common';
import type { PulseInputRequest } from '@entalent/contracts';
import type { PulseReportSettlementRepositoryPort } from '@entalent/application';
import { observePulseInputFrontier, withPulseReportSerializableRetry } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';
@Injectable()
export class PulseReportSettlementRepository implements PulseReportSettlementRepositoryPort {
  constructor(private readonly db: DatabaseService) {}
  observe(input: PulseInputRequest) {
    return withPulseReportSerializableRetry(() =>
      this.db.client.transaction((tx) => observePulseInputFrontier(tx, input), {
        isolationLevel: 'read committed',
      }),
    );
  }
}
