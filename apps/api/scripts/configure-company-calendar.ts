import { createDbClient } from '@entalent/database';
import { DatabaseService } from '../src/database/database.service';
import { CompanyCalendarError, CompanyCalendarService } from '../src/onboarding/company-calendar.service';

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
  try {
    const service = new CompanyCalendarService({ client: client.db } as DatabaseService);
    const stored = await service.configure(tenantId, input, operator);
    process.stdout.write(`${JSON.stringify({ tenantId, calendar: stored, updatedBy: operator })}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof CompanyCalendarError ? error.code
    : error instanceof Error ? error.message : 'calendar configuration failed'}\n`);
  process.exitCode = 1;
});
