import { createHmac, timingSafeEqual } from 'crypto';
import { WebClient } from '@slack/web-api';
import type { ChannelAdapterPort, UpdateOutgoingMessage } from '@entalent/channel-core';
import type { NormalizedChannelEvent, OutgoingMessage, SendMessageResult, ExternalUserProfile } from '@entalent/contracts';
import { normalizeSlackEvent, type SlackNormalizeInput } from './slack.normalizer';

export interface SlackAdapterConfig {
  signingSecret?: string;
  botToken?: string;
}

export interface SlackVerifyInput {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export class SlackAdapter implements ChannelAdapterPort {
  readonly channelType = 'slack';

  private readonly webClient: WebClient | undefined;

  constructor(private readonly config: SlackAdapterConfig) {
    if (config.botToken) {
      this.webClient = new WebClient(config.botToken);
    }
  }

  async verifyRequest(input: unknown): Promise<boolean> {
    if (!this.config.signingSecret) return false;

    const { headers, rawBody } = input as SlackVerifyInput;

    const timestamp = Array.isArray(headers['x-slack-request-timestamp'])
      ? headers['x-slack-request-timestamp'][0]
      : headers['x-slack-request-timestamp'];

    const signature = Array.isArray(headers['x-slack-signature'])
      ? headers['x-slack-signature'][0]
      : headers['x-slack-signature'];

    if (!timestamp || !signature) return false;

    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

    const sigBase = `v0:${timestamp}:${rawBody}`;
    const mySignature =
      'v0=' +
      createHmac('sha256', this.config.signingSecret).update(sigBase).digest('hex');

    try {
      return timingSafeEqual(Buffer.from(mySignature, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
      return false;
    }
  }

  async normalizeEvent(input: unknown): Promise<NormalizedChannelEvent[]> {
    return normalizeSlackEvent(input as SlackNormalizeInput);
  }

  async sendMessage(message: OutgoingMessage): Promise<SendMessageResult> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for sendMessage');

    const result = await this.webClient.chat.postMessage({
      channel: message.externalChannelId,
      text: message.text,
      ...(message.replyToExternalThreadId
        ? { thread_ts: message.replyToExternalThreadId }
        : {}),
    });

    if (!result.ok || !result.ts) {
      throw new Error(`Slack sendMessage failed: ${result.error ?? 'unknown error'}`);
    }

    return {
      externalMessageId: result.ts,
      externalThreadId: result.ts,
      sentAt: new Date(),
    };
  }

  async updateMessage(message: UpdateOutgoingMessage): Promise<void> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for updateMessage');

    await this.webClient.chat.update({
      channel: message.externalMessageId,
      ts: message.externalMessageId,
      text: message.text,
    });
  }

  async getUserProfile(
    _externalWorkspaceId: string,
    externalUserId: string,
  ): Promise<ExternalUserProfile> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for getUserProfile');

    const result = await this.webClient.users.info({ user: externalUserId });

    if (!result.ok || !result.user) {
      throw new Error(`Failed to fetch Slack user profile: ${result.error ?? 'unknown'}`);
    }

    const profile = result.user.profile;
    return {
      externalUserId,
      displayName:
        profile?.display_name ||
        profile?.real_name ||
        result.user.name ||
        externalUserId,
      email: profile?.email,
      timezone: result.user.tz,
      locale: undefined,
      avatarUrl: profile?.image_72,
      metadata: {},
    };
  }
}
