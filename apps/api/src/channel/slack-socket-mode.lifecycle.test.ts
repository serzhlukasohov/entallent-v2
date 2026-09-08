import { SocketModeClient } from '@slack/socket-mode';
import { afterEach, describe, expect, it, vi } from 'vitest';

class TestableSocketModeClient extends SocketModeClient {
  receive(payload: Record<string, unknown>): Promise<void> {
    return this.onWebSocketMessage(Buffer.from(JSON.stringify(payload)), false);
  }
}

describe('Slack Socket Mode lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
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
});
