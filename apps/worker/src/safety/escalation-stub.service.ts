import { Injectable, Inject, Logger } from '@nestjs/common';
import type { EscalationPort, EscalationEvent, AuditLogPort } from '@entalent/application';

export const AUDIT_LOG_PORT = 'AUDIT_LOG_PORT';

/**
 * Stub escalation handler: logs the event and writes an audit entry.
 * Replace with real notification delivery (email, PagerDuty, webhook) in production.
 */
@Injectable()
export class EscalationStubService implements EscalationPort {
  private readonly logger = new Logger(EscalationStubService.name);

  constructor(@Inject(AUDIT_LOG_PORT) private readonly auditLog: AuditLogPort) {}

  async raise(event: EscalationEvent): Promise<void> {
    this.logger.warn(
      `ESCALATION REQUIRED — severity=${event.severity} type=${event.riskType} userId=${event.userId} [${event.traceId}]`,
    );

    await this.auditLog.append({
      tenantId: event.tenantId,
      actorType: 'system',
      actorId: 'safety-policy-engine',
      action: 'escalation.raised',
      resourceType: 'user',
      resourceId: event.userId,
      reason: `Risk detected: ${event.riskType ?? 'unknown'} — severity: ${event.severity}`,
      metadata: {
        riskType: event.riskType,
        severity: event.severity,
        messageIds: event.messageIds,
        details: event.details,
      },
      traceId: event.traceId,
    });
  }
}
