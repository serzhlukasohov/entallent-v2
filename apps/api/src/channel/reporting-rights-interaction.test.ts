import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

const socket = vi.hoisted(() => ({ handlers: new Map<string, (arg: unknown) => Promise<void>>() }));
vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: class {
    on(event: string, handler: (arg: unknown) => Promise<void>) { socket.handlers.set(event, handler); }
    async start() { return {}; }
    async disconnect() {}
  },
}));

import { handleReportingRightsInteraction, isReportingRightsInteractionBody, reportingRightsErrorCode, ReportingRightsQueueJobs } from './reporting-rights-interaction';
import { SlackSocketModeService } from './slack-socket-mode.service';
import { SlackEventsController } from './slack-events.controller';
import { SlackIngestService } from './slack-ingest.service';
import type { SlackInteractionEvent } from './slack-interaction';

const MENU = '00000000-0000-4000-8000-0000000000a1';
const event = (over: Partial<SlackInteractionEvent['payload']> = {}): SlackInteractionEvent => ({
  type: 'interaction',
  payload: { externalWorkspaceId: 'T1', externalUserId: 'U1', externalChannelId: 'D1', messageTs: '1.0', actionId: 'reporting_rights:confirm', value: MENU, actionTs: '2.0', ...over },
});
const deps = (over: Record<string, unknown> = {}) => ({
  findWorkspaceIdentity: vi.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
  findLinkedPersonId: vi.fn().mockResolvedValue('person-1'),
  intake: { handleClick: vi.fn().mockResolvedValue({ outcome: 'admitted', admissionId: 'a', created: true, enqueued: true }) },
  debug: vi.fn(),
  ...over,
});

afterEach(() => {
  delete process.env['SLACK_APP_TOKEN'];
  socket.handlers.clear();
  vi.restoreAllMocks();
});

describe('RPT-09 reporting-rights interaction verification', () => {
  it('derives tenant and subject from the signed workspace/user and the linked person only', async () => {
    const d = deps();
    await handleReportingRightsInteraction(event({ value: `${MENU}:2`, actionId: 'reporting_rights:topic' }), d);
    expect(d.findLinkedPersonId).toHaveBeenCalledWith({ tenantId: 'tenant-1', channelType: 'slack', externalWorkspaceId: 'T1', externalUserId: 'U1' });
    expect(d.intake.handleClick).toHaveBeenCalledWith({
      tenantId: 'tenant-1', userId: 'person-1', channelType: 'slack', externalWorkspaceId: 'T1', externalUserId: 'U1',
      externalChannelId: 'D1', action: 'topic', menuId: MENU, index: 2, actionTs: '2.0',
    });
  });

  it.each([
    ['non-DM channel', event({ externalChannelId: 'C1' }), {}, 'not_dm'],
    ['unknown action id', event({ actionId: 'reporting_rights:delete_all' }), {}, 'unknown_action'],
    ['lineage id forged into the value', event({ value: `${MENU}:00000000-0000-4000-8000-0000000000b1` }), {}, 'invalid_value'],
    ['unknown workspace', event(), { findWorkspaceIdentity: vi.fn().mockResolvedValue(null) }, 'unknown_workspace'],
    ['unlinked user', event(), { findLinkedPersonId: vi.fn().mockResolvedValue(null) }, 'unlinked_user'],
  ])('drops %s with a typed reason and no admission', async (_label, input, over, reason) => {
    const d = deps(over);
    expect(await handleReportingRightsInteraction(input, d)).toEqual({ outcome: 'dropped', reason });
    expect(d.intake.handleClick).not.toHaveBeenCalled();
    expect(d.debug).toHaveBeenCalledWith(`Dropping reporting-rights interaction: ${reason}`);
  });

  it('recognizes only single rights block_actions bodies', () => {
    expect(isReportingRightsInteractionBody({ type: 'block_actions', actions: [{ action_id: 'reporting_rights:confirm' }] })).toBe(true);
    expect(isReportingRightsInteractionBody({ type: 'block_actions', actions: [{ action_id: 'onboarding:start' }] })).toBe(false);
    expect(isReportingRightsInteractionBody({ type: 'block_actions', actions: [{ action_id: 'reporting_rights:confirm' }, { action_id: 'reporting_rights:confirm' }] })).toBe(false);
    expect(isReportingRightsInteractionBody({ type: 'event_callback', actions: [{ action_id: 'reporting_rights:confirm' }] })).toBe(false);
  });

  it('uses deterministic job ids so duplicate clicks collapse on the same admission', async () => {
    const queue = { add: vi.fn() };
    const jobs = new ReportingRightsQueueJobs(queue);
    await jobs.enqueue({ kind: 'apply', tenantId: MENU, admissionId: MENU });
    await jobs.enqueue({ kind: 'render', tenantId: MENU, menuId: MENU, view: 'confirm', page: 0, clickTs: '2.0' });
    expect(queue.add.mock.calls.map((c) => c[2].jobId)).toEqual([`reporting-rights-apply-${MENU}`, `reporting-rights-render-${MENU}-confirm-0-2.0`]);
    expect(queue.add.mock.calls.every((c) => c[2].removeOnComplete && c[2].removeOnFail)).toBe(true);
  });

  it('logs a lost transport after commit without failing the click, and logs only typed error codes', async () => {
    const d = { ...deps(), warn: vi.fn() };
    d.intake.handleClick.mockResolvedValue({ outcome: 'admitted', admissionId: 'a', created: true, enqueued: false });
    expect(await handleReportingRightsInteraction(event(), d)).toMatchObject({ outcome: 'admitted', enqueued: false });
    expect(d.warn).toHaveBeenCalledWith('reporting_rights_enqueue_failed outcome=admitted');
    expect(reportingRightsErrorCode(new Error('reporting_rights_admission_conflict'))).toBe('reporting_rights_admission_conflict');
    expect(reportingRightsErrorCode(new Error('duplicate key value "private text"'))).toBe('unclassified');
    expect(reportingRightsErrorCode('x')).toBe('unclassified');
  });
});

