import type {
  ConversationRecord,
  ConversationRepositoryPort,
  GoalRepositoryPort,
  MemoryItemRecord,
  MemoryRepositoryPort,
  MessageRecord,
  SaveGoalParams,
  SaveMemoryItemParams,
  SaveMessageParams,
  StyleProfileRecord,
  StyleProfileRepositoryPort,
  UserGoalRecord,
} from '@entalent/application';

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

export class InMemoryConversationRepository implements ConversationRepositoryPort {
  readonly messages: MessageRecord[] = [];

  constructor(private readonly conversation: ConversationRecord) {}

  async findById(id: string, tenantId: string): Promise<ConversationRecord | null> {
    const match = this.conversation.id === id && this.conversation.tenantId === tenantId;
    return match ? this.conversation : null;
  }

  async findRecentMessages(conversationId: string, limit: number): Promise<MessageRecord[]> {
    return this.messages.filter((m) => m.conversationId === conversationId).slice(-limit);
  }

  async saveMessage(params: SaveMessageParams): Promise<MessageRecord> {
    const now = new Date();
    const record: MessageRecord = {
      id: nextId('msg'),
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
    return record;
  }

  async updateMessageDelivery(): Promise<void> {
    // Delivery is a channel concern; simulations never leave the process.
  }
}

export class InMemoryMemoryRepository implements MemoryRepositoryPort {
  readonly items: MemoryItemRecord[] = [];

  async findActiveByUser(userId: string, tenantId: string, limit = 20): Promise<MemoryItemRecord[]> {
    const now = Date.now();
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
    const now = new Date();
    const record: MemoryItemRecord = {
      ...params,
      id: nextId('mem'),
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
    old.updatedAt = new Date();
  }

  async softDelete(id: string, tenantId: string): Promise<void> {
    const item = this.items.find((i) => i.id === id && i.tenantId === tenantId);
    if (item) item.status = 'deleted';
  }
}

export class InMemoryGoalRepository implements GoalRepositoryPort {
  readonly goals: UserGoalRecord[] = [];

  async findActiveByUser(userId: string, tenantId: string): Promise<UserGoalRecord[]> {
    return this.goals.filter(
      (g) => g.userId === userId && g.tenantId === tenantId && g.status === 'active',
    );
  }

  async findById(id: string, tenantId: string): Promise<UserGoalRecord | null> {
    return this.goals.find((g) => g.id === id && g.tenantId === tenantId) ?? null;
  }

  async save(params: SaveGoalParams): Promise<UserGoalRecord> {
    const now = new Date();
    const record: UserGoalRecord = {
      ...params,
      id: nextId('goal'),
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
      goal.updatedAt = new Date();
    }
  }
}

export class InMemoryStyleProfileRepository implements StyleProfileRepositoryPort {
  private profile: StyleProfileRecord | null;

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
}
