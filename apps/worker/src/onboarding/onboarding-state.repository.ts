import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { OnboardingState } from '@entalent/application';
import type { WorkCalendar } from '@entalent/contracts';
import { auditLogs, onboardingStates, people, tenantWorkCalendars, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface OnboardingStateRow {
  id: string;
  version: number;
  introChannelId: string | null;
  introActionsMessageTs: string | null;
  state: OnboardingState;
}

export interface OnboardingAuditInput {
  tenantId: string;
  actorType: 'user' | 'system';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
}

export interface OnboardingTx {
  lockState(tenantId: string, personId: string): Promise<OnboardingStateRow | null>;
  getPerson(tenantId: string, personId: string): Promise<{ role: string; timezone: string | null }>;
  getCalendar(tenantId: string): Promise<WorkCalendar | null>;
  updateState(id: string, next: OnboardingState, extra: { reminderDueAt?: Date | null; reminderSentAt?: Date }): Promise<void>;
  setProactive(tenantId: string, personId: string, enabled: boolean): Promise<void>;
  setIntroLocation(id: string, channelId: string, messageTs: string): Promise<void>;
  insertAudit(input: OnboardingAuditInput): Promise<void>;
}

export interface OnboardingStateRepositoryPort {
  transaction<T>(fn: (tx: OnboardingTx) => Promise<T>): Promise<T>;
  readState(tenantId: string, personId: string): Promise<OnboardingStateRow | null>;
}

type Row = typeof onboardingStates.$inferSelect;

function toRow(r: Row): OnboardingStateRow {
  return {
    id: r.id,
    version: r.version,
    introChannelId: r.introChannelId,
    introActionsMessageTs: r.introActionsMessageTs,
    state: {
      track: r.track as OnboardingState['track'],
      introStatus: r.introStatus as OnboardingState['introStatus'],
      participation: r.participation as OnboardingState['participation'],
      managementAckAt: r.managementAckAt,
      completedAt: r.completedAt,
      reminderStatus: r.reminderStatus as OnboardingState['reminderStatus'],
      reminderOriginAt: r.reminderOriginAt,
      buttonsActive: r.buttonsActive,
    },
  };
}

@Injectable()
export class OnboardingStateRepository implements OnboardingStateRepositoryPort {
  constructor(private readonly db: DatabaseService) {}

  async readState(tenantId: string, personId: string): Promise<OnboardingStateRow | null> {
    const [r] = await this.db.client.select().from(onboardingStates).where(and(
      eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId))).limit(1);
    return r ? toRow(r) : null;
  }

  transaction<T>(fn: (tx: OnboardingTx) => Promise<T>): Promise<T> {
    return this.db.client.transaction(async (dbTx) => fn({
      async lockState(tenantId, personId) {
        const [r] = await dbTx.select().from(onboardingStates).where(and(
          eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId)))
          .limit(1).for('update');
        return r ? toRow(r) : null;
      },
      async getPerson(tenantId, personId) {
        const [r] = await dbTx.select({ role: people.primaryRole, timezone: users.timezone })
          .from(people).innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
          .where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).limit(1);
        if (!r) throw new Error('onboarding_person_not_found');
        return r;
      },
      async getCalendar(tenantId) {
        const [r] = await dbTx.select().from(tenantWorkCalendars).where(eq(tenantWorkCalendars.tenantId, tenantId)).limit(1);
        return r ? { timezone: r.timezone, workingDays: r.workingDays, workStart: r.workStart, workEnd: r.workEnd } : null;
      },
      async updateState(id, next, extra) {
        const now = new Date();
        await dbTx.update(onboardingStates).set({
          track: next.track, introStatus: next.introStatus, participation: next.participation,
          managementAckAt: next.managementAckAt, completedAt: next.completedAt,
          reminderStatus: next.reminderStatus, reminderOriginAt: next.reminderOriginAt,
          buttonsActive: next.buttonsActive,
          ...(extra.reminderDueAt !== undefined ? { reminderDueAt: extra.reminderDueAt } : {}),
          ...(extra.reminderSentAt ? { reminderSentAt: extra.reminderSentAt } : {}),
          version: sql`${onboardingStates.version} + 1`,
          updatedAt: now,
        }).where(eq(onboardingStates.id, id));
      },
      async setProactive(tenantId, personId, enabled) {
        await dbTx.update(users).set({ proactiveMessagingEnabled: enabled, updatedAt: new Date() })
          .where(and(eq(users.id, personId), eq(users.tenantId, tenantId)));
      },
      async setIntroLocation(id, channelId, messageTs) {
        await dbTx.update(onboardingStates).set({
          introChannelId: channelId, introActionsMessageTs: messageTs, updatedAt: new Date(),
        }).where(eq(onboardingStates.id, id));
      },
      async insertAudit(input) {
        await dbTx.insert(auditLogs).values(input);
      },
    }));
  }
}
