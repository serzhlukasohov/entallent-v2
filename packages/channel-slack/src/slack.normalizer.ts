import type { NormalizedChannelEvent } from '@entalent/contracts';

export interface SlackNormalizeInput {
  body: Record<string, unknown>;
  tenantId: string;
}

export function normalizeSlackEvent(input: SlackNormalizeInput): NormalizedChannelEvent[] {
  const { body, tenantId } = input;

  if (body['type'] === 'url_verification') {
    return [];
  }

  if (body['type'] === 'block_actions') {
    return normalizeBlockActions(body);
  }

  if (body['type'] !== 'event_callback') {
    return [];
  }

  const event = body['event'] as Record<string, unknown> | undefined;
  if (!event) return [];

  const teamId = (body['team_id'] as string | undefined) ?? '';

  if (event['type'] === 'message') {
    const subtype = event['subtype'] as string | undefined;

    if (subtype === 'message_changed') {
      const newMessage = (event['message'] as Record<string, unknown> | undefined) ?? {};
      return [
        {
          type: 'message_edited',
          payload: {
            originalExternalMessageId: (event['previous_message'] as Record<string, unknown>)?.['ts'] as string ?? '',
            newText: (newMessage['text'] as string) ?? '',
            editedAt: new Date(),
          },
        },
      ];
    }

    if (subtype === 'message_deleted') {
      return [
        {
          type: 'message_deleted',
          payload: {
            externalMessageId: (event['deleted_ts'] as string) ?? (event['ts'] as string) ?? '',
            deletedAt: new Date(),
          },
        },
      ];
    }

    if (subtype) return [];

    const userId = event['user'] as string | undefined;
    if (!userId) return [];

    const ts = event['ts'] as string | undefined;
    const timestamp = ts ? new Date(parseFloat(ts) * 1000) : new Date();

    return [
      {
        type: 'message',
        payload: {
          id: crypto.randomUUID(),
          tenantId,
          channel: 'slack',
          externalWorkspaceId: teamId,
          externalUserId: userId,
          externalConversationId: (event['channel'] as string) ?? '',
          externalThreadId: (event['thread_ts'] as string | undefined),
          text: (event['text'] as string) ?? '',
          timestamp,
          metadata: {
            slackEventId: body['event_id'],
            slackEventTime: body['event_time'],
          },
        },
      },
    ];
  }

  return [];
}

function normalizeBlockActions(body: Record<string, unknown>): NormalizedChannelEvent[] {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const rec = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

  const channelId = str(rec(body['channel'])['id']);
  // Onboarding buttons exist only in DMs with the bot.
  if (!channelId || !channelId.startsWith('D')) return [];
  const actions = body['actions'];
  if (!Array.isArray(actions) || actions.length !== 1) return [];
  const action = rec(actions[0]);
  const workspaceId = str(rec(body['team'])['id']);
  const userId = str(rec(body['user'])['id']);
  const messageTs = str(rec(body['container'])['message_ts']) ?? str(rec(body['message'])['ts']);
  const actionId = str(action['action_id']);
  const actionTs = str(action['action_ts']);
  if (!workspaceId || !userId || !messageTs || !actionId || !actionTs) return [];

  return [{
    type: 'interaction',
    payload: {
      externalWorkspaceId: workspaceId,
      externalUserId: userId,
      externalChannelId: channelId,
      messageTs,
      actionId,
      value: str(action['value']) ?? '',
      actionTs,
    },
  }];
}
