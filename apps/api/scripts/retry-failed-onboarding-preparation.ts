import { createDbClient } from '@entalent/database';
import { retryFailedOnboardingPreparation } from '../src/hierarchy/onboarding-reconciliation';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const tenantId = required('TENANT_ID');
  const unitId = required('UNIT_ID');
  const expectedPersonIds = required('EXPECTED_PERSON_IDS').split(',').map((id) => id.trim());
  const apply = process.argv.includes('--apply');
  if (apply && process.env['CONFIRM_FAILED_ONBOARDING_RETRY'] !== `${tenantId}:${unitId}`) {
    throw new Error('CONFIRM_FAILED_ONBOARDING_RETRY must equal TENANT_ID:UNIT_ID');
  }
  const operatorId = apply ? required('OPERATOR_ID') : undefined;
  const client = createDbClient(required('DATABASE_URL'));
  try {
    const result = await retryFailedOnboardingPreparation(client.db, tenantId, unitId,
      expectedPersonIds, { apply, operatorId });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'retry failed'}\n`);
  process.exitCode = 1;
});
