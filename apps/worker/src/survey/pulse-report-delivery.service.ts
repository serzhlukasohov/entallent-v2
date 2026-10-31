import {
  PulseReportDeliveryRepository,
  type PulseDeliveryActivationGuard,
} from './repositories/pulse-report-delivery.repository';
/** Explicit native operation; registration alone never sends. */
export class PulseReportDeliveryService {
  constructor(private readonly repository: PulseReportDeliveryRepository) {}
  deliverNext(tenantId: string, snapshotId: string, guard?: PulseDeliveryActivationGuard) {
    return this.repository.deliverNext(tenantId, snapshotId, guard);
  }
  /** Runs RPT-07 fences on a held snapshot without claiming it. */
  fence(tenantId: string, snapshotId: string) {
    return this.repository.fence(tenantId, snapshotId);
  }
}
