import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { conversations, messages, orgOnboardingDeliveries, people, tenants, users } from '@entalent/database';
import {
  applyOnboardingAction, defaultOnboardingSettings, readOnboardingState, initialOnboardingState, onboardingButtons,
  onboardingCompleted, onboardingReminderDueAt, recognizeOnboardingAction, withinCompanyWorkingHours,
  PulseBacklogService, type PrimaryOrgRole,
} from '@entalent/application';
import { CompanyOnboardingSettingsSchema, type OnboardingAction } from '@entalent/contracts';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from './outbox.service';
import { AiService } from './ai.service';
import type { ConversationJob } from './conversation.processor';

function stableId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readCompanyCalendar(tenant: { timezone: string; locale: string; proactiveMessagingPolicy: unknown }) {
  const parsed = CompanyOnboardingSettingsSchema.safeParse(object(tenant.proactiveMessagingPolicy).onboarding);
  return parsed.success ? parsed.data : defaultOnboardingSettings(tenant.timezone,
    tenant.locale === 'ru' || tenant.locale === 'uk' ? tenant.locale : 'en');
}

@Injectable()
export class OnboardingFlowService {
  constructor(private readonly db: DatabaseService, private readonly outbox: OutboxService,
    private readonly backlog: PulseBacklogService, private readonly ai: AiService) {}

