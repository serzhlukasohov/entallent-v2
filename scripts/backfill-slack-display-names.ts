import { and, eq, isNull, or, type SQL } from 'drizzle-orm';
import { resolveExternalProfileFacts } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import { decryptField } from '@entalent/crypto-utils';
import {
  auditLogs,
  channelAccounts,
  createDbClient,
  users,
  workspaceConnections,
} from '@entalent/database';

type OutputMode = 'text' | 'json';
type BackfillActionStatus = 'planned' | 'updated' | 'skipped' | 'failed';

export interface BackfillOptions {
  databaseUrl: string;
  encryptionKey: string;
  tenantId: string;
  dryRun: boolean;
  output: OutputMode;
  limit?: number;
  userId?: string;
  externalWorkspaceId?: string;
}

export interface AccountCandidate {
  userId: string;
  externalWorkspaceId: string;
  externalUserId: string;
  userPreferredName: string | null;
}

interface ProfileMetadataForWrite {
  email?: string;
  avatarUrl?: string;
  locale?: string;
}

export interface BackfillAction {
  userId: string;
  externalWorkspaceId: string;
  externalUserId: string;
  status: BackfillActionStatus;
  displayName?: string;
  preferredNameChanged?: boolean;
  reason?: string;
}

interface ResolvedBackfillAction extends BackfillAction {
  preferredName?: string;
  profileMetadata?: ProfileMetadataForWrite;
}

export interface BackfillSummary {
  tenantId: string;
  dryRun: boolean;
  scanned: number;
  planned: number;
  updated: number;
  skipped: number;
  failed: number;
  filters: {
    limit?: number;
    userId?: string;
    externalWorkspaceId?: string;
  };
  actions: BackfillAction[];
}

export function parseBackfillOptions(env: NodeJS.ProcessEnv): BackfillOptions {
  const databaseUrl = requireEnv(env, 'DATABASE_URL');
  const encryptionKey = requireEnv(env, 'FIELD_ENCRYPTION_KEY');
  const tenantId = normalizeOptionalString(env['TENANT_ID']);
  if (!tenantId) {
    throw new Error('TENANT_ID is required. Do not rely on DEFAULT_TENANT_ID for production backfills.');
  }

  const limit = parseOptionalPositiveInteger(env['BACKFILL_LIMIT'], 'BACKFILL_LIMIT');
  const output = parseOutputMode(env['BACKFILL_OUTPUT']);
  const dryRun = env['BACKFILL_SLACK_DISPLAY_NAMES_APPLY'] !== '1';

  return {
    databaseUrl,
    encryptionKey,
    tenantId,
    dryRun,
    output,
    ...(limit !== undefined ? { limit } : {}),
    ...optionalStringProperty('userId', env['BACKFILL_USER_ID']),
    ...optionalStringProperty('externalWorkspaceId', env['BACKFILL_WORKSPACE_ID']),
  };
}

export function buildBackfillAuditMetadata(summary: BackfillSummary): Record<string, unknown> {
  const failedActions = summary.actions.filter((action) => action.status === 'failed');

  return {
    dryRun: summary.dryRun,
    scanned: summary.scanned,
    planned: summary.planned,
    updated: summary.updated,
    skipped: summary.skipped,
    failed: summary.failed,
    filters: summary.filters,
    failureSamples: failedActions.slice(0, 10).map((action) => ({
      status: action.status,
      ...(action.reason ? { reason: sanitizeOperationalMessage(action.reason) } : {}),
    })),
  };
}

export function buildBackfillSummary(
  options: Pick<BackfillOptions, 'tenantId' | 'dryRun' | 'limit' | 'userId' | 'externalWorkspaceId'>,
  scanned: number,
  actions: BackfillAction[],
): BackfillSummary {
  return {
    tenantId: options.tenantId,
    dryRun: options.dryRun,
    scanned,
    planned: actions.filter((action) => action.status === 'planned').length,
    updated: actions.filter((action) => action.status === 'updated').length,
    skipped: actions.filter((action) => action.status === 'skipped').length,
    failed: actions.filter((action) => action.status === 'failed').length,
    filters: {
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.externalWorkspaceId ? { externalWorkspaceId: options.externalWorkspaceId } : {}),
    },
    actions,
  };
}

