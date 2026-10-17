import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdminV2PilotPerson, AdminV2PilotQaTeamSignal } from '@entalent/contracts';
import {
  buildTopicRows, cohortLabel, cycleReportBadge, cycleReportState, cycleStateLabel, draftStatusBadge, freshnessLabel,
  initials, isCohortId, lastMessageLabel, refreshHref, personProgress, personStageBadge, rootCauseLabel, shortName, signalBadge,
  signalDirectionLabel, signalOutcomeLabel, signalSeverityLabel, warsawDateTime, warsawTime,
} from './v2-pilot-progress';

const question = (group: string, ready = false, outcome: string | null = null) => ({
  stableKey: group, title: group, group, status: 'collecting', ready,
  workingSummary: outcome ? null : 'working', finalSummary: null, outcome, score: null,
});

test('next step follows the available Autonomy evidence without claiming delivery', () => {
  const person: AdminV2PilotPerson = {
    userId: 'qa', displayName: 'QA', inbound: 2, lastInboundAt: null,
    questions: [question('autonomy', true), question('autonomy'), question('autonomy')],
  };
  assert.match(personProgress(person).nextStep, /недостающим темам/);
  person.questions = person.questions.map((item) => ({ ...item, ready: true }));
  assert.match(personProgress(person).nextStep, /Проверить Bundle/);
  person.questions = person.questions.map((item) => ({ ...item, outcome: 'scored', ready: false }));
  assert.equal(personProgress(person).stage, 'Автономия 3/3');
  person.questions[2] = { ...person.questions[2]!, outcome: 'insufficient_evidence' };
  assert.match(personProgress(person).stage, /оценено 2\/3/);
});

test('only a running cohort is labelled as the current cycle', () => {
  const active = { state: 'active' as const, periodStart: '2026-10-09T10:00:00Z', periodEnd: '2026-10-14T17:00:00Z' };
  assert.match(cohortLabel(active), /^Текущий цикл · 09\.10, 12:00 → 14\.10, 19:00/);
  const closed = { state: 'closed' as const, periodStart: '2026-10-06T17:00:00Z', periodEnd: '2026-10-08T17:00:00Z' };
  assert.match(cohortLabel(closed), /^Завершённый цикл · 06\.10, 19:00 → 08\.10, 19:00/);
  assert.doesNotMatch(cohortLabel(closed), /Текущий/);
});

test('cycle report state follows sent reports, the Autonomy threshold and the cutoff', () => {
  const periodEnd = '2026-10-14T17:00:00Z';
  const before = Date.parse('2026-10-14T10:00:00Z');
  const after = Date.parse('2026-10-15T10:00:00Z');
  const cycle = (autonomyScoredParticipants: number, sentReports = 0) => ({ state: 'active' as const, periodEnd, sentReports, autonomyScoredParticipants });
  assert.equal(cycleReportState(cycle(0, 1), before), 'Отчёт отправлен');
  assert.equal(cycleReportState(cycle(5), after), 'Цикл закрыт; отправка отчёта не подтверждена');
  assert.equal(cycleReportState(cycle(6), before), 'Порог достигнут; проверка и отправка отчёта отдельно');
  assert.equal(cycleReportState(cycle(4), after), 'Порог не достигнут до отсечки');
  assert.equal(cycleReportState(cycle(4), before), 'Нужно ещё 1 участник с Автономией 3/3');
  assert.equal(cycleReportState(cycle(2), before), 'Нужно ещё 3 участника с Автономией 3/3');
  assert.equal(cycleReportState(cycle(0), before), 'Нужно ещё 5 участников с Автономией 3/3');
  assert.equal(cycleReportState(cycle(0), Date.parse(periodEnd)), 'Порог не достигнут до отсечки');
  assert.equal(cycleReportState({ ...cycle(0), state: 'upcoming' }, before), 'Цикл ещё не начался');
});

test('cycle state labels and Warsaw date-time formatting', () => {
  assert.equal(cycleStateLabel('active'), 'Идёт');
  assert.equal(cycleStateLabel('closed'), 'Завершён');
  assert.equal(cycleStateLabel('upcoming'), 'Не начался');
  assert.equal(warsawDateTime('2026-10-14T17:00:00Z'), '14.10.2026, 19:00');
  assert.equal(warsawDateTime('2026-01-14T17:00:00Z'), '14.01.2026, 18:00');
  assert.equal(warsawDateTime(null), '—');
});

