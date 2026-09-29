import { describe, expect, it, vi } from 'vitest';
import type { AuditLogPort, EscalationEvent } from '@entalent/application';
import { EscalationStubService } from './escalation-stub.service';

const event: EscalationEvent = {
  type: 'risk_detected',
  severity: 'critical',
  tenantId: 'tenant-1',
  userId: 'user-1',
  riskType: 'potential_self_harm',
  messageIds: ['inbound-1'],
  traceId: 'trace-1',
};

describe('EscalationStubService', () => {
  it('warns only after a new audit entry, keyed by inbound message', async () => {
    const append = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const service = new EscalationStubService({ append } as AuditLogPort);
    const warn = vi.spyOn((service as never as { logger: { warn: (message: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await service.raise(event);
    await service.raise(event);
    await service.raise({ ...event, messageIds: ['inbound-2'] });

    expect(append).toHaveBeenCalledTimes(3);
    expect(append.mock.calls.map(([params]) => params.idempotencyKey))
      .toEqual(['risk:inbound-1', 'risk:inbound-1', 'risk:inbound-2']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('propagates an audit failure so the same inbound can be retried', async () => {
    const append = vi.fn().mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(true);
    const service = new EscalationStubService({ append } as AuditLogPort);
    const warn = vi.spyOn((service as never as { logger: { warn: (message: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.raise(event)).rejects.toThrow('database unavailable');
    expect(warn).not.toHaveBeenCalled();
    await expect(service.raise(event)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
