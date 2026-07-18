import { describe, it, expect } from 'vitest';
import { assertTenantActive } from './tenant';
import type { Tenant } from './tenant';
import {
  DEFAULT_RETENTION_POLICY,
  DEFAULT_PROACTIVE_MESSAGING_POLICY,
} from './tenant';

function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Acme Corp',
    status: 'active',
    timezone: 'UTC',
    locale: 'en',
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    safetyPolicy: { escalationEnabled: true, humanReviewEnabled: true },
    proactiveMessagingPolicy: DEFAULT_PROACTIVE_MESSAGING_POLICY,
    surveyConfiguration: { enabled: true },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('assertTenantActive', () => {
  it('does not throw for active tenant', () => {
    expect(() => assertTenantActive(makeTenant({ status: 'active' }))).not.toThrow();
  });

  it('throws for suspended tenant', () => {
    expect(() => assertTenantActive(makeTenant({ status: 'suspended' }))).toThrow();
  });

  it('throws for offboarded tenant', () => {
    expect(() => assertTenantActive(makeTenant({ status: 'offboarded' }))).toThrow();
  });
});
