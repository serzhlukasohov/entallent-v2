import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tenants } from '@entalent/database';
import { DatabaseService } from './database.service';

const databaseUrl = process.env['DATABASE_URL'];

describe.runIf(Boolean(databaseUrl))('worker transaction context (PostgreSQL)', () => {
  const database = new DatabaseService({ get: () => databaseUrl } as never);
  const insertedIds: string[] = [];

  beforeAll(() => database.onModuleInit());
  afterAll(async () => {
    for (const id of insertedIds) {
      await database.client.delete(tenants).where(eq(tenants.id, id));
    }
    await database.onModuleDestroy();
  });

  it('rolls back repository writes and isolates a parallel committed turn', async () => {
    const failedName = `Failed turn ${randomUUID()}`;
    const committedName = `Committed turn ${randomUUID()}`;
    let releaseFailed!: () => void;
    let failedEntered!: () => void;
    const failedCanFinish = new Promise<void>((resolve) => { releaseFailed = resolve; });
    const failedHasEntered = new Promise<void>((resolve) => { failedEntered = resolve; });

    const failed = expect(database.withTransaction(async () => {
      await database.client.insert(tenants).values({ name: failedName });
      failedEntered();
      await failedCanFinish;
      throw new Error('rollback_turn');
    })).rejects.toThrow('rollback_turn');
    await failedHasEntered;

    const committedId = await database.withTransaction(async () => {
      const [row] = await database.client.insert(tenants)
        .values({ name: committedName }).returning({ id: tenants.id });
      expect((await database.client.select().from(tenants)
        .where(eq(tenants.id, row!.id)))).toHaveLength(1);
      return row!.id;
    });
    insertedIds.push(committedId);
    releaseFailed();
    await failed;

    expect(await database.client.select().from(tenants)
      .where(eq(tenants.name, failedName))).toHaveLength(0);
    expect(await database.client.select().from(tenants)
      .where(eq(tenants.id, committedId))).toHaveLength(1);
  });

  it('uses a savepoint for an existing repository transaction inside the turn', async () => {
    const outerName = `Outer turn ${randomUUID()}`;
    const innerName = `Failed inner turn ${randomUUID()}`;
    const outerId = await database.withTransaction(async () => {
      const [outer] = await database.client.insert(tenants)
        .values({ name: outerName }).returning({ id: tenants.id });
      await expect(database.client.transaction(async (tx) => {
        await tx.insert(tenants).values({ name: innerName });
        throw new Error('rollback_inner');
      })).rejects.toThrow('rollback_inner');
      expect(await database.client.select().from(tenants)
        .where(eq(tenants.name, innerName))).toHaveLength(0);
      return outer!.id;
    });
    insertedIds.push(outerId);
    expect(await database.client.select().from(tenants)
      .where(eq(tenants.id, outerId))).toHaveLength(1);
  });
});
