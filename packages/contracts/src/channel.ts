import { z } from 'zod';

export const ChannelTypeSchema = z.enum(['slack', 'teams', 'telegram', 'whatsapp']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const IncomingMessageSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  channel: ChannelTypeSchema,
  externalWorkspaceId: z.string(),
  externalUserId: z.string(),
  externalConversationId: z.string(),
  externalThreadId: z.string().optional(),
  text: z.string(),
  timestamp: z.coerce.date(),
  metadata: z.record(z.unknown()).default({}),
});
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

export const OutgoingMessageSchema = z.object({
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid(),
  text: z.string(),
  channel: ChannelTypeSchema,
  externalWorkspaceId: z.string(),
  externalChannelId: z.string(),
  replyToExternalThreadId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type OutgoingMessage = z.infer<typeof OutgoingMessageSchema>;

export const SendMessageResultSchema = z.object({
  externalMessageId: z.string(),
  externalThreadId: z.string().optional(),
  sentAt: z.coerce.date(),
});
export type SendMessageResult = z.infer<typeof SendMessageResultSchema>;

export const ExternalUserProfileSchema = z.object({
  externalUserId: z.string(),
  displayName: z.string(),
  email: z.string().email().optional(),
  timezone: z.string().optional(),
  locale: z.string().optional(),
  avatarUrl: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type ExternalUserProfile = z.infer<typeof ExternalUserProfileSchema>;

export const NormalizedChannelEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    payload: IncomingMessageSchema,
  }),
  z.object({
    type: z.literal('message_edited'),
    payload: z.object({
      originalExternalMessageId: z.string(),
      newText: z.string(),
      editedAt: z.coerce.date(),
    }),
  }),
  z.object({
    type: z.literal('message_deleted'),
    payload: z.object({
      externalMessageId: z.string(),
      deletedAt: z.coerce.date(),
    }),
  }),
  z.object({
    type: z.literal('user_profile_changed'),
    payload: ExternalUserProfileSchema,
  }),
]);
export type NormalizedChannelEvent = z.infer<typeof NormalizedChannelEventSchema>;
