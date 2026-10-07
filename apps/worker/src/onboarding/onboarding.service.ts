import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACK_COPY, STARTED_REPLACEMENT, decideOnboarding, introMessages, reminderDueAt,
  type OnboardingApplyResult, type OnboardingEffect, type OnboardingEffectsPort, type OnboardingEvent,
  type OnboardingState, type OnboardingTurnPort,
} from '@entalent/application';
import type { PrimaryOrgRole } from '@entalent/application';
import { OnboardingStateRepository, type OnboardingStateRepositoryPort, type OnboardingStateRow, type OnboardingTx } from './onboarding-state.repository';

export const ONBOARDING_EFFECTS = Symbol('ONBOARDING_EFFECTS');

function sameDate(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function sameState(a: OnboardingState, b: OnboardingState): boolean {
  return a.track === b.track && a.introStatus === b.introStatus && a.participation === b.participation
    && a.reminderStatus === b.reminderStatus && a.buttonsActive === b.buttonsActive
    && sameDate(a.managementAckAt, b.managementAckAt) && sameDate(a.completedAt, b.completedAt)
    && sameDate(a.reminderOriginAt, b.reminderOriginAt);
}

/** Text actions and turn events are acknowledged by the orchestrator reply, not by a separate message. */
function isTurnOriginated(e: OnboardingEvent): boolean {
  return (e.type === 'action' && e.source === 'text') || e.type === 'stop_requested' || e.type === 'substantive_turn';
}

const names = (s: OnboardingState) => ({
  introStatus: s.introStatus, participation: s.participation, reminderStatus: s.reminderStatus,
});

interface Committed {
  result: OnboardingApplyResult;
  dueAt: Date | null;
  version: number;
  role: PrimaryOrgRole;
  introChannelId: string | null;
  introActionsMessageTs: string | null;
}

@Injectable()
export class OnboardingService implements OnboardingTurnPort {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(OnboardingStateRepository) private readonly repo: OnboardingStateRepositoryPort,
    @Inject(ONBOARDING_EFFECTS) private readonly effects: OnboardingEffectsPort,
  ) {}

  async contextFor(tenantId: string, userId: string): Promise<{ state: OnboardingState } | null> {
    const row = await this.repo.readState(tenantId, userId);
    return row ? { state: row.state } : null;
  }

  /**
   * The intro message carrying the buttons was delivered. Under the row lock: ignore a replay of the
   * recorded message or an older one (Slack ts compared numerically); otherwise store its location and
   * apply `intro_delivered` in the same transaction, so a retried job cannot re-arm answered buttons.
   */
  recordIntroDelivered(
    tenantId: string, personId: string, channelId: string, messageTs: string, at: Date,
  ): Promise<OnboardingApplyResult> {
    return this.apply(tenantId, personId, { type: 'intro_delivered', at }, async (tx, row) => {
      if (row.introActionsMessageTs === messageTs && row.introChannelId === channelId) return false;
      if (row.introActionsMessageTs && row.introChannelId === channelId
        && Number(row.introActionsMessageTs) > Number(messageTs)) return false;
      await tx.setIntroLocation(row.id, channelId, messageTs);
      row.introChannelId = channelId;
      row.introActionsMessageTs = messageTs;
      return true;
    });
  }

  applyTurnEvent(tenantId: string, userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult> {
    return this.apply(tenantId, userId, event);
  }

  async apply(
    tenantId: string, personId: string, event: OnboardingEvent,
    beforeDecide?: (tx: OnboardingTx, row: OnboardingStateRow) => Promise<boolean>,
  ): Promise<OnboardingApplyResult> {
    const committed = await this.repo.transaction<Committed | null>(async (tx) => {
      const row = await tx.lockState(tenantId, personId);
      if (!row) return null;
      if (beforeDecide && !(await beforeDecide(tx, row))) {
        return { result: { changed: false, effects: [], state: row.state }, dueAt: null, version: row.version,
          role: 'employee', introChannelId: row.introChannelId, introActionsMessageTs: row.introActionsMessageTs };
      }
      const { next, effects } = decideOnboarding(row.state, event);
      if (effects.length === 0 && sameState(row.state, next)) {
        return { result: { changed: false, effects, state: next }, dueAt: null, version: row.version,
          role: 'employee', introChannelId: row.introChannelId, introActionsMessageTs: row.introActionsMessageTs };
      }
      const person = await tx.getPerson(tenantId, personId);
      let dueAt: Date | null = null;
      for (const effect of effects) {
        if (effect.type !== 'schedule_reminder') continue;
        const calendar = await tx.getCalendar(tenantId);
        if (!calendar) throw new Error('onboarding_work_calendar_missing');
        dueAt = reminderDueAt(effect.originAt, calendar, person.timezone ?? calendar.timezone);
      }
      await tx.updateState(row.id, next, {
        ...(dueAt ? { reminderDueAt: dueAt } : {}),
        ...(event.type === 'reminder_sent' ? { reminderSentAt: event.at } : {}),
      });
      for (const effect of effects) {
        if (effect.type === 'set_proactive') await tx.setProactive(tenantId, personId, effect.enabled);
      }
      const userInitiated = event.type === 'action' || event.type === 'substantive_turn' || event.type === 'stop_requested';
      await tx.insertAudit({
        tenantId,
        actorType: userInitiated ? 'user' : 'system',
        actorId: userInitiated ? personId : 'onboarding',
        action: `onboarding.${event.type}`,
        resourceType: 'person',
        resourceId: personId,
        metadata: { from: names(row.state), to: names(next), ...(event.type === 'action' ? { source: event.source } : {}) },
      });
      return { result: { changed: true, effects, state: next }, dueAt, version: row.version + 1,
        role: person.role as PrimaryOrgRole, introChannelId: row.introChannelId, introActionsMessageTs: row.introActionsMessageTs };
    });

    if (!committed) return { changed: false, effects: [], state: null };
    // Post-commit effects are not durable across a crash between commit and execution; lost reminders
    // are recovered by a later sweep over reminder_due_at.
    if (committed.result.changed) await this.runEffects(tenantId, personId, event, committed);
    if (!isTurnOriginated(event)) return committed.result;
    const ack = committed.result.effects.find((e) => e.type === 'acknowledge');
    const start = committed.result.effects.some((e) => e.type === 'start_conversation');
    return {
      ...committed.result,
      ...(ack && ack.type === 'acknowledge' ? { replyAck: ACK_COPY[ack.key] } : {}),
      ...(start ? { replyStart: true } : {}),
    };
  }

  private async runEffects(tenantId: string, personId: string, event: OnboardingEvent, c: Committed): Promise<void> {
    for (const effect of c.result.effects) {
      await this.safely(effect, () => this.runEffect(tenantId, personId, event, c, effect));
    }
  }

  private async runEffect(
    tenantId: string, personId: string, event: OnboardingEvent, c: Committed, effect: OnboardingEffect,
  ): Promise<void> {
    switch (effect.type) {
      case 'schedule_reminder':
        if (c.dueAt) await this.effects.scheduleReminder({ tenantId, personId, dueAt: c.dueAt });
        return;
      case 'remove_buttons': {
        if (!c.introChannelId || !c.introActionsMessageTs) return;
        const copy = effect.replacement === 'started' ? STARTED_REPLACEMENT : ACK_COPY[effect.replacement];
        await this.effects.replaceIntroActions({
          tenantId, personId, channelId: c.introChannelId, messageTs: c.introActionsMessageTs,
          text: `${introMessages(c.role).trust}\n\n_${copy}_`,
        });
        return;
      }
      case 'acknowledge':
        // Turn-originated events are answered by the orchestrator via result.replyAck.
        if (isTurnOriginated(event)) return;
        await this.effects.sendAcknowledgement({
          tenantId, personId, text: ACK_COPY[effect.key], dedupeKey: `${personId}:ack:${effect.key}:${c.version}`,
        });
        return;
      case 'start_conversation':
        // A turn-originated start is opened by the orchestrator's own reply (result.replyStart).
        if (isTurnOriginated(event)) return;
        await this.effects.startConversation({
          tenantId, personId, dedupeKey: `${personId}:${c.version}`,
        });
        return;
      case 'send_intro':
        // Role-change intro: ids are keyed by the committed version, so they differ from every earlier intro.
        await this.effects.sendRoleIntro({ tenantId, personId, role: c.role, version: c.version });
        return;
      default:
        // cancel_reminder: the queued reminder job is not removed; the reminder processor compares the job's
        // dueAt with the state's reminder_due_at/reminderStatus and drops stale jobs.
        // set_proactive is applied inside the transaction.
        return;
    }
  }

  private async safely(effect: OnboardingEffect, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Onboarding effect ${effect.type} failed: ${(error as Error).message}`);
    }
  }
}
