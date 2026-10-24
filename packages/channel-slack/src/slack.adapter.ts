import { createHmac, timingSafeEqual } from 'crypto';
import { WebClient, type KnownBlock } from '@slack/web-api';
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

/** Slack section text limit. */
const SECTION_TEXT_LIMIT = 3000;

type SlackBlock = KnownBlock;

function splitParagraph(paragraph: string): string[] {
  const parts: string[] = [];
  let rest = paragraph;
  while (rest.length > SECTION_TEXT_LIMIT) {
    const cut = rest.lastIndexOf('\n', SECTION_TEXT_LIMIT);
    const at = cut > 0 ? cut : rest.lastIndexOf(' ', SECTION_TEXT_LIMIT);
    const end = at > 0 ? at : SECTION_TEXT_LIMIT;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^[\n ]/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Shared by send and update; `text` stays the notification fallback. */
export function buildBlocks(text: string, actions?: OutgoingMessage['actions']): SlackBlock[] {
  const blocks: SlackBlock[] = text
    .split('\n\n')
    .filter((paragraph) => paragraph.trim().length > 0)
    .flatMap(splitParagraph)
    .map((paragraph) => ({ type: 'section', text: { type: 'mrkdwn', text: paragraph } }));
  if (actions?.length) {
    blocks.push({
      type: 'actions',
      elements: actions.map((a) => ({
        type: 'button',
        action_id: a.actionId,
        value: a.value,
        text: { type: 'plain_text', text: a.label },
      })),
    });
  }
  return blocks;
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

    if (!/^\d+$/.test(timestamp)) return false;
    const requestTime = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(requestTime) || Math.abs(now - requestTime) > 300) return false;

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

    // Text-only messages keep their plain-text shape; blocks are used only when buttons are attached.
    const blocks = message.actions?.length ? buildBlocks(message.text, message.actions) : undefined;
    const result = await this.webClient.chat.postMessage({
      channel: message.externalChannelId,
      text: message.text,
      ...(blocks ? { blocks } : {}),
      ...(message.replyToExternalThreadId
        ? { thread_ts: message.replyToExternalThreadId }
        : {}),
    });

    if (!result.ok || !result.ts) {
      throw new Error(`Slack sendMessage failed: ${result.error ?? 'unknown error'}`);
    }

    const sentAt = new Date(Number(result.ts) * 1000);
    if (!/^\d+\.\d+$/.test(result.ts) || Number.isNaN(sentAt.getTime())) {
      throw new Error('Slack sendMessage returned an invalid timestamp');
    }

    return {
      externalMessageId: result.ts,
      externalThreadId: result.ts,
      sentAt,
    };
  }

  async openDirectMessage(externalUserId: string): Promise<string> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for openDirectMessage');
    const result = await this.webClient.conversations.open({ users: externalUserId });
    const channelId = result.channel?.id;
    if (!result.ok || !channelId) throw new Error(`Slack openDirectMessage failed: ${result.error ?? 'missing channel'}`);
    return channelId;
  }

  async getDirectMessageUser(channelId: string): Promise<string | null> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for getDirectMessageUser');
    const result = await this.webClient.conversations.info({ channel: channelId });
    const channel = result.channel;
    return result.ok && channel?.id === channelId && channel.is_im
      && 'user' in channel && typeof channel.user === 'string'
      ? channel.user : null;
  }

  async updateMessage(message: UpdateOutgoingMessage): Promise<void> {
    if (!this.webClient) throw new Error('SlackAdapter: botToken is required for updateMessage');

    const blocks = buildBlocks(message.text, message.actions);
    const result = await this.webClient.chat.update({
      channel: message.externalChannelId,
      ts: message.externalMessageId,
      text: message.text,
      // Blocks are always sent on update so previous buttons are replaced.
      blocks,
    });
    if (!result.ok) {
      throw new Error(`Slack updateMessage failed: ${result.error ?? 'unknown error'}`);
    }
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
