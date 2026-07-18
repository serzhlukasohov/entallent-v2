import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb, runMigrationsOnce, closeTestDb, describeIntegration } from './integration-setup';
import { tenants, users, memoryItems } from '../schema';

describeIntegration('Memory items (integration)', () => {
  let tenantId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrationsOnce();
    const { db } = getTestDb();

    const [t] = await db
      .insert(tenants)
      .values({ name: 'MemoryTest Corp', status: 'active', timezone: 'UTC', locale: 'en', retentionPolicy: {}, safetyPolicy: {}, proactiveMessagingPolicy: {}, surveyConfiguration: {} })
      .returning();
    tenantId = t!.id;

    const [u] = await db
      .insert(users)
      .values({ tenantId, status: 'active', locale: 'en', communicationPreferences: {}, proactiveMessagingEnabled: true, quietHours: { enabled: false }, onboardingStatus: 'pending', consentState: {} })
      .returning();
    userId = u!.id;
  });

  afterAll(async () => {
    const { db } = getTestDb();
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await closeTestDb();
  });

  it('persists a memory item with correct fields', async () => {
    const { db } = getTestDb();
    const [item] = await db
      .insert(memoryItems)
      .values({
        tenantId,
        userId,
        category: 'goal',
        canonicalKey: 'career_goal_em',
        content: 'Wants to become EM by 2026',
        confidence: '0.90',
        importance: '0.85',
        sensitivity: 'normal',
        status: 'active',
        sourceMessageIds: [],
        sourceType: 'conversation',
        validFrom: new Date(),
      })
      .returning();

    expect(item).toBeDefined();
    expect(item!.canonicalKey).toBe('career_goal_em');
    expect(item!.status).toBe('active');
  });

  it('retrieves memory items for a specific user only', async () => {
    const { db } = getTestDb();
    // Create a second user and give them a memory item
    const [otherUser] = await db
      .insert(users)
      .values({ tenantId, status: 'active', locale: 'en', communicationPreferences: {}, proactiveMessagingEnabled: true, quietHours: { enabled: false }, onboardingStatus: 'pending', consentState: {} })
      .returning();

    await db.insert(memoryItems).values({
      tenantId,
      userId: otherUser!.id,
      category: 'stressor',
      content: 'Deadline pressure',
      confidence: '0.80',
      importance: '0.70',
      sensitivity: 'normal',
      status: 'active',
      sourceMessageIds: [],
      sourceType: 'conversation',
      validFrom: new Date(),
    });

    const items = await db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.tenantId, tenantId), eq(memoryItems.userId, userId)));

    expect(items.every(i => i.userId === userId)).toBe(true);
    expect(items.some(i => i.userId === otherUser!.id)).toBe(false);
  });

  it('soft-deletes a memory item (status=superseded)', async () => {
    const { db } = getTestDb();
    const [item] = await db
      .insert(memoryItems)
      .values({
        tenantId,
        userId,
        category: 'goal',
        canonicalKey: 'old_goal',
        content: 'Old goal to supersede',
        confidence: '0.70',
        importance: '0.50',
        sensitivity: 'normal',
        status: 'active',
        sourceMessageIds: [],
        sourceType: 'conversation',
        validFrom: new Date(),
      })
      .returning();

    await db
      .update(memoryItems)
      .set({ status: 'superseded' })
      .where(eq(memoryItems.id, item!.id));

    const [updated] = await db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.id, item!.id));

    expect(updated!.status).toBe('superseded');
  });
});
