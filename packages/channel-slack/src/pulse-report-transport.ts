import { WebClient } from '@slack/web-api';
import type { ChatPostMessageArguments } from '@slack/web-api';
import type {
  PulseBindingProof,
  PulseRecipientCandidate,
  PulseTransportOutcome,
} from '@entalent/contracts';
export const PULSE_SLACK_OPTIONS = Object.freeze({
  retryConfig: { retries: 0 },
  rejectRateLimitedCalls: true,
  timeout: 10_000,
});
type Client = Pick<WebClient, 'auth' | 'conversations' | 'chat'>;
/** Dedicated bounded client. Ordinary chat/pilot defaults are deliberately not reused. */
export class PulseSlackTransport {
  constructor(
    private readonly client: (token: string) => Client = (token) =>
      new WebClient(token, PULSE_SLACK_OPTIONS),
  ) {}
  async prove(
    input: PulseRecipientCandidate,
    credential: string,
    existingChannelId?: string,
  ): Promise<PulseBindingProof | null> {
    try {
      const client = this.client(credential),
        auth = await client.auth.test();
      if (!auth.ok || auth.team_id !== input.workspaceId || !auth.user_id || !auth.bot_id)
        return null;
      const channel =
        existingChannelId ??
        (await client.conversations.open({ users: input.slackUserId, return_im: true })).channel
          ?.id;
      if (!channel) return null;
      const info = await client.conversations.info({ channel });
      if (
        !info.ok ||
        !info.channel?.is_im ||
        info.channel.id !== channel ||
        (info.channel as { user?: string }).user !== input.slackUserId ||
        info.channel.is_archived
      )
        return null;
      return {
        workspaceId: input.workspaceId,
        botUserId: auth.user_id,
        channelId: channel,
        slackUserId: input.slackUserId,
        privateDm: true,
      };
    } catch {
      return null;
    }
  }
  async post(credential: string, channelId: string, body: unknown): Promise<PulseTransportOutcome> {
    const payload = body as Record<string, unknown> | null;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.text !== 'string' ||
      !Array.isArray(payload.blocks) ||
      payload.mrkdwn !== false ||
      payload.parse !== 'none' ||
      payload.link_names !== false ||
      payload.unfurl_links !== false ||
      payload.unfurl_media !== false ||
      Object.keys(payload).some(
        (k) =>
          ![
            'text',
            'blocks',
            'mrkdwn',
            'parse',
            'link_names',
            'unfurl_links',
            'unfurl_media',
          ].includes(k),
      )
    )
      return { status: 'definitely_not_sent', reason: 'local_not_invoked', retryable: false };
    try {
      const response = await this.client(credential).chat.postMessage({
        ...(body as object),
        channel: channelId,
      } as ChatPostMessageArguments);
      if (
        !response.ok ||
        response.channel !== channelId ||
        !response.ts ||
        !/^\d{10,}\.\d{6}$/.test(response.ts)
      )
        return { status: 'unknown', reason: 'unverified_response' };
      return { status: 'accepted', channel: response.channel, timestamp: response.ts };
    } catch (error) {
      const e = error as { code?: string; data?: { error?: string }; retryAfter?: number };
      if (e.code === 'slack_webapi_rate_limited_error')
        return {
          status: 'definitely_not_sent',
          reason: 'rate_limited',
          retryable: true,
          retryAfterSeconds: Math.min(3600, Math.max(1, e.retryAfter ?? 60)),
        };
      // Explicit provider rejection is nonpublication. Transport/proxy/timeouts are never inferred unsent.
      if (
        e.code === 'slack_webapi_platform_error' &&
        [
          'invalid_auth',
          'account_inactive',
          'token_revoked',
          'missing_scope',
          'channel_not_found',
          'not_in_channel',
          'is_archived',
          'restricted_action',
          'invalid_arguments',
          'msg_too_long',
          'too_many_attachments',
          'no_text',
        ].includes(e.data?.error ?? '')
      )
        return { status: 'definitely_not_sent', reason: 'provider_rejected', retryable: false };
      return {
        status: 'unknown',
        reason: e.code?.includes('timeout')
          ? 'timeout'
          : e.code?.includes('request')
            ? 'network'
            : 'unclassified_error',
      };
    }
  }
}