test('cohort ids are validated before the API is called', () => {
  assert.equal(isCohortId('9b5d3697-229c-4243-9481-bd6f1456faec'), true);
  assert.equal(isCohortId('not-a-uuid'), false);
  assert.equal(isCohortId('9b5d3697-229c-4243-9481-bd6f1456faec,aa069583-240e-4ef1-bd5a-d45fabdde17a'), false);
});

test('Team Signal labels are Russian and fall back to the raw value', () => {
  assert.equal(signalDirectionLabel('adverse'), 'Негативный');
  assert.equal(signalDirectionLabel('mixed'), 'Смешанный');
  assert.equal(signalDirectionLabel('favorable'), 'Позитивный');
  assert.equal(signalSeverityLabel('low'), 'Низкая');
  assert.equal(signalSeverityLabel('moderate'), 'Средняя');
  assert.equal(signalSeverityLabel('high'), 'Высокая');
  assert.equal(signalOutcomeLabel('scored'), 'Оценено');
  assert.equal(signalOutcomeLabel('insufficient_evidence'), 'Недостаточно данных');
  assert.equal(rootCauseLabel('workload'), 'Нагрузка');
  assert.equal(signalDirectionLabel('unknown'), 'unknown');
});

test('short names keep the first name and the last initial only', () => {
  assert.equal(shortName('Анна Смирнова'), 'Анна С.');
  assert.equal(shortName('Анна'), 'Анна');
  assert.equal(shortName('Участник 3'), 'Участник 3');
  assert.equal(initials('Анна Смирнова'), 'АС');
  assert.equal(initials(''), '?');
  assert.equal(shortName('  '), 'Без имени');
  assert.equal(shortName(''), 'Без имени');
  assert.equal(initials('\u{1F600} Анна Смирнова'), 'АС');
  assert.equal(initials('\u{1F600}'), '?');
});

const topicQuestion = (
  stableKey: string, group: string, status: string, workingSummary: string | null,
) => ({
  stableKey, title: `T ${stableKey}`, group, status, ready: false, workingSummary, finalSummary: null, outcome: null, score: null,
});

const signal = (stableKey: string, group: string, extra: Partial<AdminV2PilotQaTeamSignal> = {}): AdminV2PilotQaTeamSignal => ({
  author: { userId: 'u9', displayName: 'Вера Петрова' }, stableKey, title: `T ${stableKey}`, group, summary: `S ${stableKey}`, outcome: 'scored', score: 40,
  direction: 'adverse', severity: 'high', rootCause: 'workload', ...extra,
});

const topicPeople: AdminV2PilotPerson[] = [{
  userId: 'u1', displayName: 'Анна Смирнова', inbound: 3, lastInboundAt: '2026-10-11T08:30:00Z',
  questions: [
    topicQuestion('a1', 'autonomy', 'collecting', 'draft a1'),
    topicQuestion('a2', 'autonomy', 'pending_confirmation', 'draft a2'),
    topicQuestion('a3', 'autonomy', 'no_data', null),
    topicQuestion('g1', 'growth', 'confirmed', 'final-ish text'),
    topicQuestion('p1', 'purpose', 'collecting', null),
  ],
}];

test('topic rows align drafts and signals by topic in display order', () => {
  const result = buildTopicRows(topicPeople, [signal('g1', 'growth'), signal('a1', 'autonomy')]);
  assert.deepEqual(result.rows.map((row) => row.stableKey), ['a1', 'a2', 'g1']);
  const [both, draftsOnly, signalsOnly] = result.rows;
  assert.equal(both!.drafts[0]!.name, 'Анна С.');
  assert.equal(both!.drafts[0]!.badge.label, 'Черновик');
  assert.equal(both!.signals.length, 1);
  assert.equal(draftsOnly!.signals.length, 0);
  // A confirmed question is not a shown draft.
  assert.equal(signalsOnly!.drafts.length, 0);
  assert.deepEqual(result.empty.map((row) => row.stableKey), ['a3', 'p1']);
  assert.deepEqual(result.groups, ['autonomy', 'growth', 'purpose']);
  assert.equal(result.group, null);
});

