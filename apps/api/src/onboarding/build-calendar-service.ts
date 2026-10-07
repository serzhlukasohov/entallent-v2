import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@entalent/contracts';
import type { DatabaseService } from '../database/database.service';
import { CompanyCalendarService } from './company-calendar.service';
import { BullOnboardingReminderRecalculator } from './onboarding-reminder-recalculator';

/** Same connection parsing as the API's QueueModule. */
export function redisConnectionFromUrl(redisUrl: string) {
  const url = new URL(redisUrl);
  const raw = url.pathname.slice(1);
  const db = raw ? Number(raw) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error('invalid_redis_database');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    db,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

const RECALCULATION_TIMEOUT_MS = 5_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export interface BuiltCalendarService {
  service: CompanyCalendarService;
  /** Closes the queue connection (no-op without Redis). */
  close(): Promise<void>;
  /** Set when reminders cannot be recalculated from this process. */
  warning?: string;
}

/** Operator CLI wiring: the real recalculator when REDIS_URL is set, otherwise 'skipped' with a warning. */
export function buildCalendarService(
  db: DatabaseService, env: { REDIS_URL?: string | undefined },
): BuiltCalendarService {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) {
    return { service: new CompanyCalendarService(db), close: async () => undefined,
      warning: 'REDIS_URL is not set; scheduled onboarding reminders will not be recalculated' };
  }
  const queue = new Queue(QUEUE_NAMES.ONBOARDING_REMINDER, { connection: redisConnectionFromUrl(redisUrl) });
  queue.on('error', () => undefined); // surfaced through the bounded add below instead of unhandled events
  const inner = new BullOnboardingReminderRecalculator(queue as never);
  // BullMQ retries a dead Redis forever; an operator CLI must give up and report 'failed'.
  const recalculator = {
    recalculateScheduledReminders: (tenantId: string) => withTimeout(
      inner.recalculateScheduledReminders(tenantId), RECALCULATION_TIMEOUT_MS, 'recalculation_queue_timeout'),
  };
  return {
    service: new CompanyCalendarService(db, recalculator),
    close: async () => {
      await withTimeout(queue.close(), 2_000, 'queue_close_timeout').catch(() => queue.disconnect().catch(() => undefined));
    },
  };
}
