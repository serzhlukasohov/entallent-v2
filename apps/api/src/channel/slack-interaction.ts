import type { Queue } from 'bullmq';
import { OnboardingActionSchema, type NormalizedChannelEvent, type OnboardingActionJob, type OnboardingSystemJob } from '@entalent/contracts';

export type SlackInteractionEvent = Extract<NormalizedChannelEvent, { type: 'interaction' }>;

export interface SlackInteractionDeps {
  /** Resolves the tenant for a Slack workspace, or null when unknown. */
  findWorkspaceIdentity(channelType: string, externalWorkspaceId: string): Promise<{ tenantId: string } | null>;
  /** Linked channel account -> person id within the tenant, or null. */
  findLinkedPersonId(params: {
    tenantId: string; channelType: string; externalWorkspaceId: string; externalUserId: string;
  }): Promise<string | null>;
  /** The intro message that currently carries the person's onboarding buttons. */
  findOnboardingIntroTarget(tenantId: string, personId: string): Promise<{
    introChannelId: string | null; introActionsMessageTs: string | null;
  } | null>;
  queue: Pick<Queue<OnboardingActionJob | OnboardingSystemJob>, 'add'>;
  debug(message: string): void;
}

const ACTION_ID = /^onboarding:(.+)$/;

/**
 * Validates a Slack button click and enqueues an onboarding action job.
 * A click is never persisted as an inbound message. Anything that is not a
 * click on the person's current intro buttons is dropped.
 */
export async function handleSlackInteraction(
  event: SlackInteractionEvent,
  deps: SlackInteractionDeps,
): Promise<boolean> {
  const p = event.payload;
  const drop = (reason: string): false => {
    deps.debug(`Dropping Slack interaction: ${reason}`);
    return false;
  };

  if (!p.externalChannelId.startsWith('D')) return drop('not a DM');

  const match = ACTION_ID.exec(p.actionId);
  const parsed = OnboardingActionSchema.safeParse(match?.[1]);
  if (!parsed.success) return drop('unknown action id');

  const workspace = await deps.findWorkspaceIdentity('slack', p.externalWorkspaceId);
  if (!workspace) return drop('unknown workspace');

  const personId = await deps.findLinkedPersonId({
    tenantId: workspace.tenantId,
    channelType: 'slack',
    externalWorkspaceId: p.externalWorkspaceId,
    externalUserId: p.externalUserId,
  });
  if (!personId) return drop('slack user is not a linked person');

  const target = await deps.findOnboardingIntroTarget(workspace.tenantId, personId);
  if (!target || target.introActionsMessageTs !== p.messageTs || target.introChannelId !== p.externalChannelId) {
    return drop('click is not on the current onboarding buttons');
  }

  await deps.queue.add('action', {
    kind: 'button',
    tenantId: workspace.tenantId,
    personId,
    action: parsed.data,
    actionTs: p.actionTs,
    messageTs: p.messageTs,
    channelId: p.externalChannelId,
  }, { jobId: `onb-act:${p.externalUserId}:${p.actionTs}` });
  return true;
}
