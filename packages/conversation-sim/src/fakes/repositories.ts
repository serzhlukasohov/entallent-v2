import { systemClock } from '@entalent/application';
import type {
  ClockPort,
  ConversationRecord,
  ConversationRepositoryPort,
  CommittedStyleAnalysisInput,
  CommittedStyleProfileRepositoryPort,
  GoalRepositoryPort,
  MemoryItemRecord,
  MemoryRepositoryPort,
  MessageRecord,
  ReportingDisclosureReceiptRecord,
  ScheduledActionRecord,
  SaveGoalParams,
  SaveMemoryItemParams,
  SaveScheduledActionParams,
  SaveMessageParams,
  ScheduledActionRepositoryPort,
  StyleProfileRecord,
  UserGoalRecord,
} from '@entalent/application';

/** Per-instance id sequence, so two harnesses never share or shift each other's ids. */
class IdSequence {
  private value = 0;

  next(prefix: string): string {
    return `${prefix}-${++this.value}`;
  }
}

/** Columns the production `messages` table stores but `MessageRecord` does not carry. */
export interface MessageSideFields {
  traceId?: string;
  messageType?: string;
}

export class InMemoryConversationRepository implements ConversationRepositoryPort {
  readonly messages: MessageRecord[] = [];
  private readonly deliveredAt = new Map<string, Date>();
  private readonly sideFields = new Map<string, MessageSideFields>();
  private readonly ids = new IdSequence();

  constructor(
    private readonly conversation: ConversationRecord,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async findById(id: string, tenantId: string): Promise<ConversationRecord | null> {
    const match = this.conversation.id === id && this.conversation.tenantId === tenantId;
    return match ? this.conversation : null;
  }

  async findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
    return this.messages.filter((m) => m.conversationId === conversationId).slice(-limit);
  }

  async findMessagesThrough(input: {
    conversationId: string;
    tenantId: string;
    userId: string;
    inboundMessageId: string;
    limit: number;
  }): Promise<MessageRecord[]> {
    const anchor = this.messages.find((message) =>
      message.id === input.inboundMessageId && message.conversationId === input.conversationId
      && message.tenantId === input.tenantId && message.userId === input.userId
      && message.direction === 'inbound');
    if (!anchor) return [];
    const anchorIndex = this.messages.indexOf(anchor);
    // Mirrors the production repository: equal-timestamp messages persisted at or before the
    // anchor stay in history, so a frozen clock does not drop earlier turns.
    return this.messages.filter((message, index) =>
      message.conversationId === input.conversationId && message.tenantId === input.tenantId
      && message.userId === input.userId
      && (message.occurredAt.getTime() < anchor.occurredAt.getTime()
        || (message.occurredAt.getTime() === anchor.occurredAt.getTime() && index <= anchorIndex)))
      .slice(-input.limit);
  }

  async findLatestDeliveredReportingDisclosure(
    tenantId: string,
    userId: string,
    version: string,
    before: Date,
  ): Promise<ReportingDisclosureReceiptRecord | null> {
    const message = [...this.messages].reverse().find(
      (candidate) => candidate.tenantId === tenantId
        && candidate.userId === userId
        && candidate.direction === 'outbound'
        && candidate.metadata?.reportingDisclosureVersion === version
        && (this.deliveredAt.get(candidate.id)?.getTime() ?? Number.POSITIVE_INFINITY)
          < before.getTime(),
    );
    if (!message) return null;
    return { version, shownAt: this.deliveredAt.get(message.id)! };
  }

  async updateActiveTopic(
    conversationId: string,
    tenantId: string,
    userId: string,
    activeTopic: NonNullable<ConversationRecord['activeTopic']>,
  ): Promise<void> {
    if (
      this.conversation.id === conversationId &&
      this.conversation.tenantId === tenantId &&
      this.conversation.userId === userId
    ) {
      this.conversation.activeTopic = activeTopic;
    }
  }

