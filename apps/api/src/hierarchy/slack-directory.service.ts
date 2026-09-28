import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { and, eq } from 'drizzle-orm';
import { decryptField } from '@entalent/crypto-utils';
import { workspaceConnections } from '@entalent/database';
import type { Env } from '@entalent/config';
import { DatabaseService } from '../database/database.service';

export interface SlackDirectoryUser {
  externalUserId: string;
  email: string | null;
  isBot: boolean;
  deleted: boolean;
}

@Injectable()
export class SlackDirectoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async listUsers(tenantId: string, workspaceId: string): Promise<SlackDirectoryUser[]> {
    const { client, scopes } = await this.getClient(tenantId, workspaceId);
    if (!scopes.includes('users:read.email')) throw new Error('slack_email_scope_missing');
    const users: SlackDirectoryUser[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.users.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      if (!page.ok) throw new Error(`slack_directory_failed:${page.error ?? 'unknown'}`);
      for (const member of page.members ?? []) {
        if (!member.id) continue;
        users.push({
          externalUserId: member.id,
          email: member.profile?.email ?? null,
          isBot: Boolean(member.is_bot || member.is_app_user),
          deleted: Boolean(member.deleted),
        });
      }
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return users;
  }

  async getUser(tenantId: string, workspaceId: string, externalUserId: string): Promise<SlackDirectoryUser> {
    const { client } = await this.getClient(tenantId, workspaceId);
    const result = await client.users.info({ user: externalUserId });
    if (!result.ok || !result.user?.id) throw new Error('slack_user_not_found');
    return {
      externalUserId: result.user.id,
      email: result.user.profile?.email ?? null,
      isBot: Boolean(result.user.is_bot || result.user.is_app_user),
      deleted: Boolean(result.user.deleted),
    };
  }

  private async getClient(tenantId: string, workspaceId: string): Promise<{ client: WebClient; scopes: string[] }> {
    const [workspace] = await this.db.client.select({
      encryptedCredentials: workspaceConnections.encryptedCredentials,
      scopes: workspaceConnections.scopes,
    }).from(workspaceConnections).where(and(
      eq(workspaceConnections.tenantId, tenantId),
      eq(workspaceConnections.channelType, 'slack'),
      eq(workspaceConnections.externalWorkspaceId, workspaceId),
      eq(workspaceConnections.status, 'active'),
    )).limit(1);
    if (!workspace) throw new Error('slack_workspace_not_found');
    const key = this.config.get('FIELD_ENCRYPTION_KEY', { infer: true });
    const credentials: unknown = JSON.parse(decryptField(workspace.encryptedCredentials, key));
    const botToken = typeof credentials === 'object' && credentials !== null && 'botToken' in credentials
      ? credentials.botToken : null;
    if (typeof botToken !== 'string' || !botToken) throw new Error('slack_bot_token_missing');
    return {
      client: new WebClient(botToken),
      scopes: Array.isArray(workspace.scopes) ? workspace.scopes.filter((value): value is string => typeof value === 'string') : [],
    };
  }
}
