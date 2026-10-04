import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { messages } from './messages';
import { tenants } from './tenants';
import { users } from './users';
import { conversations } from './conversations';

export const conversationJobAdmissions = pgTable('conversation_job_admissions', {
  messageId: uuid('message_id').primaryKey().references(() => messages.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  externalWorkspaceId: text('external_workspace_id').notNull(),
  externalConversationId: text('external_conversation_id').notNull(),
  eventId: text('event_id').notNull(),
  requestId: uuid('request_id').notNull(),
  traceId: uuid('trace_id').notNull(),
  queuedAt: timestamp('queued_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pendingIdx: index('conversation_job_admissions_pending_idx').on(t.createdAt).where(sql`${t.queuedAt} is null`),
  workspaceNonempty: check('conversation_job_admissions_workspace_nonempty', sql`btrim(${t.externalWorkspaceId}) <> ''`),
  conversationNonempty: check('conversation_job_admissions_conversation_nonempty', sql`btrim(${t.externalConversationId}) <> ''`),
}));

// A row is inserted only by the same transaction that commits every effect of
// an inbound turn. Its existence lets retries resume dispatch without a model call.
export const conversationTurnEffects = pgTable('conversation_turn_effects', {
  inboundMessageId: uuid('inbound_message_id').primaryKey()
    .references(() => conversationJobAdmissions.messageId, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  outboundMessageId: uuid('outbound_message_id').notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  committedAt: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  outboundUnique: unique('conversation_turn_effects_outbound_unique').on(t.outboundMessageId),
}));

// No response text, meaning, or queue payload belongs in this table. Dispatchers
// reconstruct their jobs from scoped PostgreSQL records using these identifiers.
export const conversationDispatchIntents = pgTable('conversation_dispatch_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  inboundMessageId: uuid('inbound_message_id').notNull()
    .references(() => conversationTurnEffects.inboundMessageId, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  targetId: uuid('target_id').notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lastQueuedAt: timestamp('last_queued_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  perTurnTarget: unique('conversation_dispatch_intents_target_unique')
    .on(t.inboundMessageId, t.kind, t.targetId),
  dueIdx: index('conversation_dispatch_intents_due_idx').on(t.availableAt),
  kindCheck: check('conversation_dispatch_intents_kind_check', sql`${t.kind} in (
    'message_send', 'memory_extraction', 'style_analysis', 'survey_evidence',
    'profile_hydration', 'follow_up_execution', 'group_report'
  )`),
}));

// An immutable claim written immediately before a channel send. If delivery
// fails after this insert, recovery must not send again without reconciliation.
export const conversationMessageSendAttempts = pgTable('conversation_message_send_attempts', {
  outboundMessageId: uuid('outbound_message_id').primaryKey()
    .references(() => messages.id, { onDelete: 'cascade' }),
  inboundMessageId: uuid('inbound_message_id').notNull().unique()
    .references(() => conversationTurnEffects.inboundMessageId, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});