  async initialize(tenantId: string, userId: string): Promise<void> {
    await this.db.client.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
        .for('update').limit(1);
      if (!user || readOnboardingState(user.communicationPreferences)) return;
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!tenant) throw new Error('onboarding_tenant_missing');
      await tx.update(users).set({ communicationPreferences: { ...object(user.communicationPreferences), onboarding: initialOnboardingState() },
        onboardingStatus: 'in_progress', proactiveMessagingEnabled: false, locale: readCompanyCalendar(tenant).defaultLanguage,
        updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    });
  }

  /** Returns true only for control turns; ordinary employee messages retain normal safety routing. */
  async handleInbound(input: ConversationJob): Promise<boolean> {
    const responseId = stableId(`onboarding-action:${input.tenantId}:${input.userId}:${input.messageId}`);
    const handled = await this.db.client.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)))
        .for('update').limit(1);
      if (!user || user.status !== 'active' || user.deletedAt) return true;
      const state = readOnboardingState(user.communicationPreferences);
      if (!state) return Boolean(input.onboardingAction);
      const [person] = await tx.select().from(people).where(and(eq(people.id, input.userId), eq(people.tenantId, input.tenantId))).limit(1);
      if (!person || person.lifecycleStatus !== 'active') return true;
      const [conversation] = await tx.select().from(conversations).where(and(eq(conversations.id, input.conversationId),
        eq(conversations.userId, input.userId), eq(conversations.tenantId, input.tenantId))).limit(1);
      if (!conversation || conversation.externalConversationId !== input.externalConversationId) throw new Error('onboarding_conversation_scope');
      const [inbound] = await tx.select().from(messages).where(and(eq(messages.id, input.messageId),
        eq(messages.tenantId, input.tenantId), eq(messages.userId, input.userId), eq(messages.conversationId, input.conversationId),
        eq(messages.direction, 'inbound'), isNull(messages.deletedAt))).limit(1);
      if (!inbound) throw new Error('onboarding_inbound_scope');
      const role = person.primaryRole as PrimaryOrgRole;
      const action = input.onboardingAction?.action ?? recognizeOnboardingAction(inbound.text);
      if (!action) return false;
      if (!onboardingButtons(role).some((button) => button.action === action)) return Boolean(input.onboardingAction);
      if (input.onboardingAction) {
        const [parent] = await tx.select({ metadata: messages.metadata }).from(messages).where(and(
          eq(messages.tenantId, input.tenantId), eq(messages.userId, input.userId), eq(messages.conversationId, input.conversationId),
          eq(messages.direction, 'outbound'), eq(messages.externalMessageId, input.onboardingAction.parentMessageTs),
          isNull(messages.deletedAt))).limit(1);
        if (!parent || object(parent.metadata).onboardingVersion !== state.version) return true;
      }
      const [existing] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, responseId)).limit(1);
      if (existing) return true;
      const alreadyDone = onboardingCompleted(state, role);
      if (alreadyDone && (action === 'got_it' || action === 'later' || action === 'start' && state.personalParticipation === 'active')) return true;
      const next = applyOnboardingAction(state, role, action, new Date());
      let text = acknowledgement(action, user.locale);
      let probe: { question: { id: string }; windowId: string } | null = null;
      if (action === 'start') {
        const selected = await this.backlog.getNextProbeQuestion(input.userId, input.tenantId);
        if (selected) {
          const generated = await this.ai.generateResponse([], { mode: 'survey_probe', tone: 'warm',
            includeFollowUpQuestion: true, maxResponseLength: 'short', forbiddenPatterns: ['score', 'assessment'] }, {
            userName: user.preferredName ?? 'there',
            languagePolicy: { responseLanguage: user.locale, source: 'user_profile', confidence: 1, shouldUpdateUserLocale: false },
            proactiveCheckIn: { probeQuestion: { id: selected.question.id, probeStrategies: selected.question.probeStrategies,
              responseType: selected.question.responseType } },
          });
          text = generated.text;
          if (generated.containsSurveyProbe && generated.surveyProbeQuestionId === selected.question.id) probe = selected;
        } else {
          text = user.locale === 'ru' ? 'Как тебе сейчас работается?' : user.locale === 'uk' ? 'Як тобі зараз працюється?' : 'How are things going for you at work?';
        }
      }
      await tx.update(users).set({ communicationPreferences: { ...object(user.communicationPreferences), onboarding: next },
        onboardingStatus: onboardingCompleted(next, role) ? 'completed' : action === 'decline' ? 'declined' : 'deferred',
        proactiveMessagingEnabled: next.personalParticipation === 'active', updatedAt: new Date() })
        .where(and(eq(users.id, input.userId), eq(users.tenantId, input.tenantId)));
      await tx.insert(messages).values({ id: responseId, tenantId: input.tenantId, userId: input.userId,
        conversationId: input.conversationId, direction: 'outbound', senderType: 'agent', text,
        messageType: 'onboarding_control', traceId: input.traceId, occurredAt: new Date(),
        metadata: { onboardingVersion: next.version, onboardingControl: true,
          ...(action === 'later' ? { onboardingActions: onboardingButtons(role, user.locale) } : {}),
          ...(probe ? { containsSurveyProbe: true, surveyProbeQuestionId: probe.question.id,
            onboardingProbeWindowId: probe.windowId } : {}) } });
      return true;
    });
    if (handled) {
      const [response] = await this.db.client.select().from(messages).where(and(eq(messages.id, responseId),
        eq(messages.tenantId, input.tenantId), eq(messages.userId, input.userId))).limit(1);
      if (response) {
        const metadata = object(response.metadata);
        if (typeof metadata.surveyProbeQuestionId === 'string' && typeof metadata.onboardingProbeWindowId === 'string') {
          await this.backlog.recordProbeSent(input.userId, metadata.onboardingProbeWindowId,
            metadata.surveyProbeQuestionId, response.occurredAt);
        }
        await this.outbox.enqueueMessageSend({ messageId: response.id, tenantId: input.tenantId, conversationId: input.conversationId,
          channelType: 'slack', externalWorkspaceId: input.externalWorkspaceId, externalChannelId: input.externalConversationId, text: response.text });
      }
    }
    return handled;
  }

  async dispatchReminders(tenantId?: string): Promise<void> {
    const rows = await this.db.client.select({ user: users, person: people, tenant: tenants, delivery: orgOnboardingDeliveries,
      conversation: conversations }).from(orgOnboardingDeliveries)
      .innerJoin(users, and(eq(users.id, orgOnboardingDeliveries.personId), eq(users.tenantId, orgOnboardingDeliveries.tenantId)))
      .innerJoin(people, and(eq(people.id, users.id), eq(people.tenantId, users.tenantId)))
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .innerJoin(conversations, and(eq(conversations.userId, users.id), eq(conversations.tenantId, users.tenantId), eq(conversations.channelType, 'slack'),
        sql`EXISTS (SELECT 1 FROM messages om WHERE om.id = ${orgOnboardingDeliveries.id} AND om.conversation_id = ${conversations.id} AND om.tenant_id = ${users.tenantId})`))
      .where(and(tenantId ? eq(users.tenantId, tenantId) : undefined, eq(orgOnboardingDeliveries.status, 'delivered'),
        eq(users.status, 'active'), eq(people.lifecycleStatus, 'active'), isNull(users.deletedAt),
        sql`${users.communicationPreferences}->'onboarding'->>'personalParticipation' = 'undecided'`,
        sql`coalesce(${users.communicationPreferences}->'onboarding'->>'managementCompleted', 'false') = 'false'`,
        sql`(coalesce(${users.communicationPreferences}->'onboarding'->>'reminderQueued', 'false') = 'false'
          OR EXISTS (SELECT 1 FROM messages rm WHERE rm.user_id = ${users.id} AND rm.tenant_id = ${users.tenantId}
            AND rm.metadata->>'onboardingReminder' = 'true' AND rm.sent_at IS NULL AND rm.deleted_at IS NULL))`));
    for (const row of rows) {
      const state = readOnboardingState(row.user.communicationPreferences);
      if (!state || !row.delivery.deliveredAt) continue;
      const settings = readCompanyCalendar(row.tenant);
      const now = new Date();
      const dueAt = onboardingReminderDueAt(new Date(state.deferredAt ?? row.delivery.deliveredAt), settings);
      if (now < dueAt || !withinCompanyWorkingHours(now, settings)) continue;
      const id = stableId(`onboarding-reminder:${row.delivery.id}`);
      await this.db.client.transaction(async (tx) => {
        const [current] = await tx.select().from(users).where(and(eq(users.id, row.user.id), eq(users.tenantId, row.user.tenantId))).for('update').limit(1);
        const fresh = readOnboardingState(current?.communicationPreferences);
        if (fresh?.deferredAt !== state.deferredAt) return;
        if (!current || !fresh || fresh.personalParticipation !== 'undecided' || fresh.managementCompleted) return;
        const [existing] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, id)).limit(1);
        if (fresh.reminderQueued && !existing) return;
        await tx.insert(messages).values({ id, tenantId: row.user.tenantId, userId: row.user.id, conversationId: row.conversation.id,
          direction: 'outbound', senderType: 'agent', messageType: 'onboarding_reminder',
          text: current.locale === 'ru' ? 'Хочешь продолжить знакомство? Если сейчас неудобно, просто напиши мне, когда будешь готов. Больше напоминать не буду.'
            : current.locale === 'uk' ? 'Хочеш продовжити знайомство? Напиши, коли будеш готовий. Більше нагадувати не буду.'
              : "Would you like to continue? You can message me whenever you're ready. I won't send another onboarding reminder.",
          occurredAt: now, metadata: { onboardingVersion: fresh.version, onboardingControl: true, onboardingReminder: true,
            onboardingActions: onboardingButtons(row.person.primaryRole as PrimaryOrgRole, current.locale) },
        }).onConflictDoNothing();
        await tx.update(users).set({ communicationPreferences: { ...object(current.communicationPreferences), onboarding: { ...fresh, reminderQueued: true } },
          updatedAt: now }).where(and(eq(users.id, row.user.id), eq(users.tenantId, row.user.tenantId)));
      });
      const [message] = await this.db.client.select().from(messages).where(and(eq(messages.id, id), isNull(messages.sentAt))).limit(1);
      if (message) await this.outbox.enqueueMessageSend({ messageId: id, tenantId: row.user.tenantId, conversationId: row.conversation.id,
        channelType: 'slack', externalWorkspaceId: row.delivery.externalWorkspaceId, externalChannelId: row.conversation.externalConversationId, text: message.text });
    }
  }
}
function acknowledgement(action: OnboardingAction, language: string): string {
  if (language === 'ru') return action === 'decline' ? 'Хорошо, личных приглашений больше не будет. Ты можешь написать мне в любой момент.'
    : action === 'later' ? 'Хорошо, вернёмся позже. Ты можешь написать мне в любой момент.' : 'Всё готово. Я сообщу, когда появится первый отчёт.';
  if (language === 'uk') return action === 'decline' ? 'Добре, особистих запрошень більше не буде. Можеш написати мені будь-коли.'
    : action === 'later' ? 'Добре, повернемося пізніше. Можеш написати мені будь-коли.' : 'Усе готово. Я повідомлю, коли з’явиться перший звіт.';
  return action === 'decline' ? "Understood. I won't send personal invitations. You can message me anytime."
    : action === 'later' ? "Of course. You can message me whenever you're ready." : "You're all set. I'll let you know when your first report is ready.";
}
