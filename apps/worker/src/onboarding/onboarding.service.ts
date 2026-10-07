import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACK_COPY, STARTED_REPLACEMENT, decideOnboarding, introMessages, reminderDueAt,
  type OnboardingApplyResult, type OnboardingEffect, type OnboardingEffectsPort, type OnboardingEvent,
  type OnboardingState, type OnboardingTurnPort,
} from '@entalent/application';
import type { PrimaryOrgRole } from '@entalent/application';
import { OnboardingStateRepository, type OnboardingStateRepositoryPort } from './onboarding-state.repository';

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

  applyTurnEvent(tenantId: string, userId: string, event: OnboardingEvent): Promise<OnboardingApplyResult> {
    return this.apply(tenantId, userId, event);
  }

  async apply(tenantId: string, personId: string, event: OnboardingEvent): Promise<OnboardingApplyResult> {
    const committed = await this.repo.transaction<Committed | null>(async (tx) => {
      const row = await tx.lockState(tenantId, personId);
      if (!row) return null;
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
    if (committed.result.changed) await this.runEffects(tenantId, personId, event, committed);
    return committed.result;
  }

  private async runEffects(tenantId: string, personId: string, event: OnboardingEvent, c: Committed): Promise<void> {
    const state = c.result.state!;
    for (const effect of c.result.effects) {
      await this.safely(effect, () => this.runEffect(tenantId, personId, event, c, state, effect));
    }
  }

  private async runEffect(
    tenantId: string, personId: string, event: OnboardingEvent, c: Committed, state: OnboardingState, effect: OnboardingEffect,
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
        // Text-sourced actions are answered by the orchestrator using the returned effect.
        if (event.type === 'action' && event.source === 'text') return;
        await this.effects.sendAcknowledgement({
          tenantId, personId, text: ACK_COPY[effect.key], dedupeKey: `${personId}:ack:${effect.key}:${c.version}`,
        });
        return;
      case 'start_conversation':
        await this.effects.startConversation({
          tenantId, personId, dedupeKey: `${personId}:${state.completedAt?.toISOString() ?? 'none'}`,
        });
        return;
      default:
        return; // cancel_reminder / set_proactive handled in the transaction; send_intro is dispatched elsewhere
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
