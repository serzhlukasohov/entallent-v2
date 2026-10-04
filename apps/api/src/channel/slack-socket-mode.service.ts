import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SocketModeClient } from '@slack/socket-mode';
import { SlackIngestService } from './slack-ingest.service';

/**
 * Socket Mode keeps a persistent WebSocket to Slack — no public HTTP endpoint
 * needed. Used alongside the HTTP webhook controller (which handles installations
 * that still use Event Subscriptions over HTTP).
 *
 * Enabled only when SLACK_APP_TOKEN is present in the environment.
 */
@Injectable()
export class SlackSocketModeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackSocketModeService.name);
  private client: SocketModeClient | null = null;

  constructor(private readonly pipeline: SlackIngestService) {}

  onModuleInit(): void {
    const appToken = process.env['SLACK_APP_TOKEN'];
    if (!appToken) {
      this.logger.log('SLACK_APP_TOKEN not set — Socket Mode disabled');
      return;
    }

    this.client = new SocketModeClient({ appToken });

    this.client.on('slack_event', async ({ ack, body }) => {
      // Ack within 3 seconds — then process asynchronously
      await ack();

      const b = body as Record<string, unknown>;
      if (b['type'] === 'url_verification') return;

      this.pipeline.processBody(b).catch((err: unknown) => {
        this.logger.error('Socket Mode event processing failed', err);
      });
    });

    this.client.start().catch((err: unknown) => {
      this.logger.error('Failed to start Socket Mode client', err);
    });

    this.logger.log('Slack Socket Mode client started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}
