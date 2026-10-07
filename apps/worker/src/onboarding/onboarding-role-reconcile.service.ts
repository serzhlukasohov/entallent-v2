import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { OnboardingTrack, PrimaryOrgRole } from '@entalent/application';
import { onboardingStates, people, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';
import { OnboardingService } from './onboarding.service';

const RECONCILE_LIMIT = 50;

/** A role that stands for a stored track; only its track matters to the decider. */
const REPRESENTATIVE_ROLE: Record<OnboardingTrack, PrimaryOrgRole> = {
  employee: 'employee', team_lead: 'team_lead', management: 'manager',
};

/**
 * Backstop for role changes whose system job was lost (crash between the hierarchy commit and the enqueue):
 * active people whose stored onboarding track disagrees with their primary role get a `role_changed` event.
 * Once applied the track matches, so a later sweep finds nothing.
 */
@Injectable()
export class OnboardingRoleReconcileService {
  private readonly logger = new Logger(OnboardingRoleReconcileService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly onboarding: OnboardingService,
  ) {}

  async sweep(tenantId?: string): Promise<{ found: number; reconciled: number; failed: number }> {
    const expectedTrack = sql<string>`CASE ${people.primaryRole}
      WHEN 'employee' THEN 'employee' WHEN 'team_lead' THEN 'team_lead' ELSE 'management' END`;
    const rows = await this.db.client.select({
      tenantId: onboardingStates.tenantId, personId: onboardingStates.personId,
      track: onboardingStates.track, primaryRole: people.primaryRole,
    }).from(onboardingStates)
      .innerJoin(people, and(eq(people.id, onboardingStates.personId), eq(people.tenantId, onboardingStates.tenantId)))
      .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .where(and(
        eq(people.lifecycleStatus, 'active'),
        eq(users.status, 'active'),
        sql`${onboardingStates.track} <> ${expectedTrack}`,
        ...(tenantId ? [eq(onboardingStates.tenantId, tenantId)] : []),
      )).limit(RECONCILE_LIMIT);
    let reconciled = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await this.onboarding.apply(row.tenantId, row.personId, {
          type: 'role_changed', from: REPRESENTATIVE_ROLE[row.track as OnboardingTrack],
          to: row.primaryRole as PrimaryOrgRole, at: new Date(),
        });
        if (result.changed) reconciled += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Onboarding role reconcile failed person=${row.personId}: ${(error as Error).message}`);
      }
    }
    return { found: rows.length, reconciled, failed };
  }
}
