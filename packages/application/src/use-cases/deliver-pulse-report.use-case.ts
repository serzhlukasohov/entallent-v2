import type { PulseReportDeliveryPort } from '../ports/pulse-report-delivery.port';
export class DeliverPulseReportUseCase {
  constructor(private readonly delivery: PulseReportDeliveryPort) {}
  execute(tenantId: string, snapshotId: string) {
    return this.delivery.deliverNext(tenantId, snapshotId);
  }
}