describe('RPT-09 admission before acknowledgement', () => {
  const rightsBody = { type: 'block_actions', team: { id: 'T1' }, actions: [{ action_id: 'reporting_rights:confirm' }] };

  it('socket mode processes a rights click before acking it', async () => {
    process.env['SLACK_APP_TOKEN'] = 'xapp-test';
    const order: string[] = [];
    const pipeline = { processBody: vi.fn(async () => { order.push('admit'); }) };
    new SlackSocketModeService(pipeline as never).onModuleInit();
    const ack = vi.fn(async () => { order.push('ack'); });
    await socket.handlers.get('slack_event')!({ ack, body: rightsBody });
    expect(order).toEqual(['admit', 'ack']);
  });

  it('socket mode does not ack a rights click whose admission failed', async () => {
    process.env['SLACK_APP_TOKEN'] = 'xapp-test';
    const pipeline = { processBody: vi.fn().mockRejectedValue(new Error('reporting_rights_admission_conflict')) };
    const service = new SlackSocketModeService(pipeline as never);
    const logError = vi.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);
    service.onModuleInit();
    const ack = vi.fn();
    await socket.handlers.get('slack_event')!({ ack, body: rightsBody });
    expect(ack).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('slack_reporting_rights_admission_failed code=reporting_rights_admission_conflict');
  });

  const signed = (body: unknown, secret = 'test-secret') => {
    const rawBody = 'payload=' + encodeURIComponent(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex');
    return { req: { rawBody, headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature } }, form: { payload: JSON.stringify(body) } };
  };
  const controller = (processBody: ReturnType<typeof vi.fn>) => {
    const c = new SlackEventsController({ findWorkspaceIdentity: vi.fn().mockResolvedValue({ signingSecret: 'test-secret' }) } as never, { processBody } as never, { get: vi.fn() } as never);
    vi.spyOn((c as unknown as { logger: { error: () => void; warn: () => void } }).logger, 'error').mockImplementation(() => undefined);
    vi.spyOn((c as unknown as { logger: { error: () => void; warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    return c;
  };

  it('HTTP returns 200 only after the admission path completed, and an error when it failed', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const s = signed(rightsBody);
    await expect(controller(ok).handleInteraction(s.req as never, s.form)).resolves.toEqual({});
    expect(ok).toHaveBeenCalledOnce();
    const failed = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(controller(failed).handleInteraction(s.req as never, s.form)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects an unsigned rights body before any admission', async () => {
    const processBody = vi.fn();
    const s = signed(rightsBody, 'wrong-secret');
    await expect(controller(processBody).handleInteraction(s.req as never, s.form)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processBody).not.toHaveBeenCalled();
  });

  it('routes rights clicks away from onboarding and fails closed when intake is not wired', async () => {
    const ingestion = { findWorkspaceIdentity: vi.fn().mockResolvedValue({ tenantId: 'tenant-1', signingSecret: 's' }), findLinkedPersonId: vi.fn(), findOnboardingIntroTarget: vi.fn() };
    const onboardingQueue = { add: vi.fn() };
    const service = new SlackIngestService(ingestion as never, { isNew: vi.fn() } as never, { add: vi.fn() } as never, onboardingQueue as never);
    const body = { type: 'block_actions', team: { id: 'T1' }, user: { id: 'U1' }, channel: { id: 'D1' }, container: { message_ts: '1.0' }, actions: [{ action_id: 'reporting_rights:confirm', value: MENU, action_ts: '2.0' }] };
    await expect(service.processBody(body)).rejects.toThrow('reporting_rights_intake_unavailable');
    expect(onboardingQueue.add).not.toHaveBeenCalled();
    expect(ingestion.findOnboardingIntroTarget).not.toHaveBeenCalled();
  });
});
