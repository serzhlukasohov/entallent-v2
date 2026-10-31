/** Explicit offline reconciliation. Never performs provider/model/Slack lookups or loads .env. */
import { readFile } from 'node:fs/promises';
import { createDbClient } from '@entalent/database';
import { PulseReconciliationSchema } from '@entalent/contracts';
import { PulseReportDeliveryRepository } from '../apps/worker/src/survey/repositories/pulse-report-delivery.repository';
import { PulseReportPresentationRepository } from '../apps/worker/src/survey/repositories/pulse-report-presentation.repository';
import { PulseReportRecipientRepository } from '../apps/worker/src/survey/repositories/pulse-report-recipient.repository';
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--enable-offline-reconciliation')
    throw Error('explicit_local_reconciliation_and_evidence_file_required');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw Error('explicit_DATABASE_URL_required');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw Error('local_operator_only_nonlocal_database_requires_separate_approval');
  const command = PulseReconciliationSchema.parse(JSON.parse(await readFile(args[1]!, 'utf8')));
  const client = createDbClient(raw),
    database = { client: client.db };
  try {
    const recipients = new PulseReportRecipientRepository(database as never, () => {
      throw Error('provider_credentials_unavailable_to_reconciliation');
    });
    const transport = {
      prove: async () => {
        throw Error('offline_only');
      },
      post: async () => {
        throw Error('offline_only');
      },
    };
    const repository = new PulseReportDeliveryRepository(
      database as never,
      new PulseReportPresentationRepository(database as never),
      recipients,
      transport,
      true,
    );
    const result = await repository.reconcile(command);
    process.stdout.write(
      JSON.stringify({
        status: result.status,
        tenantId: command.tenantId,
        snapshotId: command.snapshotId,
        attemptId: command.attemptId,
      }) + '\n',
    );
  } finally {
    await client.sql.end();
  }
}
if (process.argv[1]?.endsWith('reconcile-pulse-report-delivery.ts'))
  main().catch(() => {
    process.stderr.write('{"status":"reconciliation_rejected"}\n');
    process.exitCode = 1;
  });
