import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { TRACED_TURN_SCHEMA_VERSION, type TracedTurnPayload } from '@entalent/conversation-trace';
import { encryptField } from '@entalent/crypto-utils';
import { ApiKeyGuard } from '../auth/api-key.guard';
import type { AuditLogRepository } from '../audit/audit-log.repository';
import { ConversationTraceAdminController } from './conversation-trace-admin.controller';
import { shouldMountConversationTraceAdmin } from './conversation-trace-admin.mount';
import { ConversationTraceAdminService, TRACE_SEARCH_BOUNDS } from './conversation-trace-admin.service';
import type { ConversationTraceReader, StoredTraceRow, TraceCursor } from './conversation-trace.reader';

const KEY = 'a'.repeat(64);
const OTHER_KEY = 'c'.repeat(64);
const TENANT_A = '7d1e0163-6d53-4713-bd24-254690cc5090';
const TENANT_B = '8d1e0163-6d53-4713-bd24-254690cc5090';
const CONVERSATION = '1c0b8a5e-3d7f-4f2a-9a51-6f1f3c2b9e10';
const NOW = Date.parse('2026-11-01T12:00:00Z');

function payload(userMessage: string, responseText: string | null, error: string | null = null): TracedTurnPayload {
  return {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage,
    trace: [{ turn: 1, kind: error ? 'error' : 'decision', name: error ? 'orchestrate' : 'turn outcome', summary: error ?? 'mode=coach' }],
    turn: responseText === null ? null : {
      index: 1,
      classification: { primaryIntent: 'venting' },
      responseInputs: null,
      effects: { outboundMetadata: null, memoryAdded: [], escalations: [], generationAttempts: 1 },
      mode: 'coach',
      primaryIntent: 'venting',
      requiresSafetyCheck: false,
      risk: { severity: 'none', type: null },
      responseLength: responseText.length,
      responseText,
      replyPlan: null,
      replyBrief: null,
    },
    error,
    truncated: false,
  };
}

