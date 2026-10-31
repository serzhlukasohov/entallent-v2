import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SocketModeClient } from '@slack/socket-mode';
import { SlackIngestService } from './slack-ingest.service';
import { isReportingRightsInteractionBody, reportingRightsErrorCode } from './reporting-rights-interaction';

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
      const b = body as Record<string, unknown>;
      // Reporting-rights clicks are admitted durably in PostgreSQL before the ack (Slack never retries
      // interactions). A failed admission is not acknowledged, so Slack shows the employee an error.
      if (isReportingRightsInteractionBody(b)) {
        try {
          await this.pipeline.processBody(b);
        } catch (error) {
          this.logger.error(`slack_reporting_rights_admission_failed code=${reportingRightsErrorCode(error)}`);
          return;
        }
        await ack();
        return;
      }
      // Ack within 3 seconds — then process asynchronously
      await ack();

      if (b['type'] === 'url_verification') return;

      this.pipeline.processBody(b).catch(() => {
        this.logger.error('slack_socket_event_processing_failed');
      });
    });

    this.client.start().catch(() => {
      this.logger.error('slack_socket_start_failed');
    });

    this.logger.log('Slack Socket Mode client started');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}
