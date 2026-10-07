import { createDbClient } from '@entalent/database';
import { DatabaseService } from '../src/database/database.service';
import { CompanyCalendarError } from '../src/onboarding/company-calendar.service';
import { buildCalendarService } from '../src/onboarding/build-calendar-service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const tenantId = required('tenant');
  const operator = required('operator');
  const input = {
    timezone: required('timezone'),
    workingDays: required('days').split(',').map((day) => Number(day.trim())),
    workStart: required('start'),
    workEnd: required('end'),
  };
  const databaseUrl = process.env['DATABASE_URL']?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = createDbClient(databaseUrl);
  const { service, close, warning } = buildCalendarService(
    { client: client.db } as DatabaseService, { REDIS_URL: process.env['REDIS_URL'] });
  if (warning) process.stderr.write(`warning: ${warning}\n`);
  try {
    const { calendar, recalculation } = await service.configure(tenantId, input, operator);
    if (recalculation !== 'queued') {
      process.stderr.write(`warning: calendar saved but scheduled reminders were not recalculated (${recalculation}); re-run after fixing Redis/queue access\n`);
    }
    process.stdout.write(`${JSON.stringify({ tenantId, calendar, updatedBy: operator, recalculation })}\n`);
  } finally {
    await close();
    await client.sql.end();
  }
}

// Exit explicitly: a dead Redis connection would otherwise keep reconnecting and hold the process open.
main().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error instanceof CompanyCalendarError ? error.code
    : error instanceof Error ? error.message : 'calendar configuration failed'}\n`);
  process.exit(1);
});
