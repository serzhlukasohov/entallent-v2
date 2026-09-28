import { ConfigService } from '@nestjs/config';
import { createDbClient } from '@entalent/database';
import { DatabaseService } from '../src/database/database.service';
import { HierarchyRolloutService, type LegacyEmployeeAdoption } from '../src/hierarchy/hierarchy-rollout.service';
import { SlackDirectoryService } from '../src/hierarchy/slack-directory.service';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const tenantId = required('TENANT_ID');
  const workspaceId = required('WORKSPACE_ID');
  const unitId = required('UNIT_ID');
  const operatorId = required('OPERATOR_ID');
  const adoption: LegacyEmployeeAdoption = {
    userId: required('LEGACY_USER_ID'),
    externalSlackUserId: required('LEGACY_SLACK_USER_ID'),
    unitId,
    customerEmployeeId: required('CUSTOMER_EMPLOYEE_ID'),
    workEmail: required('WORK_EMAIL'),
    displayName: required('DISPLAY_NAME'),
  };
  const apply = process.argv.includes('--apply');
  if (apply && process.env['CONFIRM_HIERARCHY_LEGACY_ROLLOUT'] !== `${tenantId}:${unitId}`) {
    throw new Error('CONFIRM_HIERARCHY_LEGACY_ROLLOUT must equal TENANT_ID:UNIT_ID');
  }
  const client = createDbClient(required('DATABASE_URL'));
  try {
    const db = { client: client.db } as DatabaseService;
    const config = { get: (name: string) => required(name) } as ConfigService;
    const directory = new SlackDirectoryService(db, config as never);
    const rollout = new HierarchyRolloutService(db, directory);
    const slackMatches = (await directory.listUsers(tenantId, workspaceId)).filter((user) =>
      !user.deleted && !user.isBot && user.email?.trim().toLowerCase() === adoption.workEmail.trim().toLowerCase());
    const rows = await client.sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      const [user] = await tx`
        SELECT id, status, deleted_at FROM users WHERE id = ${adoption.userId} AND tenant_id = ${tenantId}
      `;
      const [account] = await tx`
        SELECT id, user_id, link_status FROM channel_accounts
        WHERE tenant_id = ${tenantId} AND channel_type = 'slack'
          AND external_workspace_id = ${workspaceId} AND external_user_id = ${adoption.externalSlackUserId}
      `;
      const [person] = await tx`
        SELECT id FROM people WHERE id = ${adoption.userId} AND tenant_id = ${tenantId}
      `;
      const [unit] = await tx`
        SELECT id, lifecycle_status, manager_person_id FROM org_units
        WHERE id = ${unitId} AND tenant_id = ${tenantId}
      `;
      const [managerAccount] = unit?.manager_person_id ? await tx`
        SELECT id FROM channel_accounts WHERE tenant_id = ${tenantId} AND user_id = ${unit.manager_person_id}
          AND channel_type = 'slack' AND external_workspace_id = ${workspaceId} AND link_status = 'linked'
      ` : [];
      const [history] = await tx`
        SELECT (SELECT count(*)::int FROM conversations WHERE tenant_id = ${tenantId} AND user_id = ${adoption.userId}) AS conversations,
          (SELECT count(*)::int FROM messages WHERE tenant_id = ${tenantId} AND user_id = ${adoption.userId}) AS messages
      `;
      return { user, account, person, unit, managerAccount, history };
    });
    const identityReady = slackMatches.length === 1 && slackMatches[0]?.externalUserId === adoption.externalSlackUserId &&
      rows.user?.status === 'active' && rows.user?.deleted_at === null &&
      rows.account?.user_id === adoption.userId && rows.account?.link_status === 'linked' &&
      !rows.person && rows.unit?.lifecycle_status === 'draft' && Boolean(rows.managerAccount);
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry_run', tenantId, workspaceId,
      unitId, userId: adoption.userId, slackUserId: adoption.externalSlackUserId,
      email: adoption.workEmail.trim().toLowerCase(), slackMatchCount: slackMatches.length,
      legacyConversations: rows.history?.conversations ?? 0, legacyMessages: rows.history?.messages ?? 0,
      identityReady, graphValidation: 'runs atomically on apply' })}\n`);
    if (!identityReady) throw new Error('legacy rollout preflight failed');
    if (!apply) return;
    const result = await rollout.activateUnits(tenantId, [unitId], workspaceId,
      { type: 'internal_operator', operatorId }, [adoption]);
    process.stdout.write(`${JSON.stringify({ mode: 'applied', result })}\n`);
  } finally {
    await client.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'legacy rollout failed'}\n`);
  process.exitCode = 1;
});
