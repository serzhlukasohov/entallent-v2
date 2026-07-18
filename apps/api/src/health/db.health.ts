import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DatabaseService } from '../database/database.service';
import { sql } from 'drizzle-orm';

@Injectable()
export class DbHealthIndicator extends HealthIndicator {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.db.client.execute(sql`SELECT 1`);
      return this.getStatus(key, true);
    } catch (error: unknown) {
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { error: String(error) }),
      );
    }
  }
}
