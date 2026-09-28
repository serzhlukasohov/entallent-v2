import { describe, expect, it, vi } from 'vitest';
import { CompanySetupUiController } from './company-setup-ui.controller';

function response() {
  const headers = new Map<string, string>();
  let contentType = '';
  let body = '';
  const reply = {
    header: vi.fn((name: string, value: string) => { headers.set(name, value); return reply; }),
    type: vi.fn((value: string) => { contentType = value; return reply; }),
    send: vi.fn((value: string) => { body = value; return reply; }),
  };
  return { reply, headers, get contentType() { return contentType; }, get body() { return body; } };
}

describe('dedicated Company setup UI', () => {
  it('serves a separate setup page with a same-origin script and a restrictive CSP', () => {
    const controller = new CompanySetupUiController();
    const html = response();
    controller.ui(html.reply as never);
    expect(html.contentType).toContain('text/html');
    expect(html.body).toContain('Company setup');
    expect(html.body).toContain('/api/v1/company-setup/ui.js');
    expect(html.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(html.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");

    const script = response();
    controller.script(script.reply as never);
    expect(script.contentType).toContain('application/javascript');
    expect(() => new Function(script.body)).not.toThrow();
    expect(script.body).toContain("credentials: 'same-origin'");
    expect(script.body).toContain("options.headers['x-csrf-token'] = csrf");
    expect(html.body).toContain('previous-lead-action');
    expect(html.body).toContain('Become an Employee in this Team');
    expect(script.body).toContain("'/promote-lead'");
    expect(html.body).toContain('previous-manager-action');
    expect(html.body).toContain('Become a direct Employee in this Unit');
    expect(script.body).toContain("'/promote-manager'");
    expect(html.body).toContain('advisor-units');
    expect(script.body).toContain("'/advisor-scope'");
    expect(html.body).toContain('deactivate-person-button');
    expect(script.body).toContain("'/deactivate'");
    expect(html.body).toContain('deactivate-team-lead-action');
    expect(script.body).toContain("{ leadAction }");
    expect(html.body).toContain('deactivate-unit-manager-action');
    expect(script.body).toContain("'/transfer-deactivate'");
    expect(html.body).toContain('edit-person-form');
    expect(html.body).toContain('edit-unit-form');
    expect(html.body).toContain('edit-team-form');
    expect(script.body).toContain("'/draft'");
    expect(html.body).toContain('draft-placement-person');
    expect(script.body).toContain("'/draft-placement'");
    expect(html.body).toContain('id="rollout-unit" multiple');
    expect(script.body).toContain("'/units/rollout/preview'");
    expect(script.body).toContain("'/units/rollout'");
    expect(script.body).toContain('renderHierarchy(snapshot)');
    expect(script.body).toContain('pending assignment');
    expect(html.body).toContain('First-contact delivery');
    expect(script.body).toContain('Sending · verify before retry');
  });
});
