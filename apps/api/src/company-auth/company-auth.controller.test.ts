import { describe, expect, it, vi } from 'vitest';
import { CompanyAuthController } from './company-auth.controller';

function reply() {
  const headers = new Map<string, unknown>();
  return {
    headers,
    header: vi.fn((name: string, value: unknown) => { headers.set(name, value); }),
    redirect: vi.fn(),
    send: vi.fn(),
  };
}

describe('CompanyAuthController browser boundary', () => {
  it('sets a secure browser state cookie and redirects to the configured IdP', async () => {
    const sessions = { start: vi.fn().mockResolvedValue({
      authorizationUrl: 'https://id.example.test/authorize', state: 'browser-state',
    }) };
    const controller = new CompanyAuthController(sessions as never);
    const response = reply();
    await controller.start('tenant-id', response as never);
    expect(sessions.start).toHaveBeenCalledWith('tenant-id');
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://id.example.test/authorize');
    expect(response.headers.get('Set-Cookie')).toBe(
      '__Host-entalent-oidc-state=browser-state; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax',
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('requires the matching browser cookie and redirects to the dedicated setup UI', async () => {
    const sessions = { complete: vi.fn().mockResolvedValue({
      token: 'opaque-session', expiresAt: new Date(Date.now() + 3_600_000),
    }) };
    const controller = new CompanyAuthController(sessions as never);
    const response = reply();
    await expect(controller.callback('code', 'state', { headers: {} } as never, response as never))
      .rejects.toThrow('access denied');
    expect(sessions.complete).not.toHaveBeenCalled();
    await controller.callback('code', 'state', {
      headers: { cookie: '__Host-entalent-oidc-state=state' },
    } as never, response as never);
    expect(sessions.complete).toHaveBeenCalledWith('code', 'state', 'state');
    expect(response.headers.get('Set-Cookie')).toEqual([
      '__Host-entalent-oidc-state=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
      expect.stringContaining('__Host-entalent-company-session=opaque-session; Path=/;'),
    ]);
    expect(response.redirect).toHaveBeenCalledWith(303, '/api/v1/company-setup/ui');
    expect(response.send).not.toHaveBeenCalled();
  });

  it('requires CSRF proof before revoking a session', async () => {
    const sessions = { verifyCsrf: vi.fn().mockReturnValue(false), revoke: vi.fn() };
    const controller = new CompanyAuthController(sessions as never);
    const request = { headers: { cookie: '__Host-entalent-company-session=opaque-session' } };
    const response = reply();
    await expect(controller.logout(request as never, 'wrong', response as never)).rejects.toThrow('access denied');
    expect(sessions.revoke).not.toHaveBeenCalled();
    sessions.verifyCsrf.mockReturnValue(true);
    await controller.logout(request as never, 'correct', response as never);
    expect(sessions.revoke).toHaveBeenCalledWith('opaque-session');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
