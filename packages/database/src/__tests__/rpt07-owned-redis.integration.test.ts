import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import {
  claimOwnedRpt07Redis,
  parseOwnedRpt07Target,
  RPT07_REDIS_OWNER_KEY,
} from './rpt07-owned-redis.fixture';

describe('RPT08a owned RPT07 Redis target (pure)', () => {
  const owned = {
    REDIS_URL: 'redis://127.0.0.1:56465/15',
    RPT07_REDIS_TARGET: '127.0.0.1:56465/15',
  };
  it('accepts an explicitly named loopback db-15 target', () => {
    expect(parseOwnedRpt07Target(owned)).toEqual({ host: '127.0.0.1', port: 56465, db: 15 });
  });
  it.each([
    [{ ...owned, RPT07_REDIS_TARGET: undefined }, 'requires_named_owned_rpt07_redis'],
    [{ ...owned, RPT07_REDIS_TARGET: '127.0.0.1:56385/15' }, 'requires_named_owned_rpt07_redis'],
    [
      { REDIS_URL: 'redis://localhost:56465/15', RPT07_REDIS_TARGET: 'localhost:56465/15' },
      'requires_loopback_rpt07_redis_db15',
    ],
    [
      { REDIS_URL: 'redis://10.0.0.5:56465/15', RPT07_REDIS_TARGET: '10.0.0.5:56465/15' },
      'requires_loopback_rpt07_redis_db15',
    ],
    [
      { REDIS_URL: 'redis://127.0.0.1:56465/0', RPT07_REDIS_TARGET: '127.0.0.1:56465/15' },
      'requires_loopback_rpt07_redis_db15',
    ],
    [
      { REDIS_URL: 'redis://127.0.0.1/15', RPT07_REDIS_TARGET: '127.0.0.1:/15' },
      'requires_loopback_rpt07_redis_db15',
    ],
    [
      { REDIS_URL: 'rediss://127.0.0.1:56465/15', RPT07_REDIS_TARGET: '127.0.0.1:56465/15' },
      'requires_loopback_rpt07_redis_db15',
    ],
    [{ RPT07_REDIS_TARGET: '127.0.0.1:56465/15' }, 'requires_named_owned_rpt07_redis'],
  ])('rejects %j before connecting', async (env, error) => {
    expect(() => parseOwnedRpt07Target(env)).toThrow(error);
    await expect(claimOwnedRpt07Redis(env)).rejects.toThrow(error);
  });
});

describe.runIf(Boolean(process.env.REDIS_URL && process.env.RPT07_REDIS_TARGET))(
  'RPT08a owned RPT07 Redis target (live)',
  () => {
    const peek = () =>
      new Redis({ ...parseOwnedRpt07Target(process.env), maxRetriesPerRequest: 1 });
    /** Writes a test-only key into an empty db with NX; deletes it only while it still holds the test value. */
    const plant = async (redis: Redis, key: string, value: string) => {
      expect(await redis.dbsize()).toBe(0);
      expect(await redis.set(key, value, 'NX')).toBe('OK');
      return async () => {
        if ((await redis.get(key)) === value) await redis.del(key);
      };
    };
    it('claims an empty db, removes only its registered queue keys and the owner key on release', async () => {
      const owned = await claimOwnedRpt07Redis(),
        redis = peek();
      let released = false;
      try {
        await expect(claimOwnedRpt07Redis()).rejects.toThrow('rpt07_redis_owner_conflict');
        expect(await redis.pttl(RPT07_REDIS_OWNER_KEY)).toBeGreaterThan(0);
        expect(() => owned.queue('other-' + randomUUID())).toThrow('rpt07_queue_name_not_owned');
        const queue = new Queue(owned.queue('rpt07-guard-' + randomUUID()), {
          connection: owned.connection,
        });
        await queue.add('synthetic', {});
        await queue.close();
        expect(await redis.dbsize()).toBeGreaterThan(1);
        released = true;
        await owned.release();
        expect(await redis.dbsize()).toBe(0);
      } finally {
        if (!released) await owned.release();
        redis.disconnect();
      }
    });
    it('a held owner key is a conflict and a foreign key makes the db non-empty; nothing is written or deleted', async () => {
      const redis = peek(),
        value = 'test-' + randomUUID();
      try {
        const unplantOwner = await plant(redis, RPT07_REDIS_OWNER_KEY, value);
        await expect(claimOwnedRpt07Redis()).rejects.toThrow('rpt07_redis_owner_conflict');
        expect(await redis.get(RPT07_REDIS_OWNER_KEY)).toBe(value);
        await unplantOwner();
        const unplantForeign = await plant(redis, 'rpt08a:foreign', value);
        await expect(claimOwnedRpt07Redis()).rejects.toThrow('rpt07_redis_not_empty');
        expect(await redis.keys('*')).toEqual(['rpt08a:foreign']);
        await unplantForeign();
      } finally {
        redis.disconnect();
      }
    });
    it('release refuses when the owner key was taken over and leaves the foreign owner in place', async () => {
      const owned = await claimOwnedRpt07Redis(),
        redis = peek(),
        value = 'test-' + randomUUID();
      try {
        await redis.set(RPT07_REDIS_OWNER_KEY, value, 'XX');
        await expect(owned.release()).rejects.toThrow('rpt07_redis_owner_lost');
        expect(await redis.get(RPT07_REDIS_OWNER_KEY)).toBe(value);
      } finally {
        if ((await redis.get(RPT07_REDIS_OWNER_KEY)) === value)
          await redis.del(RPT07_REDIS_OWNER_KEY);
        redis.disconnect();
      }
    });
  },
);
