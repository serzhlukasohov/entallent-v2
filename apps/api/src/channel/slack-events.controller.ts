import { Controller, Post, Req, Body, HttpCode, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { SlackAdapter } from '@entalent/channel-slack';
import type { Env } from '@entalent/config';
import { IngestionService } from './ingestion.service';
import { SlackIngestService } from './slack-ingest.service';

@Controller('channel/slack')
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly pipeline: SlackIngestService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('events')
  @HttpCode(200)
  async handleEvent(
    @Req() req: FastifyRequest,
    @Body() body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Verify the raw Slack request before handling any payload.
    const teamId = (body['team_id'] as string | undefined) ?? '';
    const rawBody = (req as unknown as { rawBody?: string }).rawBody;
    if (!rawBody) {
      this.logger.warn('slack_signed_body_missing');
      return {};
    }
    const isChallenge = body['type'] === 'url_verification';
    const appSigningSecret = isChallenge
      ? this.config.get('SLACK_SIGNING_SECRET', { infer: true })
      : undefined;
    const identity = appSigningSecret
      ? null
      : teamId ? await this.ingestion.findWorkspaceIdentity('slack', teamId) : null;
    const signingSecret = appSigningSecret ?? identity?.signingSecret;
    if (!signingSecret) {
      this.logger.warn('slack_signing_secret_unavailable');
      return {};
    }

    const adapter = new SlackAdapter({ signingSecret });
    const valid = await adapter.verifyRequest({ headers: req.headers, rawBody });
    if (!valid) {
      this.logger.warn('slack_signature_invalid');
      return {};
    }

    // Slack URL verification handshake
    if (isChallenge) {
      return { challenge: body['challenge'] };
    }

    // Delegate to the shared pipeline (idempotency + save + enqueue)
    await this.pipeline.processBody(body).catch(() => {
      this.logger.error('slack_event_processing_failed');
    });

    return {};
  }
}
