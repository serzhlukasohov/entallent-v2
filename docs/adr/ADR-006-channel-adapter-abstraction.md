# ADR-006: Channel Adapter Abstraction

**Status:** Accepted  
**Date:** 2024-01-01

## Context

The product roadmap includes Slack, Microsoft Teams, Telegram, and WhatsApp. Each has a completely different event format, authentication model, and send API. The conversation domain must not care which channel is being used.

## Decision

Define a `ChannelAdapterPort` interface in `packages/channel-core`:

```typescript
interface ChannelAdapterPort {
  channelType: string;
  verifyRequest(input: unknown): Promise<boolean>;
  normalizeEvent(input: unknown): Promise<NormalizedChannelEvent[]>;
  sendMessage(message: OutgoingMessage): Promise<SendMessageResult>;
  updateMessage?(message: UpdateOutgoingMessage): Promise<void>;
  getUserProfile?(workspaceId: string, userId: string): Promise<ExternalUserProfile>;
}
```

All channel events are normalized to `IncomingMessage` before entering the conversation pipeline. All outgoing messages are expressed as `OutgoingMessage` and routed through the adapter.

Each new channel requires:
1. A new `packages/channel-<name>` package implementing `ChannelAdapterPort`
2. Registration in the API/Worker DI container
3. No changes to conversation domain, memory, survey, or safety packages

## Consequences

**Good:**
- Adding a new channel is additive (no domain changes)
- Conversation logic is tested channel-independently
- Channel-specific quirks (threading, retries, rate limits) are isolated

**Bad:**
- Normalization loses channel-specific richness (acceptable trade-off)
- Each new channel requires upfront adapter implementation