test('topic group filter applies valid groups and ignores unknown values', () => {
  const filtered = buildTopicRows(topicPeople, [signal('g1', 'growth')], 'autonomy');
  assert.equal(filtered.group, 'autonomy');
  assert.deepEqual(filtered.rows.map((row) => row.stableKey), ['a1', 'a2']);
  assert.deepEqual(filtered.empty.map((row) => row.stableKey), ['a3']);
  const invalid = buildTopicRows(topicPeople, [], 'nonsense');
  assert.equal(invalid.group, null);
  assert.deepEqual(invalid.rows.map((row) => row.stableKey), ['a1', 'a2']);
});

test('a known group with no topics falls back to all groups', () => {
  const result = buildTopicRows(topicPeople, [], 'belonging');
  assert.equal(result.group, null);
  assert.deepEqual(result.rows.map((row) => row.stableKey), ['a1', 'a2']);
  assert.deepEqual(result.empty.map((row) => row.stableKey), ['a3', 'g1', 'p1']);
});

test('a signal filed under another group gets its own row in that group', () => {
  const result = buildTopicRows(topicPeople, [signal('a1', 'growth')]);
  const a1Rows = result.rows.filter((row) => row.stableKey === 'a1');
  assert.deepEqual(a1Rows.map((row) => row.group), ['autonomy', 'growth']);
  assert.equal(a1Rows[0]!.drafts.length, 1);
  assert.equal(a1Rows[0]!.signals.length, 0);
  assert.equal(a1Rows[1]!.drafts.length, 0);
  assert.equal(a1Rows[1]!.signals.length, 1);
  const growth = buildTopicRows(topicPeople, [signal('a1', 'growth')], 'growth');
  assert.deepEqual(growth.rows.map((row) => `${row.group}|${row.stableKey}`), ['growth|a1']);
});

test('topic rows work with signals only or people only', () => {
  const signalsOnly = buildTopicRows(null, [signal('a1', 'autonomy')]);
  assert.deepEqual(signalsOnly.rows.map((row) => row.stableKey), ['a1']);
  assert.equal(signalsOnly.rows[0]!.drafts.length, 0);
  assert.equal(signalsOnly.rows[0]!.signals.length, 1);
  assert.deepEqual(signalsOnly.empty, []);
  const peopleOnly = buildTopicRows(topicPeople, null);
  assert.deepEqual(peopleOnly.rows.map((row) => row.stableKey), ['a1', 'a2']);
  assert.ok(peopleOnly.rows.every((row) => row.signals.length === 0));
  assert.deepEqual(peopleOnly.empty.map((row) => row.stableKey), ['a3', 'g1', 'p1']);
});

test('topic rows are null-safe and fall back to signal order without people', () => {
  assert.deepEqual(buildTopicRows(null, null), { groups: [], group: null, rows: [], empty: [] });
  const result = buildTopicRows(null, [signal('x', 'custom'), signal('g2', 'growth'), signal('a9', 'autonomy')]);
  assert.deepEqual(result.rows.map((row) => row.stableKey), ['a9', 'g2', 'x']);
});

test('badges always carry text and never colour insufficient evidence', () => {
  const insufficient = signalBadge(signal('a1', 'autonomy', { outcome: 'insufficient_evidence', score: null }));
  assert.deepEqual(insufficient, { tone: 'neutral', label: 'Недостаточно данных' });
  assert.deepEqual(signalBadge(signal('a1', 'autonomy')), { tone: 'danger', label: 'Негативный · 40/100 · Высокая важность' });
  assert.equal(signalBadge(signal('a1', 'autonomy', { direction: 'favorable' })).tone, 'success');
  assert.equal(draftStatusBadge('pending_clarification').label, 'Нужно уточнение');
  assert.deepEqual(draftStatusBadge('weird'), { tone: 'neutral', label: 'weird' });
  assert.deepEqual(personStageBadge({ userId: 'q', displayName: 'Q', inbound: 0, lastInboundAt: null, questions: [] }), {
    tone: 'neutral', label: 'Беседа не начата',
  });
  const periodEnd = '2026-10-14T17:00:00Z';
  const cycle = { state: 'active' as const, periodEnd, sentReports: 1, autonomyScoredParticipants: 0 };
  assert.deepEqual(cycleReportBadge(cycle, Date.parse('2026-10-14T10:00:00Z')), { tone: 'success', label: 'Отчёт отправлен' });
  assert.equal(cycleReportBadge({ ...cycle, sentReports: 0 }, Date.parse('2026-10-15T10:00:00Z')).tone, 'warning');
  assert.deepEqual(cycleReportBadge({ ...cycle, sentReports: 0, autonomyScoredParticipants: 5 }, Date.parse('2026-10-14T10:00:00Z')), {
    tone: 'accent', label: 'Порог достигнут; проверка и отправка отчёта отдельно',
  });
  assert.deepEqual(cycleReportBadge({ ...cycle, state: 'upcoming' }, Date.parse('2026-10-14T10:00:00Z')), {
    tone: 'neutral', label: 'Цикл ещё не начался',
  });
});