let seq = 0;
function stored(tenantId: string, minutesAgo: number, body: TracedTurnPayload | string, key = KEY): StoredTraceRow & { tenantId: string } {
  seq += 1;
  const startedAt = new Date(NOW - minutesAgo * 60_000);
  const failed = typeof body !== 'string' && body.turn === null;
  return {
    tenantId,
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    userId: '9d1e0163-6d53-4713-bd24-254690cc5090',
    conversationId: CONVERSATION,
    inboundMessageId: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    outboundMessageId: failed ? null : `20000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    traceId: null,
    status: failed ? 'failed' : 'completed',
    schemaVersion: 1,
    payloadEncrypted: encryptField(typeof body === 'string' ? body : JSON.stringify(body), key),
    startedAt,
    completedAt: new Date(startedAt.getTime() + 2000),
  };
}

/** In-memory reader with the same tenant filter and ordering as the SQL one. */
class FakeReader {
  readonly pageCalls: Array<{ tenantId: string; size: number }> = [];
  readonly turnCalls: Array<{ tenantId: string; id: string }> = [];
  /** Tenants with the `conversation_trace_test_tenant` marker on, and since when. */
  testTenants = new Map<string, Date>();
  constructor(readonly rows: Array<StoredTraceRow & { tenantId: string }>) {}

  turn(tenantId: string, id: string): Promise<StoredTraceRow | null> {
    this.turnCalls.push({ tenantId, id });
    return Promise.resolve(this.rows.find((r) => r.tenantId === tenantId && r.id === id) ?? null);
  }

  testTenantSince(tenantId: string): Promise<Date | null> {
    return Promise.resolve(this.testTenants.get(tenantId) ?? null);
  }

  page(tenantId: string, since: Date, before: TraceCursor | null, size: number): Promise<StoredTraceRow[]> {
    this.pageCalls.push({ tenantId, size });
    const ordered = this.rows
      .filter((r) => r.tenantId === tenantId && r.startedAt >= since)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id.localeCompare(a.id))
      .filter((r) => !before || r.startedAt < before.startedAt || (r.startedAt.getTime() === before.startedAt.getTime() && r.id < before.id));
    return Promise.resolve(ordered.slice(0, size));
  }

  conversation(tenantId: string, conversationId: string, limit: number) {
    const all = this.rows
      .filter((r) => r.tenantId === tenantId && r.conversationId === conversationId)
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const rows = all.slice(-limit);
    return Promise.resolve({ rows, olderCount: all.length - rows.length });
  }
}

function setup(rows: Array<StoredTraceRow & { tenantId: string }>, audit = vi.fn(async () => true)) {
  const reader = new FakeReader(rows);
  const service = new ConversationTraceAdminService(
    reader as unknown as ConversationTraceReader,
    { append: audit } as unknown as AuditLogRepository,
    { get: () => KEY } as never,
  );
  service.now = () => NOW;
  const controller = new ConversationTraceAdminController(service);
  return { reader, service, controller, audit };
}

describe('conversation trace search', () => {
  it('finds an employee message by a fragment ignoring case and spacing, within the tenant only', async () => {
    const hit = stored(TENANT_A, 10, payload('My  Sprint Review is on Friday', 'Sounds busy.'));
    const { controller, reader, audit } = setup([
      hit,
      stored(TENANT_A, 20, payload('Nothing to see', 'ok')),
      stored(TENANT_B, 5, payload('my sprint review too', 'other tenant')),
    ]);
    const result = await controller.search(TENANT_A, { text: '  sprint REVIEW ' });
    expect(result.matches).toEqual([expect.objectContaining({
      traceRowId: hit.id,
      conversationId: CONVERSATION,
      inboundMessageId: hit.inboundMessageId,
      outboundMessageId: hit.outboundMessageId,
      status: 'completed',
      startedAt: hit.startedAt.toISOString(),
      matchedIn: 'employee',
      snippet: 'my sprint review is on friday',
    })]);
    expect(result).toMatchObject({ tenantId: TENANT_A, scanned: 2, skipped: 0, scanStopped: null, limit: 20, window: { days: 7 } });
    expect(reader.pageCalls.every((call) => call.tenantId === TENANT_A)).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_A, actorType: 'admin', action: 'admin.conversation_trace_searched', resourceType: 'tenant', resourceId: TENANT_A,
    }));
  });

  it('matches the bot reply when the employee message does not contain the fragment', async () => {
    const { controller } = setup([stored(TENANT_A, 1, payload('hi', 'What worries you most this week?'))]);
    const result = await controller.search(TENANT_A, { text: 'worries you most' });
    expect(result.matches[0]).toMatchObject({ matchedIn: 'bot' });
  });

  it('returns nothing for text stored only in another tenant', async () => {
    const { controller } = setup([stored(TENANT_B, 1, payload('secret plan', 'ok'))]);
    await expect(controller.search(TENANT_A, { text: 'secret plan' })).resolves.toMatchObject({ matches: [], scanned: 0 });
  });

  it('skips and counts rows it cannot decrypt or parse, without returning them', async () => {
    const { controller } = setup([
      stored(TENANT_A, 1, payload('sprint review', 'ok'), OTHER_KEY),
      stored(TENANT_A, 2, '{"schemaVersion":9,"trace":[]}'),
      stored(TENANT_A, 3, payload('sprint review again', 'ok')),
    ]);
    const result = await controller.search(TENANT_A, { text: 'sprint review' });
    expect(result).toMatchObject({ scanned: 3, skipped: 2 });
    expect(result.matches).toHaveLength(1);
  });

  it('stops at the row limit, decrypting at most the bound', async () => {
    const rows = Array.from({ length: TRACE_SEARCH_BOUNDS.maxScannedRows + 50 }, (_, i) => stored(TENANT_A, i % 600, payload(`message ${i}`, 'ok')));
    const { controller, reader } = setup(rows);
    const result = await controller.search(TENANT_A, { text: 'not there', days: 30 });
    expect(result).toMatchObject({ scanned: TRACE_SEARCH_BOUNDS.maxScannedRows, scanStopped: 'row_limit', matches: [] });
    expect(reader.pageCalls.every((call) => call.size <= TRACE_SEARCH_BOUNDS.pageSize)).toBe(true);
  });

  it('does not report a row limit when the window holds exactly the bound', async () => {
    const rows = Array.from({ length: TRACE_SEARCH_BOUNDS.maxScannedRows }, (_, i) => stored(TENANT_A, i % 600, payload(`message ${i}`, 'ok')));
    const { controller } = setup(rows);
    await expect(controller.search(TENANT_A, { text: 'not there', days: 30 }))
      .resolves.toMatchObject({ scanned: TRACE_SEARCH_BOUNDS.maxScannedRows, scanStopped: null });
  });

  it('does not return the employee user id with a match', async () => {
    const { controller } = setup([stored(TENANT_A, 1, payload('my sprint review', 'ok'))]);
    const result = await controller.search(TENANT_A, { text: 'sprint review' });
    expect(result.matches[0]).not.toHaveProperty('userId');
  });

  it('stops at the time budget', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => stored(TENANT_A, i, payload(`message ${i}`, 'ok')));
    const { controller, service } = setup(rows);
    let clock = NOW;
    service.now = () => {
      clock += 400;
      return clock;
    };
    const result = await controller.search(TENANT_A, { text: 'not there' });
    expect(result.scanStopped).toBe('time_limit');
    expect(result.scanned).toBeLessThan(30);
  });

  it('stops at the match limit and honours the window', async () => {
    const { controller } = setup([
      stored(TENANT_A, 1, payload('sprint one', 'ok')),
      stored(TENANT_A, 2, payload('sprint two', 'ok')),
      stored(TENANT_A, 60 * 24 * 3, payload('sprint old', 'ok')),
    ]);
    await expect(controller.search(TENANT_A, { text: 'sprint', limit: 1 })).resolves.toMatchObject({ scanStopped: 'match_limit', scanned: 1 });
    const windowed = await controller.search(TENANT_A, { text: 'sprint', days: 1 });
    expect(windowed.matches.map((m) => m.snippet)).toEqual(['sprint one', 'sprint two']);
  });

  it('rejects a short, long or missing fragment and out-of-range bounds', async () => {
    const { controller, audit } = setup([]);
    await expect(controller.search(TENANT_A, { text: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search(TENANT_A, { text: 'x'.repeat(501) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search(TENANT_A, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search(TENANT_A, { text: 'abc', days: 31 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search(TENANT_A, { text: 'abc', limit: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.search(TENANT_A, { text: 'abc', limit: '2.5' })).rejects.toBeInstanceOf(BadRequestException);
    expect(audit).not.toHaveBeenCalled();
  });

  it('never writes the fragment or message text into the audit row', async () => {
    const { controller, audit } = setup([stored(TENANT_A, 1, payload('my sprint review', 'ok'))]);
    await controller.search(TENANT_A, { text: 'sprint review' });
    const written = JSON.stringify(audit.mock.calls);
    expect(written).not.toContain('sprint');
    expect(audit.mock.calls[0]).toEqual([expect.objectContaining({
      metadata: {
        days: 7, limit: 20, fragmentLength: 13, scanned: 1, skipped: 0, matches: 1, scanStopped: null,
        matchedTraceRowIds: [expect.any(String)], matchedConversationIds: [CONVERSATION],
      },
    })]);
  });

  it('fails without returning matches when the audit write fails', async () => {
    const audit = vi.fn(async () => { throw new Error('db down'); });
    const { controller } = setup([stored(TENANT_A, 1, payload('my sprint review', 'ok'))], audit);
    await expect(controller.search(TENANT_A, { text: 'sprint review' })).rejects.toThrow('db down');
  });
});

describe('conversation trace export', () => {
  it('exports every traced turn as report JSON, numbered by its place in the conversation', async () => {
    const rows = [
      stored(TENANT_A, 30, payload('first', 'reply one')),
      stored(TENANT_A, 20, payload('second', null, 'Error: provider down')),
      stored(TENANT_A, 10, payload('third', 'reply three')),
      stored(TENANT_B, 5, payload('other tenant', 'never shown')),
    ];
    const { controller, audit } = setup(rows);
    const report = await controller.exportConversation(CONVERSATION, TENANT_A);
    const test = report.suite.tests[0]!;
    expect(test.steps.map((m) => m.text)).toEqual([
      'first', 'reply one', 'second', 'Відповіді немає: хід упав з помилкою. Error: provider down', 'third', 'reply three',
    ]);
    expect(test.status).toBe('failed');
    expect(report.suite.counts).toMatchObject({ total: 1, failed: 1, passed: 0 });
    expect(JSON.stringify(report)).not.toContain('never shown');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_A, action: 'admin.conversation_trace_exported', resourceType: 'conversation', resourceId: CONVERSATION,
      metadata: { limit: 100, turns: 3, totalTurns: 3, unreadable: 0 },
    }));
  });

  it('keeps the newest turns within the limit and numbers them after the older ones', async () => {
    const rows = [1, 2, 3, 4].map((n) => stored(TENANT_A, 50 - n, payload(`turn ${n}`, `reply ${n}`)));
    const { controller } = setup(rows);
    const report = await controller.exportConversation(CONVERSATION, TENANT_A, '2');
    expect(report.suite.tests[0]!.steps.map((m) => m.label)).toEqual([
      'працівник · крок 3', 'бот · крок 3 · 7 симв.', 'працівник · крок 4', 'бот · крок 4 · 7 симв.',
    ]);
    await expect(controller.exportConversation(CONVERSATION, TENANT_A, '201')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('answers 404 for a conversation the tenant has no trace of, after auditing the attempt', async () => {
    const { controller, audit } = setup([stored(TENANT_B, 1, payload('x', 'y'))]);
    await expect(controller.exportConversation(CONVERSATION, TENANT_A)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.conversation_trace_exported', metadata: expect.objectContaining({ turns: 0 }) }));
  });

  it('fails without a report when the audit write fails', async () => {
    const audit = vi.fn(async () => { throw new Error('db down'); });
    const { controller } = setup([stored(TENANT_A, 1, payload('x', 'y'))], audit);
    await expect(controller.exportConversation(CONVERSATION, TENANT_A)).rejects.toThrow('db down');
  });
});

/** A traced turn with captured state, as the worker stores it since story 6 (synthetic data). */
function withState(userMessage: string): TracedTurnPayload {
  const at = (minute: number) => new Date(NOW - (60 - minute) * 60_000).toISOString();
  return {
    ...payload(userMessage, 'Got it.'),
    stateBefore: {
      conversation: { userDisplayName: 'Sam', userTimezone: 'Europe/Kyiv', hasActiveTopic: false },
      messages: [
        { id: 'p-1', direction: 'outbound', text: 'How is the week going?', occurredAt: at(0) },
        { id: 'p-in', direction: 'inbound', text: userMessage, occurredAt: at(5) },
      ],
      inboundIndex: 1,
      messagesLimit: 20,
      memory: [{ category: 'work', content: 'Leads the release checklist', importance: 0.8 }],
      goals: [],
      readAfterWrite: [],
    },
  };
}

describe('conversation trace precondition extraction', () => {
  function testTenantSetup(rows: Array<StoredTraceRow & { tenantId: string }>, audit = vi.fn(async () => true)) {
    const built = setup(rows, audit);
    built.reader.testTenants.set(TENANT_A, new Date(NOW - 24 * 60 * 60_000));
    return built;
  }

  it('returns the precondition and a draft that still needs expected results, and audits ids only', async () => {
    const row = stored(TENANT_A, 10, withState('Release slipped again'));
    const { controller, audit } = testTenantSetup([row]);
    const extraction = await controller.extractPrecondition(row.id, TENANT_A);

    expect(extraction.precondition).toMatchObject({
      schemaVersion: 1,
      origin: { kind: 'trace', tenantId: TENANT_A, turnId: row.id, conversationId: CONVERSATION },
      history: [{ role: 'bot', text: 'How is the week going?', minutesBeforeStart: 5 }],
      memory: [{ category: 'work', content: 'Leads the release checklist', importance: 0.8 }],
    });
    expect(extraction.testDraft).toMatchObject({ replies: ['Release slipped again'], expected: [], precondition: extraction.files.precondition });
    expect(extraction.files.testDraft).toMatch(/^drafts\/trace-[0-9a-f]{8}\.json$/);
    // No user id, inbound id or internal message id reaches the files.
    expect(JSON.stringify(extraction)).not.toMatch(new RegExp(`${row.userId}|${row.inboundMessageId}|p-in`));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_A, action: 'admin.conversation_trace_precondition_extracted',
      resourceType: 'conversation_turn_trace', resourceId: row.id,
      metadata: expect.objectContaining({ outcome: 'extracted', conversationId: CONVERSATION, historyMessages: 1 }),
    }));
    expect(JSON.stringify(audit.mock.calls)).not.toContain('Release slipped');
  });

  it.each([
    ['no marker', () => undefined],
    ['marker on another tenant only', (reader: FakeReader) => reader.testTenants.set(TENANT_B, new Date(0))],
  ])('refuses with 403 not_test_tenant (%s) before reading the row', async (_name, mark) => {
    const row = stored(TENANT_A, 10, withState('Release slipped again'));
    const { controller, reader, audit } = setup([row]);
    mark(reader);
    const refusal = await controller.extractPrecondition(row.id, TENANT_A).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect((refusal as ForbiddenException).getResponse()).toMatchObject({ code: 'not_test_tenant' });
    expect(reader.turnCalls).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { outcome: 'refused:not_test_tenant' } }));
  });

  it('answers 404 for a row of another tenant, even when both are test tenants', async () => {
    const row = stored(TENANT_B, 10, withState('Other tenant text'));
    const { controller, reader } = testTenantSetup([row]);
    reader.testTenants.set(TENANT_B, new Date(0));
    const refusal = await controller.extractPrecondition(row.id, TENANT_A).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(NotFoundException);
    expect((refusal as NotFoundException).getResponse()).toMatchObject({ code: 'trace_not_found' });
    expect(reader.turnCalls).toEqual([{ tenantId: TENANT_A, id: row.id }]);
  });

  it.each([
    ['trace_state_not_captured', () => payload('Release slipped again', 'ok') as TracedTurnPayload | string, KEY],
    ['trace_payload_unreadable', () => withState('Release slipped again'), OTHER_KEY],
  ])('answers 409 %s', async (code, body, key) => {
    const row = stored(TENANT_A, 10, body(), key);
    const { controller, audit } = testTenantSetup([row]);
    const refusal = await controller.extractPrecondition(row.id, TENANT_A).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({ code });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { outcome: `refused:${code}`, conversationId: CONVERSATION } }));
  });

  it('refuses a turn traced before the tenant was marked, without decrypting it', async () => {
    const row = stored(TENANT_A, 10, withState('Release slipped again'), OTHER_KEY);
    const { controller, reader, audit } = setup([row]);
    reader.testTenants.set(TENANT_A, new Date(NOW - 5 * 60_000));
    const refusal = await controller.extractPrecondition(row.id, TENANT_A).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ForbiddenException);
    // OTHER_KEY would answer trace_payload_unreadable had the row been opened.
    expect((refusal as ForbiddenException).getResponse()).toMatchObject({ code: 'traced_before_test_mark' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { outcome: 'refused:traced_before_test_mark', conversationId: CONVERSATION } }));
  });

  it('audits an unexpected failure as failed and rethrows it', async () => {
    const { controller, reader, audit } = testTenantSetup([]);
    reader.turn = () => Promise.reject(new Error('db down'));
    await expect(controller.extractPrecondition(CONVERSATION, TENANT_A)).rejects.toThrow('db down');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { outcome: 'failed' } }));
  });

  it('answers 409 for a state section with the wrong shape instead of failing', async () => {
    const broken = withState('Release slipped again');
    (broken.stateBefore!.messages![0] as unknown as Record<string, unknown>)['text'] = 42;
    const row = stored(TENANT_A, 10, broken);
    const { controller } = testTenantSetup([row]);
    const refusal = await controller.extractPrecondition(row.id, TENANT_A).catch((error: unknown) => error);
    expect((refusal as ConflictException).getResponse()).toMatchObject({ code: 'trace_state_not_captured' });
  });

  it('extracts a failed turn and says so in the draft', async () => {
    const failed = { ...withState('Release slipped again'), turn: null, error: 'Error: provider down' };
    const row = stored(TENANT_A, 10, failed);
    const { controller } = testTenantSetup([row]);
    const extraction = await controller.extractPrecondition(row.id, TENANT_A);
    expect(extraction.testDraft.title).toContain('the original turn failed');
  });

  it('returns nothing when the audit write fails', async () => {
    const row = stored(TENANT_A, 10, withState('Release slipped again'));
    const audit = vi.fn(async () => { throw new Error('db down'); });
    const { controller } = testTenantSetup([row], audit);
    await expect(controller.extractPrecondition(row.id, TENANT_A)).rejects.toThrow('db down');
  });
});

describe('conversation trace admin routes', () => {
  it('are guarded by the admin key and validate tenantId as a UUID', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ConversationTraceAdminController)).toEqual([ApiKeyGuard]);
    const proto = ConversationTraceAdminController.prototype;
    expect(Reflect.getMetadata('method', proto.search)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('method', proto.exportConversation)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('method', proto.extractPrecondition)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('path', proto.extractPrecondition)).toBe('turns/:traceRowId/precondition');
    const extractParams = Reflect.getMetadata('__routeArguments__', ConversationTraceAdminController, 'extractPrecondition') as Record<string, { data: string; pipes: unknown[] }>;
    expect(Object.values(extractParams).map((p) => [p.data, p.pipes.length]).sort()).toEqual([['tenantId', 1], ['traceRowId', 1]]);
    const params = Reflect.getMetadata('__routeArguments__', ConversationTraceAdminController, 'search') as Record<string, { data: string; pipes: unknown[] }>;
    const tenantParam = Object.values(params).find((p) => p.data === 'tenantId');
    expect(tenantParam?.pipes.length).toBe(1);
  });

  it('mount only on explicit opt-in', () => {
    expect(shouldMountConversationTraceAdmin({})).toBe(false);
    expect(shouldMountConversationTraceAdmin({ CONVERSATION_TRACE_ADMIN_ENABLED: 'false' })).toBe(false);
    expect(shouldMountConversationTraceAdmin({ CONVERSATION_TRACE_ADMIN_ENABLED: 'true' })).toBe(true);
    expect(shouldMountConversationTraceAdmin({ CONVERSATION_TRACE_ADMIN_ENABLED: '1' })).toBe(true);
  });
});
