import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SlackEventsController } from './slack-events.controller';
import { IngestionService } from './ingestion.service';
import { SlackIngestService } from './slack-ingest.service';

describe('SlackEventsController private error boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('acknowledges a failed event without logging its private error payload', async () => {
    const privateText = 'employee-private-message-marker';
    const pipeline = {
      processBody: vi.fn().mockRejectedValue(new Error(`database failure: ${privateText}`)),
    };
    const identity = { findWorkspaceIdentity: vi.fn().mockResolvedValue({ signingSecret: 'test-secret' }) };
    const config = { get: vi.fn() };
    const controller = new SlackEventsController(identity as never, pipeline as never, config as never);
    const logError = vi.spyOn((controller as unknown as { logger: { error: (...args: unknown[]) => void } })
      .logger, 'error').mockImplementation(() => undefined);
    const body = { type: 'event_callback', team_id: 'T1', event: { text: privateText } };
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v0=' + createHmac('sha256', 'test-secret')
      .update(`v0:${timestamp}:${rawBody}`).digest('hex');

    await expect(controller.handleEvent({ rawBody, headers: {
      'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature,
    } } as never, body)).resolves.toEqual({});

    expect(pipeline.processBody).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]).toEqual(['slack_event_processing_failed']);
  });

  it('does not ingest an event when the raw signed body is unavailable', async () => {
    const pipeline = { processBody: vi.fn() };
    const identity = { findWorkspaceIdentity: vi.fn() };
    const config = { get: vi.fn() };
    const controller = new SlackEventsController(identity as never, pipeline as never, config as never);

    await expect(controller.handleEvent({ headers: {} } as never, {
      type: 'event_callback', team_id: 'T1', event: { text: 'forged message' },
    })).resolves.toEqual({});

    expect(identity.findWorkspaceIdentity).not.toHaveBeenCalled();
    expect(pipeline.processBody).not.toHaveBeenCalled();
  });

  it('does not reveal a URL verification challenge without a valid signature', async () => {
    const privateText = 'employee-private-message-marker';
    const pipeline = { processBody: vi.fn() };
    const identity = { findWorkspaceIdentity: vi.fn().mockResolvedValue({ signingSecret: 'test-secret' }) };
    const config = { get: vi.fn().mockReturnValue('test-secret') };
    const controller = new SlackEventsController(identity as never, pipeline as never, config as never);
    const logWarn = vi.spyOn((controller as unknown as { logger: { warn: (...args: unknown[]) => void } })
      .logger, 'warn').mockImplementation(() => undefined);
    const body = { type: 'url_verification', team_id: privateText, challenge: 'private-challenge' };

    await expect(controller.handleEvent({ rawBody: JSON.stringify(body), headers: {} } as never, body))
      .resolves.toEqual({});

    expect(pipeline.processBody).not.toHaveBeenCalled();
    expect(logWarn.mock.calls).toEqual([['slack_signature_invalid']]);
  });

  it('acknowledges a signed URL challenge without a workspace ID', async () => {
    const pipeline = { processBody: vi.fn() };
    const identity = { findWorkspaceIdentity: vi.fn() };
    const config = { get: vi.fn().mockReturnValue('test-secret') };
    const controller = new SlackEventsController(identity as never, pipeline as never, config as never);
    const body = { type: 'url_verification', challenge: 'verified-challenge' };
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v0=' + createHmac('sha256', 'test-secret')
      .update(`v0:${timestamp}:${rawBody}`).digest('hex');

    await expect(controller.handleEvent({ rawBody, headers: {
      'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature,
    } } as never, body)).resolves.toEqual({ challenge: 'verified-challenge' });

    expect(identity.findWorkspaceIdentity).not.toHaveBeenCalled();
    expect(pipeline.processBody).not.toHaveBeenCalled();
  });

  it('verifies the raw HTTP payload through the mounted Fastify route', async () => {
    const pipeline = { processBody: vi.fn().mockResolvedValue(undefined) };
    const identity = { findWorkspaceIdentity: vi.fn().mockResolvedValue({ signingSecret: 'workspace-secret' }) };
    const config = { get: vi.fn().mockReturnValue('app-secret') };
    Reflect.defineMetadata('design:paramtypes',
      [IngestionService, SlackIngestService, ConfigService], SlackEventsController);
    @Module({
      controllers: [SlackEventsController],
      providers: [
        { provide: IngestionService, useValue: identity },
        { provide: SlackIngestService, useValue: pipeline },
        { provide: ConfigService, useValue: config },
      ],
    })
    class TestModule {}

    const app = await NestFactory.create<NestFastifyApplication>(TestModule,
      new FastifyAdapter({ logger: false }), { logger: false });
    try {
      app.setGlobalPrefix('api/v1');
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      fastify.removeContentTypeParser('application/json');
      fastify.addContentTypeParser('application/json', { parseAs: 'buffer' },
        (req, payload, done) => {
          (req as unknown as { rawBody: string }).rawBody = payload.toString('utf8');
          done(null, JSON.parse(payload.toString('utf8')));
        });

      const challenge = { type: 'url_verification', challenge: 'mounted-challenge' };
      const challengePayload = JSON.stringify(challenge);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const challengeSignature = 'v0=' + createHmac('sha256', 'app-secret')
        .update(`v0:${timestamp}:${challengePayload}`).digest('hex');
      const signed = await app.inject({ method: 'POST', url: '/api/v1/channel/slack/events',
        headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
          'x-slack-signature': challengeSignature }, payload: challengePayload });
      expect(signed.statusCode).toBe(200);
      expect(signed.json()).toEqual({ challenge: 'mounted-challenge' });

      const event = { type: 'event_callback', team_id: 'T1', event: { text: 'fixture' } };
      const eventPayload = JSON.stringify(event);
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/channel/slack/events',
        headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
          'x-slack-signature': challengeSignature }, payload: eventPayload });
      expect(invalid.statusCode).toBe(200);
      expect(pipeline.processBody).not.toHaveBeenCalled();

      const eventSignature = 'v0=' + createHmac('sha256', 'workspace-secret')
        .update(`v0:${timestamp}:${eventPayload}`).digest('hex');
      const valid = await app.inject({ method: 'POST', url: '/api/v1/channel/slack/events',
        headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp,
          'x-slack-signature': eventSignature }, payload: eventPayload });
      expect(valid.statusCode).toBe(200);
      expect(pipeline.processBody).toHaveBeenCalledOnce();
      expect(pipeline.processBody).toHaveBeenCalledWith(event);
    } finally {
      await app.close();
    }
  });
});