  async saveMessage(params: SaveMessageParams): Promise<MessageRecord> {
    const now = this.clock.now();
    const record: MessageRecord = {
      id: this.ids.next('msg'),
      conversationId: params.conversationId,
      tenantId: params.tenantId,
      userId: params.userId,
      direction: params.direction,
      text: params.text,
      externalMessageId: params.externalMessageId,
      externalThreadId: params.externalThreadId,
      occurredAt: params.occurredAt ?? now,
      createdAt: now,
      metadata: params.metadata,
    };
    this.messages.push(record);
    this.sideFields.set(record.id, {
      ...(params.traceId !== undefined ? { traceId: params.traceId } : {}),
      ...(params.messageType !== undefined ? { messageType: params.messageType } : {}),
    });
    return record;
  }

  /** `traceId` and `messageType` the message was saved with (empty when it had none). */
  sideFieldsOf(messageId: string): MessageSideFields {
    return { ...(this.sideFields.get(messageId) ?? {}) };
  }

  /** When the message was marked delivered, or null. */
  deliveredAtOf(messageId: string): Date | null {
    return this.deliveredAt.get(messageId) ?? null;
  }

  async updateMessageDelivery(
    messageId: string,
    params: {
      tenantId: string;
      conversationId: string;
      externalMessageId: string;
      externalThreadId?: string;
      sentAt: Date;
    },
  ): Promise<Date> {
    const message = this.messages.find(
      (candidate) => candidate.id === messageId
        && candidate.tenantId === params.tenantId
        && candidate.conversationId === params.conversationId,
    );
    if (!message) throw new Error(`Delivery update scope mismatch: ${messageId}`);
    const deliveredAt = this.deliveredAt.get(messageId) ?? params.sentAt;
    this.deliveredAt.set(messageId, deliveredAt);
    return deliveredAt;
  }
}

export class InMemoryMemoryRepository implements MemoryRepositoryPort {
  private readonly ids = new IdSequence();
  readonly items: MemoryItemRecord[] = [];

  constructor(private readonly clock: ClockPort = systemClock) {}

