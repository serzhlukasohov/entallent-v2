import { Controller, Post, Req, Body, HttpCode, Logger, UnauthorizedException } from '@nestjs/common';
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

  /** Block Kit button clicks (HTTP delivery). Slack posts `payload=<json>` form-urlencoded. */
  @Post('interactions')
  @HttpCode(200)
  async handleInteraction(
    @Req() req: FastifyRequest,
    @Body() form: { payload?: unknown },
  ): Promise<Record<string, unknown>> {
    const rawBody = (req as unknown as { rawBody?: string }).rawBody;
    if (!rawBody || typeof form?.payload !== 'string') {
      throw new UnauthorizedException('Invalid Slack interaction');
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(form.payload) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Invalid Slack interaction');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new UnauthorizedException('Invalid Slack interaction');
    }
    const teamId = (payload['team'] as { id?: string } | undefined)?.id;
    if (!teamId) throw new UnauthorizedException('Invalid Slack interaction');

    const identity = await this.ingestion.findWorkspaceIdentity('slack', teamId);
    const adapter = identity ? new SlackAdapter({ signingSecret: identity.signingSecret }) : null;
    if (!adapter || !(await adapter.verifyRequest({ headers: req.headers, rawBody }))) {
      this.logger.warn(`Invalid Slack interaction signature for team ${teamId}`);
      throw new UnauthorizedException('Invalid Slack signature');
    }

    await this.pipeline.processBody(payload).catch((err: unknown) => {
      this.logger.error('Slack interaction processing failed', err);
    });
    return {};
  }

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
