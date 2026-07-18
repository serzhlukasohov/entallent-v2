import { Injectable } from '@nestjs/common';
import { RedisService } from '../queue/redis.service';

const TTL_SECONDS = 86_400; // 24 h — Slack retries are always within minutes

@Injectable()
export class EventIdempotencyService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Returns true if this eventId has never been seen before (and marks it as seen).
   * Returns false if it is a duplicate — caller should skip processing.
   */
  async isNew(eventId: string): Promise<boolean> {
    const key = `slack:event:${eventId}`;
    const result = await this.redis.client.set(key, '1', 'EX', TTL_SECONDS, 'NX');
    return result === 'OK';
  }
}
