import type { TraceEvent } from '../events';
import { TRACED_TURN_SCHEMA_VERSION, type TracedTurnPayload } from '../turn';
import {
  eventChainSection,
  stepBadges,
  turnSections,
  type ReportBadge,
  type ReportRow,
  type ReportSection,
  type ReportTurnView,
} from './turn-view';

/** One chat message of the suite report (`suite-report.schema.json` `$defs/message`). */
export interface ReportMessage {
  role: 'user' | 'bot';
  label?: string;
  text: string;
  seed?: boolean;
  missing?: boolean;
  notes?: string[];
  badges?: ReportBadge[];
  sections?: ReportSection[];
}

export interface ReportComparison {
  source: string;
  expected: string;
  actual: string;
  met: true | false | 'info';
}

export type ReportStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface SuiteReportTest {
  id: string;
  name: string;
  status: ReportStatus;
  duration?: string;
  descriptionSummary?: string;
  description: ReportRow[];
  given: { summary?: string; rows: ReportRow[]; history?: ReportMessage[] };
  stepsSummary?: string;
  steps: ReportMessage[];
  stepsEmpty?: string;
  actual: {
    summary?: string;
    failure?: string | null;
    comparisons: ReportComparison[];
    judge: { title: string; reasoning?: string | null };
  };
}

/** The suite report JSON that `render-report.mjs` turns into a page. */
export interface SuiteReport {
  meta: { eyebrow?: string; title: string; details?: string[] };
  suite: {
    counts: { total: number; passed: number; failed: number; error?: number; skipped?: number };
    tests: SuiteReportTest[];
  };
}

/** One stored traced turn as the admin API reads it; `payload` is null when it could not be decrypted or parsed. */
export interface TracedTurnRecord {
  id: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  traceId: string | null;
  status: 'completed' | 'failed';
  startedAt: Date;
  completedAt: Date;
  /** 1-based position among the conversation's retained traces, by start time. */
  ordinal: number;
  payload: TracedTurnPayload | null;
}

export interface TraceExportInput {
  tenantId: string;
  conversationId: string;
  /** Oldest first. */
  turns: TracedTurnRecord[];
  /** Traces the conversation has in retention; more than `turns.length` means older ones were left out. */
  totalTurns: number;
  generatedAt: Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses a decrypted payload; null for another schema version or a shape this reader does not know. */
export function parseTracedTurnPayload(json: string): TracedTurnPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || value['schemaVersion'] !== TRACED_TURN_SCHEMA_VERSION || !Array.isArray(value['trace'])) return null;
  const turn = value['turn'];
  if (turn !== null && (!isRecord(turn) || typeof turn['responseText'] !== 'string')) return null;
  if (value['userMessage'] !== null && typeof value['userMessage'] !== 'string') return null;
  if (!value['trace'].every((event) => isRecord(event) && typeof event['name'] === 'string' && typeof event['kind'] === 'string')) return null;
  // A malformed state section makes the row unusable for extraction, not for reading.
  if ('stateBefore' in value && (!isRecord(value['stateBefore']) || !Array.isArray(value['stateBefore']['readAfterWrite']))) {
    const { stateBefore: _malformed, ...rest } = value;
    void _malformed;
    return rest as unknown as TracedTurnPayload;
  }
  return value as unknown as TracedTurnPayload;
}

export type FragmentSide = 'employee' | 'bot';

export interface FragmentMatch {
  matchedIn: FragmentSide;
  snippet: string;
}

const SNIPPET_CONTEXT = 60;

/**
 * Normalizes text the way a person retypes it from Slack: case, runs of whitespace and typographic
 * quotes and dashes do not matter.
 */
