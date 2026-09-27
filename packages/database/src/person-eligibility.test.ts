import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eligiblePulsePersonOrLegacy } from './person-eligibility';
import { users } from './schema/users';

describe('provisioned Pulse eligibility query', () => {
  it('correlates Person identity and tenant, excluding inactive and non-participant rows', () => {
    const query = new PgDialect().sqlToQuery(eligiblePulsePersonOrLegacy(users.id, users.tenantId));
    expect(query.sql).toContain('"people"."id" = "users"."id"');
    expect(query.sql).toContain('"people"."tenant_id" = "users"."tenant_id"');
    expect(query.sql).toContain('"people"."lifecycle_status" <>');
    expect(query.sql).toContain('"people"."pulse_participant" =');
    expect(query.sql).toContain("<> 'active'");
    expect(query.sql).toContain('= false');
  });
});
