import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TRACED_TURN_SCHEMA_VERSION, type TracedTurnPayload } from '../turn';

import {
  buildTraceExportReport,
  findFragment,
  parseTracedTurnPayload,
  type TracedTurnRecord,
} from './trace-export';
import { stepBadges, turnSections } from './turn-view';

const REPORT_DIR = join(__dirname, '../../../conversation-sim/report');
const SCHEMA = JSON.parse(readFileSync(join(REPORT_DIR, 'suite-report.schema.json'), 'utf8')) as JsonSchema;

const TENANT = '7d1e0163-6d53-4713-bd24-254690cc5090';
const CONVERSATION = '1c0b8a5e-3d7f-4f2a-9a51-6f1f3c2b9e10';

function completedPayload(userMessage: string, responseText: string): TracedTurnPayload {
  return {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage,
    trace: [
      { turn: 1, kind: 'inbound', name: 'employee message', summary: userMessage },
      { turn: 1, kind: 'llm', name: 'classifySituation', summary: 'intent=venting' },
      { turn: 1, kind: 'write', name: 'memory.save', summary: '{content: "has a sprint review"}' },
      { turn: 1, kind: 'queue', name: 'outbox.enqueueMessageSend', summary: '{}' },
      { turn: 1, kind: 'decision', name: 'turn outcome', summary: 'mode=coach' },
    ],
    turn: {
      index: 1,
      classification: { primaryIntent: 'venting', dialogueAct: 'statement', emotionalState: ['stressed'], requiresSafetyCheck: false },
      responseInputs: { memoryContext: { items: ['work: sprint review on Friday'], goals: [] }, cycleProgress: { inCycle: true, topicsClosed: 1, topicsTotal: 4 } },
      effects: { outboundMetadata: { replyShape: { askedQuestion: true, maxQuestions: 1 } }, memoryAdded: [], escalations: [], generationAttempts: 1 },
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

function record(ordinal: number, payload: TracedTurnPayload | null, status: 'completed' | 'failed' = 'completed'): TracedTurnRecord {
  const startedAt = new Date(Date.UTC(2026, 10, 1, 9, ordinal));
  return {
    id: `00000000-0000-4000-8000-00000000000${ordinal}`,
    conversationId: CONVERSATION,
    inboundMessageId: `10000000-0000-4000-8000-00000000000${ordinal}`,
    outboundMessageId: status === 'completed' ? `20000000-0000-4000-8000-00000000000${ordinal}` : null,
    traceId: null,
    status,
    startedAt,
    completedAt: new Date(startedAt.getTime() + 1500),
    ordinal,
    payload,
  };
}

function exportOfThree() {
  const failed: TracedTurnPayload = {
    schemaVersion: TRACED_TURN_SCHEMA_VERSION,
    userMessage: 'and another thing',
    trace: [{ turn: 1, kind: 'error', name: 'orchestrate', summary: 'Error: provider down' }],
    turn: null,
    error: 'Error: provider down',
    truncated: false,
  };
  return buildTraceExportReport({
    tenantId: TENANT,
    conversationId: CONVERSATION,
    turns: [
      record(4, completedPayload('My Sprint Review is on Friday', 'Sounds like a busy week. What worries you most?')),
      record(5, failed, 'failed'),
      record(6, null),
    ],
    totalTurns: 6,
    generatedAt: new Date('2026-11-01T10:00:00Z'),
  });
}

describe('buildTraceExportReport', () => {
  it('produces suite-report JSON valid against the sim report schema', () => {
    expect(validate(SCHEMA, exportOfThree(), SCHEMA)).toEqual([]);
  });

  it('shows every traced turn as an employee/bot pair numbered by its place in the conversation', () => {
    const test = exportOfThree().suite.tests[0]!;
    expect(test.steps.map((m) => [m.role, m.label])).toEqual([
      ['user', 'працівник · крок 4'], ['bot', 'бот · крок 4 · 47 симв.'],
      ['user', 'працівник · крок 5'], ['bot', 'бот · крок 5'],
      ['user', 'працівник · крок 6'], ['bot', 'бот · крок 6'],
    ]);
    expect(test.stepsSummary).toBe('3 кроки, 1 з помилкою, ще 3 раніших не показано');
    const [, completedBot, , failedBot, , unreadableBot] = test.steps;
    expect(completedBot!.sections!.map((s) => s.title)).toContain('Ланцюжок подій: виклики LLM, записи в базу і черги, рішення');
    expect(completedBot!.sections!.at(-1)!.title).toBe('Трейс ходу');
    expect(completedBot!.badges!.map((b) => b.label)).toEqual(['пам\'ять']);
    expect(failedBot).toMatchObject({ missing: true, text: 'Відповіді немає: хід упав з помилкою. Error: provider down' });
    expect(failedBot!.badges!.map((b) => b.label)).toEqual(['помилка']);
    expect(unreadableBot).toMatchObject({ missing: true });
    expect(test.status).toBe('failed');
    expect(test.actual.comparisons.map((c) => c.met)).toEqual([false, 'info']);
  });

  it('fills the shared turn sections with the classifier, pulse cycle and humanized reply metadata', () => {
    const bot = exportOfThree().suite.tests[0]!.steps[1]!;
    const section = (title: string) => bot.sections!.find((s) => s.title === title)!;
    expect(section('Що зрозумів класифікатор').rows).toEqual(expect.arrayContaining([
      { key: 'інтент', value: '`venting`' },
      { key: 'емоції', value: 'stressed' },
    ]));
    expect(section('Pulse-цикл').rows).toEqual(expect.arrayContaining([{ key: 'цикл', value: 'відкритий: закрито 1 з 4 тем' }]));
    expect(section('Стан розмови').rows).toEqual(expect.arrayContaining([{ key: 'пам\'ять у контексті', value: ['work: sprint review on Friday'] }]));
    expect(section('Інші метадані відповіді').rows).toEqual([{
      key: 'форма відповіді',
      value: { 'питання у відповіді': 'так', 'макс. питань': 1, 'чому стільки': undefined, 'коротка сесія': 'ні' },
    }]);
  });

  it('shows a completed turn cut to the minimum as truncated, not as a crash', () => {
    const cut: TracedTurnPayload = { ...completedPayload('long message', 'long reply'), turn: null, truncated: true };
    const report = buildTraceExportReport({
      tenantId: TENANT, conversationId: CONVERSATION, turns: [record(1, cut)], totalTurns: 1, generatedAt: new Date('2026-11-01T10:00:00Z'),
    });
    const test = report.suite.tests[0]!;
    expect(test.status).toBe('passed');
    expect(test.steps[1]!.text).not.toContain('упав');
    expect(test.steps[1]!.sections!.at(-1)!.rows.map((r) => r.key)).toContain('обрізано');
  });

  it('marks an export with no readable trace as an error, not a pass', () => {
    const report = buildTraceExportReport({
      tenantId: TENANT, conversationId: CONVERSATION, turns: [record(1, null)], totalTurns: 1, generatedAt: new Date('2026-11-01T10:00:00Z'),
    });
    expect(report.suite.tests[0]!.status).toBe('error');
    expect(report.suite.counts).toMatchObject({ error: 1, passed: 0 });
    expect(validate(SCHEMA, report, SCHEMA)).toEqual([]);
  });

  it('renders with render-report.mjs into the sim report page', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-export-'));
    const json = join(dir, 'export.json');
    const html = join(dir, 'export.html');
    writeFileSync(json, JSON.stringify(exportOfThree()));
    const child = spawnSync(process.execPath, [join(REPORT_DIR, 'render-report.mjs'), json, html], { encoding: 'utf8' });
    expect(child.status, child.stderr).toBe(0);
    const page = readFileSync(html, 'utf8');
    expect(page).toContain('<title>Трейс розмови 1c0b8a5e</title>');
    expect(page).toContain('My Sprint Review is on Friday');
    expect(page).toContain('"eyebrow":"conversation-trace"');
  });
});

describe('findFragment', () => {
  const payload = completedPayload('My  Sprint\nReview is on Friday, it’s tense', 'Sounds like a busy week.');

  it('matches the employee message ignoring case, whitespace runs and typographic quotes', () => {
    expect(findFragment(payload, 'sprint review')).toEqual({ matchedIn: 'employee', snippet: 'my sprint review is on friday, it\'s tense' });
    expect(findFragment(payload, "it's TENSE")?.matchedIn).toBe('employee');
  });

  it('falls back to the bot reply and returns null when neither side matches', () => {
    expect(findFragment(payload, 'busy week')).toMatchObject({ matchedIn: 'bot' });
    expect(findFragment(payload, 'vacation')).toBeNull();
    expect(findFragment(payload, '   ')).toBeNull();
  });

  it('clips the snippet around the hit', () => {
    const long = completedPayload(`${'a'.repeat(200)} needle ${'b'.repeat(200)}`, '');
    const match = findFragment(long, 'needle');
    expect(match?.snippet.startsWith('…')).toBe(true);
    expect(match?.snippet.endsWith('…')).toBe(true);
    expect(match!.snippet.length).toBeLessThan(140);
  });
});

describe('parseTracedTurnPayload', () => {
  it('accepts a v1 payload and rejects other versions, shapes and broken JSON', () => {
    const payload = completedPayload('hi', 'hello');
    expect(parseTracedTurnPayload(JSON.stringify(payload))).toEqual(payload);
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, schemaVersion: 2 }))).toBeNull();
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, trace: 'x' }))).toBeNull();
    expect(parseTracedTurnPayload('{not json')).toBeNull();
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, userMessage: 42 }))).toBeNull();
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, turn: { ...payload.turn, responseText: null } }))).toBeNull();
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, trace: [null] }))).toBeNull();
  });

  it('keeps a well-formed state section and drops a malformed one without rejecting the row', () => {
    const payload = completedPayload('hi', 'hello');
    const stateBefore = { readAfterWrite: [], memory: [] };
    expect(parseTracedTurnPayload(JSON.stringify({ ...payload, stateBefore }))?.stateBefore).toEqual(stateBefore);
    const malformed = parseTracedTurnPayload(JSON.stringify({ ...payload, stateBefore: 'x' }));
    expect(malformed).not.toBeNull();
    expect(malformed && 'stateBefore' in malformed).toBe(false);
  });
});

describe('shared turn view', () => {
  it('reads old sim runs without a trace from the turn effects', () => {
    const turn = { index: 1, classification: { primaryIntent: 'x' }, effects: { memoryAdded: [{ category: 'work', content: 'c' }], escalations: [], generationAttempts: 1 }, risk: { severity: 'none', type: null } };
    expect(stepBadges(turn, undefined).map((b) => b.label)).toEqual(['пам\'ять']);
    expect(turnSections({ index: 1 }, undefined)[0]!.title).toBe('Розбір ходу');
  });
});

// Enough of JSON Schema 2020-12 for suite-report.schema.json: type, enum, required, properties, items, $ref.
interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validate(schema: JsonSchema, value: unknown, root: JsonSchema, path = '$'): string[] {
  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    const target = root.$defs?.[name];
    if (!target) return [`${path}: unknown $ref ${schema.$ref}`];
    return validate(target, value, root, path);
  }
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
      return [...errors, `${path}: expected ${types.join('|')}, got ${actual}`];
    }
  }
  if (typeOf(value) === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${path}: missing ${key}`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in object && object[key] !== undefined) errors.push(...validate(sub, object[key], root, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...validate(schema.items!, item, root, `${path}[${i}]`)));
  return errors;
}