async function main(): Promise<void> {
  const options = parseBackfillOptions(process.env);
  const { db, sql } = createDbClient(options.databaseUrl);

  try {
    const accounts = await loadAccountCandidates(db, options);
    const tokenByWorkspace = await loadSlackBotTokens(db, options);
    const actions: ResolvedBackfillAction[] = [];

    for (const account of accounts) {
      const botToken = tokenByWorkspace.get(account.externalWorkspaceId);
      if (!botToken) {
        actions.push({
          ...account,
          status: 'skipped',
          reason: 'missing_active_workspace_bot_token',
        });
        continue;
      }

      try {
        const profile = await new SlackAdapter({ botToken }).getUserProfile(
          account.externalWorkspaceId,
          account.externalUserId,
        );
        const profileFacts = resolveExternalProfileFacts(
          {
            externalUserId: account.externalUserId,
            displayName: profile.displayName,
          },
          { preferredName: account.userPreferredName },
        );

        if (!profileFacts.displayName) {
          actions.push({
            ...account,
            status: 'skipped',
            reason: 'no_usable_external_display_name',
          });
          continue;
        }

        actions.push({
          ...account,
          status: options.dryRun ? 'planned' : 'updated',
          displayName: profileFacts.displayName,
          ...(profileFacts.preferredName ? { preferredName: profileFacts.preferredName } : {}),
          profileMetadata: {
            ...(profile.email ? { email: profile.email } : {}),
            ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
            ...(profile.locale ? { locale: profile.locale } : {}),
          },
          preferredNameChanged: Boolean(profileFacts.preferredName),
        });
      } catch (error) {
        actions.push({
          ...account,
          status: options.dryRun ? 'skipped' : 'failed',
          reason: sanitizeOperationalMessage(error instanceof Error ? error.message : String(error)),
        });
      }
    }

    const publicActions = actions.map(toPublicAction);
    const summary = buildBackfillSummary(options, accounts.length, publicActions);
    if (!options.dryRun) {
      await db.transaction(async (tx) => {
        await applyBackfillUpdates(tx, options, actions);
        await appendAuditLog(tx, summary);
      });
    }

    writeSummary(summary, options.output);
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

async function loadAccountCandidates(
  db: ReturnType<typeof createDbClient>['db'],
  options: BackfillOptions,
): Promise<AccountCandidate[]> {
  const predicates = [
    eq(channelAccounts.tenantId, options.tenantId),
    eq(channelAccounts.channelType, 'slack'),
    or(isNull(channelAccounts.displayName), isNull(users.preferredName)),
  ];
  if (options.userId) {
    predicates.push(eq(channelAccounts.userId, options.userId));
  }
  if (options.externalWorkspaceId) {
    predicates.push(eq(channelAccounts.externalWorkspaceId, options.externalWorkspaceId));
  }

  const query = db
    .select({
      userId: channelAccounts.userId,
      externalWorkspaceId: channelAccounts.externalWorkspaceId,
      externalUserId: channelAccounts.externalUserId,
      userPreferredName: users.preferredName,
    })
    .from(channelAccounts)
    .innerJoin(
      users,
      and(eq(users.id, channelAccounts.userId), eq(users.tenantId, channelAccounts.tenantId)),
    )
    .where(and(...predicates));

  return options.limit !== undefined ? query.limit(options.limit) : query;
}

async function loadSlackBotTokens(
  db: ReturnType<typeof createDbClient>['db'],
  options: BackfillOptions,
): Promise<Map<string, string>> {
  const predicates = [
    eq(workspaceConnections.tenantId, options.tenantId),
    eq(workspaceConnections.channelType, 'slack'),
    eq(workspaceConnections.status, 'active'),
  ];
  if (options.externalWorkspaceId) {
    predicates.push(eq(workspaceConnections.externalWorkspaceId, options.externalWorkspaceId));
  }

  const connections = await db
    .select({
      externalWorkspaceId: workspaceConnections.externalWorkspaceId,
      encryptedCredentials: workspaceConnections.encryptedCredentials,
    })
    .from(workspaceConnections)
    .where(and(...predicates));

  const tokenByWorkspace = new Map<string, string>();
  for (const connection of connections) {
    try {
      const credentials = JSON.parse(
        decryptField(connection.encryptedCredentials, options.encryptionKey),
      ) as {
        botToken?: string;
      };
      if (credentials.botToken) {
        tokenByWorkspace.set(connection.externalWorkspaceId, credentials.botToken);
      }
    } catch (error) {
      throw new Error(
        `failed_to_decrypt_slack_workspace_credentials:${connection.externalWorkspaceId}:${sanitizeOperationalMessage(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }
  return tokenByWorkspace;
}

export function buildExactAccountScope(tenantId: string, account: AccountCandidate) {
  return {
    tenantId,
    userId: account.userId,
    channelType: 'slack',
    externalWorkspaceId: account.externalWorkspaceId,
    externalUserId: account.externalUserId,
  } as const;
}

export function buildExactAccountPredicates(tenantId: string, account: AccountCandidate): SQL[] {
  const scope = buildExactAccountScope(tenantId, account);
  return [
    eq(channelAccounts.tenantId, scope.tenantId),
    eq(channelAccounts.userId, scope.userId),
    eq(channelAccounts.channelType, scope.channelType),
    eq(channelAccounts.externalWorkspaceId, scope.externalWorkspaceId),
    eq(channelAccounts.externalUserId, scope.externalUserId),
  ];
}

async function appendAuditLog(
  db: Pick<ReturnType<typeof createDbClient>['db'], 'insert'>,
  summary: BackfillSummary,
): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: summary.tenantId,
    actorType: 'admin',
    actorId: 'script:backfill-slack-display-names',
    action: 'slack_display_name_backfill',
    resourceType: 'channel_account',
    resourceId: summary.filters.externalWorkspaceId ?? summary.tenantId,
    reason: 'manual_slack_display_name_backfill',
    metadata: buildBackfillAuditMetadata(summary),
    traceId: `slack-display-name-backfill:${new Date().toISOString()}`,
  });
}

async function applyBackfillUpdates(
  db: Pick<ReturnType<typeof createDbClient>['db'], 'update'>,
  options: BackfillOptions,
  actions: ResolvedBackfillAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.status !== 'updated' || !action.displayName) continue;

    const updatedAccounts = await db
      .update(channelAccounts)
      .set({
        displayName: action.displayName,
        profileMetadata: action.profileMetadata ?? {},
        updatedAt: new Date(),
      })
      .where(and(...buildExactAccountPredicates(options.tenantId, action)))
      .returning({ id: channelAccounts.id });

    if (updatedAccounts.length !== 1) {
      throw new Error(
        `exact_channel_account_update_matched_${updatedAccounts.length}_rows:${action.userId}/${action.externalWorkspaceId}/${action.externalUserId}`,
      );
    }

    if (action.preferredName) {
      await db
        .update(users)
        .set({ preferredName: action.preferredName, updatedAt: new Date() })
        .where(and(eq(users.id, action.userId), eq(users.tenantId, options.tenantId)));
    }
  }
}

function toPublicAction(action: ResolvedBackfillAction): BackfillAction {
  return {
    userId: action.userId,
    externalWorkspaceId: action.externalWorkspaceId,
    externalUserId: action.externalUserId,
    status: action.status,
    ...(action.displayName ? { displayName: sanitizeOperationalMessage(action.displayName) } : {}),
    ...(action.preferredNameChanged !== undefined
      ? { preferredNameChanged: action.preferredNameChanged }
      : {}),
    ...(action.reason ? { reason: sanitizeOperationalMessage(action.reason) } : {}),
  };
}

function writeSummary(summary: BackfillSummary, output: OutputMode): void {
  if (output === 'json') {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(
    [
      `Slack display-name backfill ${summary.dryRun ? 'dry-run' : 'apply'} complete`,
      `tenantId=${summary.tenantId}`,
      `scanned=${summary.scanned}`,
      `planned=${summary.planned}`,
      `updated=${summary.updated}`,
      `skipped=${summary.skipped}`,
      `failed=${summary.failed}`,
    ].join(' '),
  );

  for (const action of summary.actions) {
    const label = action.status.toUpperCase();
    const detail = action.displayName ? ` -> ${action.displayName}` : '';
    const reason = action.reason ? ` (${action.reason})` : '';
    console.log(`${label} ${action.userId}/${action.externalWorkspaceId}${detail}${reason}`);
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = normalizeOptionalString(env[name]);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseOutputMode(value: string | undefined): OutputMode {
  if (value === undefined || value.trim() === '') {
    return 'text';
  }
  if (value === 'text' || value === 'json') {
    return value;
  }
  throw new Error('BACKFILL_OUTPUT must be "text" or "json"');
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function optionalStringProperty<Key extends string>(
  key: Key,
  value: string | undefined,
): Record<Key, string> | Record<string, never> {
  const normalized = normalizeOptionalString(value);
  return normalized ? { [key]: normalized } as Record<Key, string> : {};
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function sanitizeOperationalMessage(message: string): string {
  return message
    .split('\n')[0]
    .replace(/xox[a-z0-9-]*-[A-Za-z0-9-]+/gi, '[redacted-slack-token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .slice(0, 200);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(sanitizeOperationalMessage(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
