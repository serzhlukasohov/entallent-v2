import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDbClient } from '../packages/database/src/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DECISION_REPORT_SQL = readFileSync(
  new URL('./typescript-conversation-decision-report.sql', import.meta.url),
  'utf8',
);

export interface DecisionReportOptions {
  tenantId: string;
  databaseUrl: string;
}

export function parseDecisionReportEnv(
  env: Record<string, string | undefined>,
): DecisionReportOptions {
  const tenantId = env['TENANT_ID']?.trim();
  if (!tenantId) throw new Error('TENANT_ID is required');
  if (!UUID_PATTERN.test(tenantId)) throw new Error('TENANT_ID must be a UUID');

  const databaseUrl = env['DATABASE_URL']?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  return { tenantId, databaseUrl };
}

export async function generateDecisionReport(
  options: DecisionReportOptions,
): Promise<unknown> {
  const { sql } = createDbClient(options.databaseUrl);
  try {
    const rows = await sql.unsafe<Array<{ report: unknown }>>(
      DECISION_REPORT_SQL,
      [options.tenantId],
    );
    const report = rows[0]?.report;
    if (!report) throw new Error('conversation decision report returned no rows');
    return report;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const options = parseDecisionReportEnv(process.env);
  const report = await generateDecisionReport(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'conversation decision report failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
