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
