import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { people } from './schema/people';

/** Legacy users have no Person row; provisioned users require active Pulse eligibility. */
export function eligiblePulsePersonOrLegacy(userId: SQLWrapper, tenantId: SQLWrapper): SQL {
  return sql`not exists (
    select 1 from ${people}
    where ${people.id} = ${userId}
      and ${people.tenantId} = ${tenantId}
      and (${people.lifecycleStatus} <> 'active' or ${people.pulseParticipant} = false)
  )`;
}
