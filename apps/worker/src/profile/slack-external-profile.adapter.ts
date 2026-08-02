import { Injectable, Logger } from '@nestjs/common';
import { SlackAdapter } from '@entalent/channel-slack';
import type { ExternalProfilePort } from '@entalent/application';
import { WorkspaceConnectionRepository } from '../conversation/repositories/workspace-connection.repository';

@Injectable()
export class SlackExternalProfileAdapter implements ExternalProfilePort {
  private readonly logger = new Logger(SlackExternalProfileAdapter.name);
  constructor(private readonly wsRepo: WorkspaceConnectionRepository) {}

  async fetchTimezone(userId: string, tenantId: string, channelType: string): Promise<string | null> {
    if (channelType !== 'slack') return null;
    const account = await this.wsRepo.findSlackAccountByUserId(userId, tenantId);
    if (!account) return null;
    const wsConn = await this.wsRepo.findByExternalWorkspace('slack', account.externalWorkspaceId);
    if (!wsConn) return null;
    try {
      const adapter = new SlackAdapter({ botToken: wsConn.botToken });
      const profile = await adapter.getUserProfile(account.externalWorkspaceId, account.externalUserId);
      return profile.timezone ?? null;
    } catch (err) {
      this.logger.warn(`fetchTimezone failed for user=${userId}: ${(err as Error).message}`);
      return null;
    }
  }
}
