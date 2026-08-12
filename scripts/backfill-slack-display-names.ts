import { and, eq, isNull, or } from 'drizzle-orm';
import { resolveExternalProfileFacts } from '@entalent/application';
import { SlackAdapter } from '@entalent/channel-slack';
import { decryptField } from '@entalent/crypto-utils';
import { channelAccounts, createDbClient, users, workspaceConnections } from '@entalent/database';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'];
  const encryptionKey = process.env['FIELD_ENCRYPTION_KEY'];
  const tenantId = process.env['DEFAULT_TENANT_ID'];

  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!encryptionKey) throw new Error('FIELD_ENCRYPTION_KEY is required');
  if (!tenantId) throw new Error('DEFAULT_TENANT_ID is required');

  const { db, sql } = createDbClient(databaseUrl);

  try {
    const accounts = await db
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
      .where(
        and(
          eq(channelAccounts.tenantId, tenantId),
          eq(channelAccounts.channelType, 'slack'),
          or(isNull(channelAccounts.displayName), isNull(users.preferredName)),
        ),
      );

    const connections = await db
      .select({
        externalWorkspaceId: workspaceConnections.externalWorkspaceId,
        encryptedCredentials: workspaceConnections.encryptedCredentials,
      })
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.tenantId, tenantId),
          eq(workspaceConnections.channelType, 'slack'),
          eq(workspaceConnections.status, 'active'),
        ),
      );

    const tokenByWorkspace = new Map<string, string>();
    for (const connection of connections) {
      const credentials = JSON.parse(
        decryptField(connection.encryptedCredentials, encryptionKey),
      ) as {
        botToken?: string;
      };
      if (credentials.botToken) {
        tokenByWorkspace.set(connection.externalWorkspaceId, credentials.botToken);
      }
    }

    let updated = 0;
    for (const account of accounts) {
      const botToken = tokenByWorkspace.get(account.externalWorkspaceId);
      if (!botToken) {
        console.warn(`Skipping ${account.userId}: no bot token for workspace`);
        continue;
      }

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
      if (!profileFacts.displayName) continue;

      await db
        .update(channelAccounts)
        .set({
          displayName: profileFacts.displayName,
          profileMetadata: {
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            locale: profile.locale,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(channelAccounts.tenantId, tenantId),
            eq(channelAccounts.userId, account.userId),
            eq(channelAccounts.channelType, 'slack'),
          ),
        );

      if (profileFacts.preferredName) {
        await db
          .update(users)
          .set({ preferredName: profileFacts.preferredName, updatedAt: new Date() })
          .where(and(eq(users.id, account.userId), eq(users.tenantId, tenantId)));
      }

      updated += 1;
      console.log(`Updated ${account.userId} -> ${profileFacts.displayName}`);
    }

    console.log(`Backfill complete: ${updated}/${accounts.length} Slack accounts updated`);
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
