export function redisConnectionFromUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('invalid_redis_protocol');
  }
  const rawDatabase = url.pathname.slice(1);
  const db = rawDatabase ? Number(rawDatabase) : 0;
  if (!Number.isInteger(db) || db < 0) throw new Error('invalid_redis_database');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    db,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
