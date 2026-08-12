import { Injectable, Logger } from '@nestjs/common';
import { SlackAdapter } from '@entalent/channel-slack';
import type { ExternalUserProfile } from '@entalent/contracts';
import type { ExternalProfilePort } from '@entalent/application';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Injectable()
export class SlackExternalProfileAdapter implements ExternalProfilePort {
  private readonly logger = new Logger(SlackExternalProfileAdapter.name);
  constructor(private readonly wsRepo: WorkspaceConnectionRepository) {}

  async fetchProfile(
    userId: string,
    tenantId: string,
    channelType: string,
    externalWorkspaceId?: string,
  ): Promise<ExternalUserProfile | null> {
    if (channelType !== 'slack') return null;
    const account = await this.wsRepo.findSlackAccountByUserId(
      userId,
      tenantId,
      externalWorkspaceId,
    );
    if (!account) return null;
    const wsConn = await this.wsRepo.findByExternalWorkspace(
      'slack',
      account.externalWorkspaceId,
      tenantId,
    );
    if (!wsConn) return null;
    try {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      return await adapter.getUserProfile(account.externalWorkspaceId, account.externalUserId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`fetchProfile failed for user=${userId}: ${message}`);
      if (isNonRetryableSlackProfileError(message)) {
        return null;
      }
      throw err;
    }
  }

  async fetchTimezone(
    userId: string,
    tenantId: string,
    channelType: string,
    externalWorkspaceId?: string,
  ): Promise<string | null> {
    const profile = await this.fetchProfile(userId, tenantId, channelType, externalWorkspaceId);
    return profile?.timezone ?? null;
  }
}

function isNonRetryableSlackProfileError(message: string): boolean {
  return [
    'user_not_found',
    'account_inactive',
    'is_bot',
    'user_is_bot',
    'enterprise_is_restricted',
  ].some((code) => message.includes(code));
}
