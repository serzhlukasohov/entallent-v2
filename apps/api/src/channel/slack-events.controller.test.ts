import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SlackEventsController } from './slack-events.controller';

const SECRET = 'signing-secret';
const payload = { type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'D1' }, actions: [] };

function signed(rawBody: string, secret = SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
  return { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig };
}

function setup() {
  const ingestion = { findWorkspaceIdentity: vi.fn().mockResolvedValue({ tenantId: 't1', signingSecret: SECRET }) };
  const pipeline = { processBody: vi.fn().mockResolvedValue(undefined) };
  return { controller: new SlackEventsController(ingestion as never, pipeline as never), ingestion, pipeline };
}

describe('SlackEventsController.handleInteraction', () => {
  const form = { payload: JSON.stringify(payload) };
  const rawBody = `payload=${encodeURIComponent(form.payload)}`;

  it('returns 401 without a signature', async () => {
    const { controller, pipeline } = setup();
    await expect(controller.handleInteraction({ headers: {}, rawBody } as never, form)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(pipeline.processBody).not.toHaveBeenCalled();
  });

  it('returns 401 without a raw body', async () => {
    const { controller } = setup();
    await expect(controller.handleInteraction({ headers: signed(rawBody) } as never, form)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns 401 for a signature made with the wrong secret', async () => {
    const { controller, pipeline } = setup();
    await expect(controller.handleInteraction({ headers: signed(rawBody, 'other'), rawBody } as never, form))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(pipeline.processBody).not.toHaveBeenCalled();
  });

  it('returns 401 for an unknown workspace', async () => {
    const { controller, ingestion } = setup();
    ingestion.findWorkspaceIdentity.mockResolvedValue(null);
    await expect(controller.handleInteraction({ headers: signed(rawBody), rawBody } as never, form))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes the parsed payload to the ingest pipeline when the signature is valid', async () => {
    const { controller, pipeline, ingestion } = setup();
    await expect(controller.handleInteraction({ headers: signed(rawBody), rawBody } as never, form)).resolves.toEqual({});
    expect(ingestion.findWorkspaceIdentity).toHaveBeenCalledWith('slack', 'T1');
    expect(pipeline.processBody).toHaveBeenCalledWith(payload);
  });
});
