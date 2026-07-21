import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import type { Env } from '@entalent/config';
import { decryptField } from '@entalent/crypto-utils';
import { workspaceConnections, channelAccounts } from '@entalent/database';
import type { WorkspaceConnectionRepositoryPort, WorkspaceConnectionRecord } from '@entalent/application';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class WorkspaceConnectionRepository implements WorkspaceConnectionRepositoryPort {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async findFirstByTenant(
    tenantId: string,
    channelType: string,
  ): Promise<WorkspaceConnectionRecord | null> {
    const [conn] = await this.db.client
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.tenantId, tenantId),
          eq(workspaceConnections.channelType, channelType),
          eq(workspaceConnections.status, 'active'),
        ),
      )
      .limit(1);

    if (!conn) return null;

    const encKey = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const creds = JSON.parse(decryptField(conn.encryptedCredentials, encKey)) as {
      botToken: string;
      signingSecret: string;
    };

    return {
      id: conn.id,
      tenantId: conn.tenantId,
      channelType: conn.channelType,
      externalWorkspaceId: conn.externalWorkspaceId,
      botToken: creds.botToken,
      signingSecret: creds.signingSecret,
    };
  }

  async findSlackAccountByUserId(
    userId: string,
    tenantId: string,
  ): Promise<{ externalWorkspaceId: string; externalUserId: string } | null> {
    const [account] = await this.db.client
      .select({
        externalWorkspaceId: channelAccounts.externalWorkspaceId,
        externalUserId: channelAccounts.externalUserId,
      })
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.userId, userId),
          eq(channelAccounts.tenantId, tenantId),
          eq(channelAccounts.channelType, 'slack'),
        ),
      )
      .limit(1);
    return account ?? null;
  }

  async findByExternalWorkspace(
    channelType: string,
    externalWorkspaceId: string,
  ): Promise<WorkspaceConnectionRecord | null> {
    const [conn] = await this.db.client
      .select()
      .from(workspaceConnections)
      .where(
        and(
          eq(workspaceConnections.channelType, channelType),
          eq(workspaceConnections.externalWorkspaceId, externalWorkspaceId),
          eq(workspaceConnections.status, 'active'),
        ),
      )
      .limit(1);

    if (!conn) return null;

    const encKey = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const creds = JSON.parse(decryptField(conn.encryptedCredentials, encKey)) as {
      botToken: string;
      signingSecret: string;
    };

    return {
      id: conn.id,
      tenantId: conn.tenantId,
      channelType: conn.channelType,
      externalWorkspaceId: conn.externalWorkspaceId,
      botToken: creds.botToken,
      signingSecret: creds.signingSecret,
    };
  }
}
