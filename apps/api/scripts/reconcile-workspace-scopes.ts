import { createDbClient } from '@entalent/database';
import { decryptField } from '@entalent/crypto-utils';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const tenantId = required('TENANT_ID');
  const workspaceId = required('WORKSPACE_ID');
  const apply = process.argv.includes('--apply');
  if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply')) throw new Error('unknown_argument');
  if (apply && process.env['CONFIRM_SCOPE_RECONCILIATION'] !== `${tenantId}:${workspaceId}`) {
    throw new Error('CONFIRM_SCOPE_RECONCILIATION must equal TENANT_ID:WORKSPACE_ID');
  }
  const operatorId = apply ? required('OPERATOR_ID') : undefined;
  const client = createDbClient(required('DATABASE_URL'));
  try {
    const [connection] = await client.sql`SELECT id, encrypted_credentials, scopes, status
      FROM workspace_connections WHERE tenant_id = ${tenantId} AND channel_type = 'slack'
        AND external_workspace_id = ${workspaceId}`;
    if (!connection || connection.status !== 'active') throw new Error('workspace_connection_missing_or_inactive');
    const credentials = JSON.parse(decryptField(connection.encrypted_credentials,
      required('FIELD_ENCRYPTION_KEY'))) as { botToken?: string };
    if (!credentials.botToken) throw new Error('bot_token_missing');
    const response = await fetch('https://slack.com/api/auth.test', {
      headers: { Authorization: `Bearer ${credentials.botToken}` },
    });
    const result = await response.json() as { ok?: boolean; team_id?: string };
    const scopes = response.headers.get('x-oauth-scopes')?.split(',').map((scope) => scope.trim())
      .filter(Boolean).sort();
    if (!response.ok || !result.ok || result.team_id !== workspaceId || !scopes?.length) {
      throw new Error('slack_scope_verification_failed');
    }
    const before = Array.isArray(connection.scopes) ? connection.scopes : [];
    const changed = JSON.stringify([...before].sort()) !== JSON.stringify(scopes);
    if (apply && changed) {
      await client.sql.begin(async (tx) => {
        const [locked] = await tx`SELECT encrypted_credentials, scopes, status FROM workspace_connections
          WHERE id = ${connection.id} AND tenant_id = ${tenantId} AND external_workspace_id = ${workspaceId}
          FOR UPDATE`;
        if (!locked || locked.status !== 'active' ||
          locked.encrypted_credentials !== connection.encrypted_credentials ||
          JSON.stringify(locked.scopes) !== JSON.stringify(connection.scopes)) {
          throw new Error('workspace_connection_changed');
        }
        await tx`UPDATE workspace_connections SET scopes = ${JSON.stringify(scopes)}::jsonb,
          last_validated_at = now() WHERE id = ${connection.id}`;
        await tx`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action,
          resource_type, resource_id, metadata) VALUES (${tenantId}, 'internal_operator',
          ${operatorId!}, 'workspace.scopes.reconcile', 'workspace_connection', ${connection.id},
          ${JSON.stringify({ workspaceId, before, after: scopes })}::jsonb)`;
      });
    }
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry_run', tenantId,
      workspaceId, before, verifiedScopes: scopes, changed })}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'scope reconciliation failed'}\n`);
  process.exitCode = 1;
});