export function normalizeForMatch(value: string): string {
  return value
    .replace(/[‘’‛′]/g, '\'')
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Finds `fragment` in the employee message, then the bot reply; returns where and a short snippet around it. */
export function findFragment(payload: TracedTurnPayload, fragment: string): FragmentMatch | null {
  const needle = normalizeForMatch(fragment);
  if (!needle) return null;
  const sides: Array<[FragmentSide, string | null | undefined]> = [
    ['employee', payload.userMessage],
    ['bot', payload.turn?.responseText],
  ];
  for (const [side, raw] of sides) {
    if (!raw) continue;
    const haystack = normalizeForMatch(raw);
    const at = haystack.indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - SNIPPET_CONTEXT);
    const end = Math.min(haystack.length, at + needle.length + SNIPPET_CONTEXT);
    return { matchedIn: side, snippet: `${start > 0 ? '…' : ''}${haystack.slice(start, end)}${end < haystack.length ? '…' : ''}` };
  }
  return null;
}

const iso = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19);
const STATUS_LABEL = { completed: 'хід завершився', failed: 'хід упав з помилкою' } as const;

function traceSection(record: TracedTurnRecord): ReportSection {
  const durationMs = record.completedAt.getTime() - record.startedAt.getTime();
  const rows: ReportRow[] = [
    { key: 'статус', value: STATUS_LABEL[record.status], tone: record.status === 'failed' ? 'bad' : undefined },
    { key: 'початок', value: `${iso(record.startedAt)} UTC · ${durationMs} мс` },
    { key: 'вхідне повідомлення', value: `\`${record.inboundMessageId}\`` },
    { key: 'відповідь бота', value: record.outboundMessageId ? `\`${record.outboundMessageId}\`` : '—' },
    { key: 'трейс', value: `\`${record.id}\`${record.traceId ? ` · traceId \`${record.traceId}\`` : ''}` },
  ];
  if (record.payload?.truncated) rows.push({ key: 'обрізано', value: 'частину подій або тексту відкинуто, щоб трейс уклався в ліміт', tone: 'warn' });
  return { title: 'Трейс ходу', rows, summary: `${record.status} · ${iso(record.startedAt)} UTC` };
}

function stepsFor(record: TracedTurnRecord): ReportMessage[] {
  const n = record.ordinal;
  const payload = record.payload;
  const user: ReportMessage = {
    role: 'user',
    label: `працівник · крок ${n}`,
    text: payload ? payload.userMessage ?? '(репліку не записано в трейсі)' : '(трейс не прочитано)',
  };
  if (!payload) {
    return [user, {
      role: 'bot', label: `бот · крок ${n}`, missing: true,
      text: 'Трейс цього ходу не вдалося прочитати: інший ключ шифрування, інша версія формату або пошкоджений запис.',
      sections: [traceSection(record)],
    }];
  }
  // Production stores each turn as turn 1; the export renumbers events to the turn's place in the conversation.
  const events: TraceEvent[] = payload.trace.map((event) => ({ ...event, turn: n }));
  if (payload.turn) {
    const turn = { ...payload.turn, index: n } as unknown as ReportTurnView;
    return [user, {
      role: 'bot',
      label: `бот · крок ${n} · ${payload.turn.responseLength} симв.`,
      text: payload.turn.responseText,
      sections: [...turnSections(turn, events), traceSection(record)],
      badges: stepBadges(turn, events),
    }];
  }
  // The serializer's last size reduction drops the structured turn of a completed turn: it did reply.
  const text = record.status === 'completed'
    ? 'Хід завершився, але трейс обрізано до мінімуму: тексту відповіді й розбору ходу немає, лишилися події.'
    : `Відповіді немає: хід упав з помилкою. ${payload.error ?? ''}`.trim();
  return [user, {
    role: 'bot', label: `бот · крок ${n}`, missing: true,
    text,
    sections: [eventChainSection(events), traceSection(record)],
    badges: stepBadges({ index: n }, events),
  }];
}

const plural = (n: number, one: string, few: string, many: string): string =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

/**
 * A production conversation as a one-test suite report: every traced turn becomes an employee/bot step
 * pair with the same «деталі» and icons a sim run shows. The test fails when any traced turn failed.
 */
export function buildTraceExportReport(input: TraceExportInput): SuiteReport {
  const { turns } = input;
  const failedTurns = turns.filter((t) => t.status === 'failed');
  const unreadable = turns.filter((t) => !t.payload);
  // Nothing readable says nothing about the bot: that is an error of the export, not a pass.
  const status: ReportStatus = failedTurns.length ? 'failed' : turns.length && unreadable.length === turns.length ? 'error' : 'passed';
  const first = turns[0];
  const last = turns.at(-1);
  const span = first && last ? `${iso(first.startedAt)} – ${iso(last.completedAt)} UTC` : '—';
  const omitted = Math.max(0, input.totalTurns - turns.length);
  const durationMs = first && last ? last.completedAt.getTime() - first.startedAt.getTime() : 0;
  const comparisons: ReportComparison[] = [
    ...failedTurns.map((t) => ({
      source: 'трейс', expected: 'хід відпрацьовує без помилки',
      actual: `крок ${t.ordinal}: ${t.payload?.error ?? 'помилка без опису'}`, met: false as const,
    })),
    ...unreadable.map((t) => ({
      source: 'трейс', expected: 'трейс ходу читається', actual: `крок ${t.ordinal}: не вдалося розшифрувати або розібрати`, met: 'info' as const,
    })),
  ];
  const test: SuiteReportTest = {
    id: 'TC-01',
    name: `Розмова ${input.conversationId}`,
    status,
    duration: `${Math.round(durationMs / 1000)} с`,
    descriptionSummary: 'production-трейс',
    description: [
      { key: 'кейс', value: 'TC-01' },
      { key: 'Jira', value: '—' },
      { key: 'сторі', value: '—' },
      { key: 'сюта', value: 'production-трейс розмови' },
      { key: 'теги', value: '—' },
      { key: 'тип', value: 'реальна розмова: бот відповідав у Slack, хід записано під час відповіді' },
      { key: 'мета', value: '—' },
      { key: 'сценарій', value: `тенант \`${input.tenantId}\` · розмова \`${input.conversationId}\`` },
      { key: 'моделі', value: '—' },
      { key: 'запуск', value: span },
    ],
    given: {
      summary: 'стан до першого кроку не записується',
      rows: [{
        key: 'стан',
        value: 'Трейс знімається на кожному ході окремо: пам\'ять, цілі й pulse-цикл, які бачив бот, показано в деталях кожного кроку.',
      }, {
        key: 'номери кроків',
        value: 'Порядок серед збережених трейсів розмови (30 днів, лише поки трейс увімкнено), а не номер репліки від початку розмови.',
      }],
      history: [],
    },
    stepsSummary: `${plural(turns.length, 'крок', 'кроки', 'кроків')}${failedTurns.length ? `, ${failedTurns.length} з помилкою` : ''}${omitted ? `, ще ${omitted} раніших не показано` : ''}`,
    steps: turns.flatMap(stepsFor),
    stepsEmpty: 'Трейсів цієї розмови немає.',
    actual: {
      summary: failedTurns.length ? `✗ ${plural(failedTurns.length, 'хід упав', 'ходи впали', 'ходів упали')}`
        : status === 'error' ? 'жоден трейс не прочитано' : '✓ усі ходи завершились',
      failure: null,
      comparisons,
      judge: { title: 'Суддя (LLM): не оцінював, це запис реальної розмови', reasoning: null },
    },
  };
  return {
    meta: {
      eyebrow: 'conversation-trace',
      title: `Трейс розмови ${input.conversationId.slice(0, 8)}`,
      details: [
        `Експорт ${iso(input.generatedAt)} UTC`,
        `тенант \`${input.tenantId}\``,
        omitted ? `показано останні ${turns.length} з ${input.totalTurns} ходів` : `${plural(turns.length, 'хід', 'ходи', 'ходів')}`,
      ],
    },
    suite: {
      counts: { total: 1, passed: status === 'passed' ? 1 : 0, failed: status === 'failed' ? 1 : 0, error: status === 'error' ? 1 : 0, skipped: 0 },
      tests: [test],
    },
  };
}
