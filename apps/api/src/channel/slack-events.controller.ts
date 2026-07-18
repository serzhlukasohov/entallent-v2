import { Controller, Post, Req, Body, HttpCode, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SlackAdapter } from '@entalent/channel-slack';
import { IngestionService } from './ingestion.service';
import { SlackIngestService } from './slack-ingest.service';

@Controller('channel/slack')
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly pipeline: SlackIngestService,
  ) {}

  @Post('events')
  @HttpCode(200)
  async handleEvent(
    @Req() req: FastifyRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Slack URL verification handshake
    if (body['type'] === 'url_verification') {
      return { challenge: body['challenge'] };
    }

    // Verify request signature using the workspace signing secret
    const teamId = (body['team_id'] as string | undefined) ?? '';
    const rawBody = (req as unknown as { rawBody?: string }).rawBody;

    if (rawBody) {
      const identity = await this.ingestion.findWorkspaceIdentity('slack', teamId);
      if (!identity) {
        this.logger.warn(`Unknown Slack workspace: ${teamId}`);
        return {};
      }

      const adapter = new SlackAdapter({ signingSecret: identity.signingSecret });
      const valid = await adapter.verifyRequest({ headers: req.headers, rawBody });
      if (!valid) {
        this.logger.warn(`Invalid Slack signature for team ${teamId}`);
        return {};
      }
    }

    // Delegate to the shared pipeline (idempotency + save + enqueue)
    await this.pipeline.processBody(body).catch((err: unknown) => {
      this.logger.error('Slack event processing failed', err);
    });

    return {};
  }
}