test('a Team Signal takes its author from its own QA row, not from people', () => {
  const result = buildTopicRows(topicPeople, [
    signal('g1', 'growth'), signal('a1', 'autonomy', { author: { userId: 'u1', displayName: 'Анна Смирнова' } }),
  ]);
  // g1 matches Анна's confirmed topic, but the row says Вера wrote it.
  assert.deepEqual(result.rows.find((row) => row.stableKey === 'g1')!.signals[0]!.author, { userId: 'u9', name: 'Вера П.' });
  assert.deepEqual(result.rows.find((row) => row.stableKey === 'a1')!.signals[0]!.author, { userId: 'u1', name: 'Анна С.' });
  const signalOnly = buildTopicRows(null, [signal('g1', 'growth')]).rows[0]!.signals[0]!;
  assert.deepEqual(signalOnly.author, { userId: 'u9', name: 'Вера П.' });
  assert.equal('displayName' in signalOnly.author, false);
});

test('unavailable QA signals give rows without signals or authors', () => {
  const result = buildTopicRows(topicPeople, null);
  assert.ok([...result.rows, ...result.empty].every((row) => row.signals.length === 0));
});

test('freshness labels use Warsaw time and are null-safe', () => {
  assert.equal(warsawTime('2026-10-11T08:30:00Z'), '10:30');
  assert.equal(warsawTime('2026-01-11T08:30:00Z'), '09:30');
  assert.equal(warsawTime('2026-10-10T22:05:00Z'), '00:05');
  assert.equal(lastMessageLabel('2026-10-11T08:30:00Z'), 'последнее сообщение в цикле: 11.10 10:30');
  assert.equal(lastMessageLabel(null), 'в этом цикле сообщений нет');
  assert.equal(freshnessLabel(['2026-10-15T08:12:00Z']), 'Проверено 15.10 в 10:12 (Варшава)');
  // The later of the two reads wins, whatever the order.
  assert.equal(freshnessLabel(['2026-10-15T08:14:00Z', '2026-10-15T08:12:00Z']), 'Проверено 15.10 в 10:14 (Варшава)');
  assert.equal(freshnessLabel(['2026-10-15T08:12:00Z', '2026-10-15T08:14:00Z']), 'Проверено 15.10 в 10:14 (Варшава)');
  assert.equal(freshnessLabel([null, '2026-10-15T08:12:00Z', 'garbage']), 'Проверено 15.10 в 10:12 (Варшава)');
  assert.equal(freshnessLabel([undefined, null]), 'Время проверки неизвестно');
});

test('invalid instants render as a dash instead of throwing', () => {
  assert.equal(warsawDateTime('not a date'), '—');
  assert.equal(warsawTime('not a date'), '—');
  assert.equal(lastMessageLabel('not a date'), 'в этом цикле сообщений нет');
  assert.equal(cohortLabel({ state: 'active', periodStart: 'bad', periodEnd: '2026-10-14T17:00:00Z' }),
    'Текущий цикл · — → 14.10, 19:00 (Варшава)');
});

test('Warsaw formatting is assembled from explicit parts', () => {
  assert.equal(warsawDateTime('2026-12-31T23:59:00Z'), '01.01.2027, 00:59');
  assert.equal(warsawDateTime('2026-03-05T07:04:00Z'), '05.03.2026, 08:04');
});

test('refresh link keeps every current search param', () => {
  assert.equal(refreshHref('/pulse', {}), '/pulse');
  assert.equal(refreshHref('/pulse', { group: 'growth', tag: ['a', 'b c'], empty: undefined }), '/pulse?group=growth&tag=a&tag=b+c');
});

test('confirmed and scored statuses look different', () => {
  assert.notEqual(draftStatusBadge('confirmed').tone, draftStatusBadge('scored').tone);
  assert.equal(draftStatusBadge('scored').tone, 'success');
});
