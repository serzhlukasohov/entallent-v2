import { SocketModeClient } from '@slack/socket-mode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlackSocketModeService } from './slack-socket-mode.service';

class TestableSocketModeClient extends SocketModeClient {
  receive(payload: Record<string, unknown>): Promise<void> {
    return this.onWebSocketMessage(Buffer.from(JSON.stringify(payload)), false);
  }
}

describe('Slack Socket Mode lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reconnects instead of throwing when Slack disconnects before the handshake completes', async () => {
    vi.useFakeTimers();

    const client = new TestableSocketModeClient({
      appToken: 'xapp-test',
      clientPingTimeout: 1,
    });
    const start = vi.spyOn(client, 'start').mockResolvedValue({ ok: true } as never);
    const disconnect = vi.fn(() => client.emit('close'));
    (client as unknown as { websocket: { disconnect(): void } }).websocket = { disconnect };

    await expect(
      client.receive({ type: 'disconnect', reason: 'refresh_requested' }),
    ).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);

    expect(start).toHaveBeenCalledOnce();
  });

  it('logs only safe codes when a private event or socket start fails', async () => {
    const previousToken = process.env['SLACK_APP_TOKEN'];
    process.env['SLACK_APP_TOKEN'] = 'xapp-test';
    try {
      const privateText = 'employee-private-message-marker';
      const on = vi.spyOn(SocketModeClient.prototype, 'on');
      vi.spyOn(SocketModeClient.prototype, 'start')
        .mockRejectedValue(new Error(`start failed: ${privateText}`));
      const pipeline = {
        processBody: vi.fn().mockRejectedValue(new Error(`event failed: ${privateText}`)),
      };
      const service = new SlackSocketModeService(pipeline as never);
      const logError = vi.spyOn((service as unknown as { logger: {
        error: (...args: unknown[]) => void,
      } }).logger, 'error').mockImplementation(() => undefined);

      service.onModuleInit();
      const eventHandler = on.mock.calls.find(([eventName]) => eventName === 'slack_event')?.[1] as
        ((event: { ack: () => Promise<void>; body: Record<string, unknown> }) => Promise<void>);
      expect(eventHandler).toBeTypeOf('function');
      await eventHandler({
        ack: async () => undefined,
        body: { type: 'event_callback', event: { text: privateText } },
      });
      await vi.waitFor(() => expect(logError).toHaveBeenCalledTimes(2));

      expect(logError.mock.calls).toEqual(expect.arrayContaining([
        ['slack_socket_start_failed'],
        ['slack_socket_event_processing_failed'],
      ]));
    } finally {
      if (previousToken === undefined) delete process.env['SLACK_APP_TOKEN'];
      else process.env['SLACK_APP_TOKEN'] = previousToken;
    }
  });
});
