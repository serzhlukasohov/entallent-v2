import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';

export const RPT07_REDIS_OWNER_KEY = 'rpt07:owner';

export interface OwnedRpt07Redis {
  connection: { host: string; port: number; db: number };
  /** Registers a suite-owned random queue name; only its `bull:<name>:*` keys are removed on release. */
  queue(name: string): string;
  release(): Promise<void>;
}

/** Pure target check: runs before any connection. Mirrors the RPT08 acceptance named-target rule. */
export function parseOwnedRpt07Target(env: NodeJS.ProcessEnv): OwnedRpt07Redis['connection'] {
  let url: URL;
  try {
    url = new URL(env.REDIS_URL ?? '');
  } catch {
    throw Error('requires_named_owned_rpt07_redis');
  }
  if (
    url.protocol !== 'redis:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/15'
  )
    throw Error('requires_loopback_rpt07_redis_db15');
  if (env.RPT07_REDIS_TARGET !== `${url.hostname}:${url.port}/15`)
    throw Error('requires_named_owned_rpt07_redis');
  return { host: url.hostname, port: Number(url.port), db: 15 };
}

const OWNER_TTL_MS = 600_000;
const RELEASE_OWNER_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
type OwnerRedis = Redis & { rpt07ReleaseOwner(key: string, nonce: string): Promise<number> };

/**
 * Claims db 15 of an explicitly named loopback Redis for one RPT07 suite: the owner key is taken with NX, a per-run
 * nonce and a TTL longer than any suite, then the database must hold nothing else (the key is withdrawn otherwise).
 * Release removes only registered queue keys, then atomically deletes the owner key while it still holds the nonce.
 */
export async function claimOwnedRpt07Redis(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnedRpt07Redis> {
  const connection = parseOwnedRpt07Target(env);
  const nonce = randomBytes(16).toString('hex'),
    queues = new Set<string>();
  const redis = new Redis({
    ...connection,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
  }) as OwnerRedis;
  redis.defineCommand('rpt07ReleaseOwner', { numberOfKeys: 1, lua: RELEASE_OWNER_LUA });
  try {
    if ((await redis.set(RPT07_REDIS_OWNER_KEY, nonce, 'PX', OWNER_TTL_MS, 'NX')) !== 'OK')
      throw Error('rpt07_redis_owner_conflict');
    if ((await redis.dbsize()) !== 1) {
      await redis.rpt07ReleaseOwner(RPT07_REDIS_OWNER_KEY, nonce);
      throw Error('rpt07_redis_not_empty');
    }
  } catch (error) {
    redis.disconnect();
    throw error;
  }
  return {
    connection,
    queue: (name) => {
      if (
        !/^rpt07-([a-z]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name)
      )
        throw Error('rpt07_queue_name_not_owned');
      queues.add(name);
      return name;
    },
    release: async () => {
      try {
        if ((await redis.get(RPT07_REDIS_OWNER_KEY)) !== nonce)
          throw Error('rpt07_redis_owner_lost');
        for (const name of queues) {
          let cursor = '0';
          do {
            const [next, keys] = await redis.scan(cursor, 'MATCH', `bull:${name}:*`, 'COUNT', 500);
            if (keys.length) await redis.del(...keys);
            cursor = next;
          } while (cursor !== '0');
        }
        if ((await redis.rpt07ReleaseOwner(RPT07_REDIS_OWNER_KEY, nonce)) !== 1)
          throw Error('rpt07_redis_owner_lost');
      } finally {
        redis.disconnect();
      }
    },
  };
}
