import { describe, expect, it } from 'vitest';
import { redisConnectionFromUrl } from './redis-connection';

describe('admin Redis connection', () => {
  it('preserves the database, credentials, and TLS from REDIS_URL', () => {
    expect(redisConnectionFromUrl('rediss://report%40user:secret%20word@redis.example:6380/15'))
      .toEqual({
        host: 'redis.example', port: 6380, db: 15,
        username: 'report@user', password: 'secret word', tls: {},
      });
  });

  it('uses Redis defaults when no database or port is specified', () => {
    expect(redisConnectionFromUrl('redis://localhost')).toEqual({
      host: 'localhost', port: 6379, db: 0,
    });
  });

  it('rejects invalid database and protocol values', () => {
    expect(() => redisConnectionFromUrl('redis://localhost/not-a-db'))
      .toThrow('invalid_redis_database');
    expect(() => redisConnectionFromUrl('https://localhost/0'))
      .toThrow('invalid_redis_protocol');
  });
});
