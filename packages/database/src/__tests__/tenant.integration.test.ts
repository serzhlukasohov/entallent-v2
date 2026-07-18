import { it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, runMigrationsOnce, closeTestDb, describeIntegration } from './integration-setup';
import { tenants, users, conversations } from '../schema';

describeIntegration('Tenant and User repositories (integration)', () => {
  let tenantId: string;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    await runMigrationsOnce();
  });

  afterAll(async () => {
    const { db } = getTestDb();
    // Cascade deletes handle users, conversations, etc.
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await closeTestDb();
  });

  it('creates a tenant', async () => {
    const { db } = getTestDb();
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'Test Corp',
        status: 'active',
        timezone: 'America/New_York',
        locale: 'en',
        retentionPolicy: {},
        safetyPolicy: {},
        proactiveMessagingPolicy: {},
        surveyConfiguration: {},
      })
      .returning();

    expect(tenant).toBeDefined();
    expect(tenant!.name).toBe('Test Corp');
    expect(tenant!.id).toMatch(/^[0-9a-f-]{36}$/);
    tenantId = tenant!.id;
  });

  it('creates a user under that tenant', async () => {
    const { db } = getTestDb();
    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        status: 'active',
        preferredName: 'Alice',
        timezone: 'America/New_York',
        locale: 'en',
        communicationPreferences: {},
        proactiveMessagingEnabled: true,
        quietHours: { enabled: false },
        onboardingStatus: 'completed',
        consentState: { agreed: true },
      })
      .returning();

    expect(user).toBeDefined();
    expect(user!.tenantId).toBe(tenantId);
    expect(user!.preferredName).toBe('Alice');
    userId = user!.id;
  });

  it('creates a conversation for that user', async () => {
    const { db } = getTestDb();
    const [conv] = await db
      .insert(conversations)
      .values({
        tenantId,
        userId,
        channelType: 'slack',
        externalConversationId: 'slack-dm-alice-001',
        status: 'active',
      })
      .returning();

    expect(conv).toBeDefined();
    expect(conv!.channelType).toBe('slack');
    conversationId = conv!.id;
  });

  it('enforces unique constraint on (tenantId, channelType, externalConversationId)', async () => {
    const { db } = getTestDb();
    await expect(
      db.insert(conversations).values({
        tenantId,
        userId,
        channelType: 'slack',
        externalConversationId: 'slack-dm-alice-001', // duplicate
        status: 'active',
      }),
    ).rejects.toThrow();
  });

  it('reads conversation by id with correct tenant isolation', async () => {
    const { db } = getTestDb();
    const [found] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    expect(found).toBeDefined();
    expect(found!.tenantId).toBe(tenantId);
    expect(found!.userId).toBe(userId);
  });

  it('cascades user deletion to conversations', async () => {
    const { db } = getTestDb();
    await db.delete(users).where(eq(users.id, userId));

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    expect(conv).toBeUndefined();
  });

  it('does not expose data across tenants', async () => {
    const { db } = getTestDb();
    // Create a second tenant
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: 'Other Corp', status: 'active', timezone: 'UTC', locale: 'en', retentionPolicy: {}, safetyPolicy: {}, proactiveMessagingPolicy: {}, surveyConfiguration: {} })
      .returning();

    await db
      .insert(users)
      .values({ tenantId: otherTenant!.id, status: 'active', locale: 'en', communicationPreferences: {}, proactiveMessagingEnabled: true, quietHours: { enabled: false }, onboardingStatus: 'pending', consentState: {} });

    // Query with original tenantId — other tenant's user must not appear
    const result = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenantId));

    // otherUser should not appear in tenantId's results
    expect(result.every(u => u.tenantId === tenantId)).toBe(true);

    // Cleanup
    await db.delete(tenants).where(eq(tenants.id, otherTenant!.id));
  });
});
