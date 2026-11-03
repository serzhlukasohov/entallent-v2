import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { conversationIndex, groupSearchResults, traceRowIdOf, turnDetail } from './trace-export-lib.mjs';

// The real report builder (built package), so a label or shape change in the export breaks these tests.
// Run `pnpm --filter @entalent/conversation-trace build` first in a fresh checkout.
const require = createRequire(import.meta.url);
const { buildTraceExportReport, TRACED_TURN_SCHEMA_VERSION } = require('../packages/conversation-trace/dist/index.js');

const TENANT = '7d1e0163-6d53-4713-bd24-254690cc5090';
const CONVERSATION = '1c0b8a5e-3d7f-4f2a-9a51-6f1f3c2b9e10';
const row = (n) => `00000000-0000-4000-8000-00000000000${n}`;

function payload(userMessage, responseText) {
  return {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage,
    trace: [
      { turn: 1, kind: 'llm', name: 'classifySituation', summary: 'intent=venting' },
      { turn: 1, kind: 'queue', name: 'outbox.enqueueMessageSend', summary: '{}' },
    ],
    turn: {
      index: 1,
      classification: { primaryIntent: 'venting', dialogueAct: 'statement', requiresSafetyCheck: false },
      responseInputs: { memoryContext: { items: ['work: sprint review on Friday'], goals: [] } },
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
    error: null,
    truncated: false,
  };
}

function record(ordinal, body, status = 'completed') {
  const startedAt = new Date(Date.UTC(2026, 10, 1, 9, ordinal));
  return {
    id: row(ordinal), conversationId: CONVERSATION, inboundMessageId: `10000000-0000-4000-8000-00000000000${ordinal}`,
    outboundMessageId: status === 'completed' ? `20000000-0000-4000-8000-00000000000${ordinal}` : null,
    traceId: null, status, startedAt, completedAt: new Date(startedAt.getTime() + 1500), ordinal, payload: body,
  };
}

const report = buildTraceExportReport({
  tenantId: TENANT,
  conversationId: CONVERSATION,
  turns: [
    record(1, payload('The release slipped again', 'That sounds draining. What slipped?')),
    record(2, null),
    record(3, { ...payload('QA handoff was late', 'x'), turn: null, error: 'model timeout' }, 'failed'),
  ],
  totalTurns: 3,
  generatedAt: new Date(Date.UTC(2026, 10, 1, 10)),
});

test('indexes every traced turn with its trace row id, texts and status', () => {
  const turns = conversationIndex(report);
  assert.equal(turns.length, 3);
  assert.deepEqual(turns[0], {
    step: 1, traceRowId: row(1), status: 'completed', employee: 'The release slipped again',
    bot: 'That sounds draining. What slipped?', missing: false,
  });
  assert.equal(turns[1].traceRowId, row(2));
  assert.equal(turns[1].missing, true);
  assert.equal(turns[2].status, 'failed');
  assert.equal(turns[2].employee, 'QA handoff was late');
});

test('reads no trace row id from a step without the trace section', () => {
  assert.equal(traceRowIdOf({ role: 'bot', text: 'hi', sections: [{ title: 'other', rows: [] }] }), null);
  assert.equal(traceRowIdOf({ role: 'bot', text: 'hi' }), null);
});

test('returns the details of one turn and null for an unknown id', () => {
  const detail = turnDetail(report, row(1).toUpperCase());
  assert.equal(detail.step, 1);
  assert.equal(detail.employee, 'The release slipped again');
  assert.ok(detail.sections.some((s) => s.title === 'Що зрозумів класифікатор'));
  assert.ok(detail.sections.every((s) => s.rows.every((r) => typeof r.value === 'string')));
  assert.equal(turnDetail(report, row(9)), null);
});

test('cuts long section values', () => {
  const big = { suite: { tests: [{ steps: [
    { role: 'user', text: 'u' },
    { role: 'bot', text: 'b', sections: [
      { title: 'Трейс ходу', rows: [{ key: 'трейс', value: `\`${row(1)}\`` }] },
      { title: 'big', rows: [{ key: 'k', value: 'x'.repeat(5000) }] },
    ] },
  ] }] } };
  const detail = turnDetail(big, row(1));
  assert.ok(detail.sections[1].rows[0].value.length < 1600);
  assert.match(detail.sections[1].rows[0].value, /full value in the report JSON/);
});

test('rejects a report without steps', () => {
  assert.throws(() => conversationIndex({ suite: { tests: [] } }), /not a trace export report/);
});

const match = (conversationId, traceRowId, startedAt, snippet) => ({
  traceRowId, conversationId, inboundMessageId: 'i', outboundMessageId: null, traceId: null, status: 'completed',
  startedAt, completedAt: startedAt, matchedIn: 'employee', snippet,
});
const searchResult = (matches, scanStopped = null) => ({
  tenantId: TENANT, window: { days: 7, since: '' }, limit: 20, scanned: 40, skipped: 0, scanStopped, matches,
});

test('ranks conversations by fragments hit, then by the latest match', () => {
  const grouped = groupSearchResults([
    searchResult([match('a', row(1), '2026-11-01T09:00:00.000Z', 'one'), match('b', row(5), '2026-11-01T11:00:00.000Z', 'one')]),
    searchResult([match('a', row(2), '2026-11-01T09:05:00.000Z', 'two')]),
    searchResult([match('c', row(7), '2026-11-01T12:00:00.000Z', 'three')]),
  ]);
  assert.equal(grouped.fragments, 3);
  assert.equal(grouped.complete, true);
  assert.deepEqual(grouped.conversations.map((c) => [c.conversationId, c.fragmentsHit]), [['a', [1, 2]], ['c', [3]], ['b', [1]]]);
  assert.deepEqual(grouped.conversations.map((c) => c.tiedWithNext), [false, true, false]);
  assert.deepEqual(grouped.conversations[0].matches.map((m) => [m.fragment, m.traceRowId]), [[1, row(1)], [2, row(2)]]);
  assert.equal(grouped.conversations[0].lastMatchAt, '2026-11-01T09:05:00.000Z');
});

test('marks the grouping incomplete when a scan was cut and handles no matches', () => {
  const grouped = groupSearchResults([searchResult([], 'row_limit'), searchResult([])]);
  assert.equal(grouped.complete, false);
  assert.deepEqual(grouped.conversations, []);
  assert.deepEqual(grouped.searches.map((s) => s.matches), [0, 0]);
});
