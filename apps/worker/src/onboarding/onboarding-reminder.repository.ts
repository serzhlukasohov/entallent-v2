import { Injectable } from '@nestjs/common';
import { and, eq, max } from 'drizzle-orm';
import type { WorkCalendar } from '@entalent/contracts';
import { messages, onboardingStates, people, tenantWorkCalendars, users } from '@entalent/database';
import { DatabaseService } from '../database/database.service';

export interface ReminderContext {
  stateId: string;
  track: string;
  participation: string;
  reminderStatus: string;
  reminderDueAt: Date | null;
  introActionsMessageTs: string | null;
  userStatus: string;
  deletedAt: Date | null;
  personLifecycle: string;
  userTimezone: string | null;
  calendar: WorkCalendar | null;
  lastInboundAt: Date | null;
}

export interface ScheduledReminderRow {
  stateId: string;
  personId: string;
  reminderOriginAt: Date;
  reminderDueAt: Date;
  userTimezone: string | null;
}

@Injectable()
export class OnboardingReminderRepository {
  constructor(private readonly db: DatabaseService) {}

  async getCalendar(tenantId: string): Promise<WorkCalendar | null> {
    const [r] = await this.db.client.select().from(tenantWorkCalendars)
      .where(eq(tenantWorkCalendars.tenantId, tenantId)).limit(1);
    return r ? { timezone: r.timezone, workingDays: r.workingDays, workStart: r.workStart, workEnd: r.workEnd } : null;
  }

  async loadContext(tenantId: string, personId: string): Promise<ReminderContext | null> {
    const [r] = await this.db.client.select({
      stateId: onboardingStates.id, track: onboardingStates.track, participation: onboardingStates.participation,
      reminderStatus: onboardingStates.reminderStatus, reminderDueAt: onboardingStates.reminderDueAt,
      introActionsMessageTs: onboardingStates.introActionsMessageTs,
      userStatus: users.status, deletedAt: users.deletedAt, userTimezone: users.timezone,
      personLifecycle: people.lifecycleStatus,
    }).from(onboardingStates)
      .innerJoin(people, and(eq(people.id, onboardingStates.personId), eq(people.tenantId, onboardingStates.tenantId)))
      .innerJoin(users, and(eq(users.id, people.id), eq(users.tenantId, people.tenantId)))
      .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId))).limit(1);
    if (!r) return null;
    const [last] = await this.db.client.select({ at: max(messages.occurredAt) }).from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.userId, personId), eq(messages.direction, 'inbound')));
    return { ...r, calendar: await this.getCalendar(tenantId), lastInboundAt: last?.at ?? null };
  }

  async listScheduled(tenantId: string): Promise<{ calendar: WorkCalendar | null; rows: ScheduledReminderRow[] }> {
    const calendar = await this.getCalendar(tenantId);
    if (!calendar) return { calendar, rows: [] };
    const rows = await this.db.client.select({
      stateId: onboardingStates.id, personId: onboardingStates.personId,
      reminderOriginAt: onboardingStates.reminderOriginAt, reminderDueAt: onboardingStates.reminderDueAt,
      userTimezone: users.timezone,
    }).from(onboardingStates)
      .innerJoin(users, and(eq(users.id, onboardingStates.personId), eq(users.tenantId, onboardingStates.tenantId)))
      .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.reminderStatus, 'scheduled')));
    return {
      calendar,
      rows: rows.filter((r): r is ScheduledReminderRow => r.reminderOriginAt !== null && r.reminderDueAt !== null),
    };
  }

  /** Moves a still-scheduled reminder; false when it was sent, cancelled or rescheduled meanwhile. */
  async updateScheduledDue(stateId: string, dueAt: Date, expectedDueAt: Date): Promise<boolean> {
    const updated = await this.db.client.update(onboardingStates)
      .set({ reminderDueAt: dueAt, updatedAt: new Date() })
      .where(and(eq(onboardingStates.id, stateId), eq(onboardingStates.reminderStatus, 'scheduled'),
        eq(onboardingStates.reminderDueAt, expectedDueAt)))
      .returning({ id: onboardingStates.id });
    return updated.length === 1;
  }
}
