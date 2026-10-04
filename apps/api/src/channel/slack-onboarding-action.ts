import { OnboardingActionSchema, type OnboardingAction } from '@entalent/contracts';

export function normalizeOnboardingAction(body: Record<string, unknown>): {
  body: Record<string, unknown>; action: OnboardingAction; parentMessageTs: string;
} | null {
  if (body.type !== 'block_actions') return null;
  const actions = body.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions) || actions.length !== 1) return null;
  const selected = actions[0]!;
  if (typeof selected.action_id !== 'string' || !selected.action_id.startsWith('onboarding:')) return null;
  const action = OnboardingActionSchema.safeParse(selected.action_id.slice('onboarding:'.length));
  const team = body.team as Record<string, unknown> | undefined;
  const user = body.user as Record<string, unknown> | undefined;
  const channel = body.channel as Record<string, unknown> | undefined;
  const message = body.message as Record<string, unknown> | undefined;
  if (!action.success || typeof team?.id !== 'string' || typeof user?.id !== 'string' ||
      typeof channel?.id !== 'string' || !channel.id.startsWith('D') || typeof message?.ts !== 'string' ||
      typeof selected.action_ts !== 'string') return null;
  return { action: action.data, parentMessageTs: message.ts, body: {
    type: 'event_callback', team_id: team.id,
    event_id: `onboarding:${team.id}:${user.id}:${message.ts}:${selected.action_ts}:${action.data}`,
    event: { type: 'message', user: user.id, channel: channel.id, channel_type: 'im',
      text: String(selected.action_id), ts: selected.action_ts },
  } };
}