  async findActiveByUser(userId: string, tenantId: string, limit = 20): Promise<MemoryItemRecord[]> {
    const now = this.clock.now().getTime();
    return this.items
      .filter(
        (i) =>
          i.userId === userId &&
          i.tenantId === tenantId &&
          i.status === 'active' &&
          (!i.expiresAt || i.expiresAt.getTime() > now),
      )
      .sort((a, b) => b.importance - a.importance || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async findByCanonicalKey(
    userId: string,
    canonicalKey: string,
    tenantId: string,
  ): Promise<MemoryItemRecord | null> {
    return (
      this.items.find(
        (i) =>
          i.userId === userId &&
          i.tenantId === tenantId &&
          i.canonicalKey === canonicalKey &&
          i.status === 'active',
      ) ?? null
    );
  }

  async findById(id: string, tenantId: string): Promise<MemoryItemRecord | null> {
    return this.items.find((i) => i.id === id && i.tenantId === tenantId) ?? null;
  }

  async save(params: SaveMemoryItemParams): Promise<MemoryItemRecord> {
    const now = this.clock.now();
    const record: MemoryItemRecord = {
      ...params,
      id: this.ids.next('mem'),
      status: 'active',
      sourceType: 'conversation',
      validFrom: now,
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(record);
    return record;
  }

  async supersede(oldItemId: string, newItemId: string): Promise<void> {
    const old = this.items.find((i) => i.id === oldItemId);
    if (!old) return;
    old.status = 'superseded';
    old.supersededById = newItemId;
    old.updatedAt = this.clock.now();
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const item = this.items.find((i) => i.id === id && i.tenantId === tenantId);
    if (item) item.status = 'deleted';
  }
}

export class InMemoryGoalRepository implements GoalRepositoryPort {
  private readonly ids = new IdSequence();
  readonly goals: UserGoalRecord[] = [];

  constructor(private readonly clock: ClockPort = systemClock) {}

  async findActiveByUser(userId: string, tenantId: string): Promise<UserGoalRecord[]> {
    return this.goals.filter(
      (g) => g.userId === userId && g.tenantId === tenantId && g.status === 'active',
    );
  }

  async findById(id: string, tenantId: string): Promise<UserGoalRecord | null> {
    return this.goals.find((g) => g.id === id && g.tenantId === tenantId) ?? null;
  }

  async save(params: SaveGoalParams): Promise<UserGoalRecord> {
    const now = this.clock.now();
    const record: UserGoalRecord = {
      ...params,
      id: this.ids.next('goal'),
      status: 'active',
      priority: 'medium',
      createdAt: now,
      updatedAt: now,
    };
    this.goals.push(record);
    return record;
  }

  async updateStatus(
    id: string,
    status: 'active' | 'completed' | 'cancelled',
    tenantId: string,
  ): Promise<void> {
    const goal = this.goals.find((g) => g.id === id && g.tenantId === tenantId);
    if (goal) {
      goal.status = status;
      goal.updatedAt = this.clock.now();
    }
  }
}

export class InMemoryScheduledActionRepository implements ScheduledActionRepositoryPort {
  private readonly ids = new IdSequence();
  readonly actions: ScheduledActionRecord[] = [];

  constructor(private readonly clock: ClockPort = systemClock) {}

  async save(params: SaveScheduledActionParams): Promise<ScheduledActionRecord> {
    const now = this.clock.now();
    const record: ScheduledActionRecord = {
      ...params,
      id: this.ids.next('act'),
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    };
    this.actions.push(record);
    return record;
  }

  async findById(id: string, tenantId: string): Promise<ScheduledActionRecord | null> {
    return this.actions.find((action) => action.id === id && action.tenantId === tenantId) ?? null;
  }

  async markSent(id: string, tenantId: string, attemptCount: number): Promise<void> {
    const action = await this.findById(id, tenantId);
    if (!action) return;
    action.status = 'sent';
    action.attemptCount = attemptCount;
    action.lastAttemptAt = this.clock.now();
    action.updatedAt = this.clock.now();
  }

  async cancel(id: string, tenantId: string): Promise<void> {
    const action = await this.findById(id, tenantId);
    if (!action) return;
    action.status = 'cancelled';
    action.updatedAt = this.clock.now();
  }

  async postpone(
    id: string,
    tenantId: string,
    newDueAt: Date,
    attemptCount: number,
  ): Promise<void> {
    const action = await this.findById(id, tenantId);
    if (!action) return;
    action.status = 'pending';
    action.dueAt = newDueAt;
    action.attemptCount = attemptCount;
    action.lastAttemptAt = this.clock.now();
    action.updatedAt = this.clock.now();
  }

  async existsByDeduplicationKey(key: string): Promise<boolean> {
    return this.actions.some((action) => action.deduplicationKey === key && action.status === 'pending');
  }

  async cancelPendingByUserAndType(
    userId: string,
    tenantId: string,
    type: string,
    topic: string,
  ): Promise<void> {
    for (const action of this.actions) {
      if (
        action.userId === userId &&
        action.tenantId === tenantId &&
        action.type === type &&
        action.intent === topic &&
        action.status === 'pending'
      ) {
        action.status = 'cancelled';
        action.updatedAt = this.clock.now();
      }
    }
  }
}

export class InMemoryStyleProfileRepository implements CommittedStyleProfileRepositoryPort {
  private profile: StyleProfileRecord | null;
  private readonly completed = new Set<string>();

  constructor(seedProfile: StyleProfileRecord | null = null) {
    this.profile = seedProfile;
  }

  async findByUser(userId: string, tenantId: string): Promise<StyleProfileRecord | null> {
    if (!this.profile) return null;
    return this.profile.userId === userId && this.profile.tenantId === tenantId
      ? this.profile
      : null;
  }

  async upsert(profile: StyleProfileRecord): Promise<StyleProfileRecord> {
    this.profile = profile;
    return profile;
  }

  async isCommittedStyleAnalysisComplete(input: CommittedStyleAnalysisInput): Promise<boolean> {
    return this.completed.has(this.completionKey(input));
  }

  async completeCommittedStyleAnalysis(
    input: CommittedStyleAnalysisInput,
    update: ((current: StyleProfileRecord | null) => StyleProfileRecord) | null,
  ): Promise<void> {
    const key = this.completionKey(input);
    if (this.completed.has(key)) return;
    if (update) this.profile = update(await this.findByUser(input.userId, input.tenantId));
    this.completed.add(key);
  }

  private completionKey(input: CommittedStyleAnalysisInput): string {
    return `${input.tenantId}:${input.userId}:${input.conversationId}:${input.inboundMessageId}`;
  }
}
