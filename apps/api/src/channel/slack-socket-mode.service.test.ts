import { afterEach, describe, expect, it, vi } from 'vitest';

const socket = vi.hoisted(() => ({ handlers: new Map<string, (arg: unknown) => Promise<void>>() }));

vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: class {
    on(event: string, handler: (arg: unknown) => Promise<void>) { socket.handlers.set(event, handler); }
    async start() { return {}; }
    async disconnect() {}
  },
}));

import { SlackSocketModeService } from './slack-socket-mode.service';

afterEach(() => {
  delete process.env['SLACK_APP_TOKEN'];
  socket.handlers.clear();
});

describe('SlackSocketModeService interactive envelopes', () => {
  it('acks a block_actions envelope first and then hands the payload to processBody', async () => {
    process.env['SLACK_APP_TOKEN'] = 'xapp-test';
    const order: string[] = [];
    const pipeline = { processBody: vi.fn(async () => { order.push('process'); }) };
    new SlackSocketModeService(pipeline as never).onModuleInit();

    const body = { type: 'block_actions', team: { id: 'T1' }, actions: [] };
    const ack = vi.fn(async () => { order.push('ack'); });
    await socket.handlers.get('slack_event')!({ ack, body, envelope_id: 'e1', type: 'interactive' });

    expect(ack).toHaveBeenCalledOnce();
    expect(pipeline.processBody).toHaveBeenCalledWith(body);
    expect(order).toEqual(['ack', 'process']);
  });
});
