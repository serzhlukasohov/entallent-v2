import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SlackEventsController } from './slack-events.controller';
import { createHmac } from 'crypto';

describe('SlackEventsController onboarding interactions', () => {
  it('rejects missing raw body or invalid signature before enqueue', async () => {
    const processBody = vi.fn();
    const controller = new SlackEventsController({ findWorkspaceIdentity: async () => ({ signingSecret: 'synthetic-secret' }) } as never, { processBody } as never);
    await expect(controller.handleAction({ headers: {} } as never, { payload: '{}' })).rejects.toBeInstanceOf(UnauthorizedException);
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_actions', team: { id: 'T1' } }));
    await expect(controller.handleAction({ headers: {}, rawBody } as never, { payload: JSON.stringify({ team: { id: 'T1' } }) })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processBody).not.toHaveBeenCalled();
  });
  it('verifies the exact URL-encoded body with the workspace secret', async () => {
    const body = { type: 'block_actions', team: { id: 'T1' } };
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v0=' + createHmac('sha256', 'synthetic-secret').update(`v0:${timestamp}:${rawBody}`).digest('hex');
    const processBody = vi.fn();
    const controller = new SlackEventsController({ findWorkspaceIdentity: async () => ({ signingSecret: 'synthetic-secret' }) } as never, { processBody } as never);
    await controller.handleAction({ rawBody, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature } } as never, { payload: JSON.stringify(body) });
    expect(processBody).toHaveBeenCalledWith(body);
  });
});
