import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../queue/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const result = await this.redis.client.ping();
      if (result !== 'PONG') {
        throw new Error(`Unexpected ping response: ${result}`);
      }
      return this.getStatus(key, true);
    } catch (error: unknown) {
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { error: String(error) }),
      );
    }
  }
}
