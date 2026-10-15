import type {
  AdminTeamHierarchyRole, AdminV2PilotCohortState, AdminV2PilotCycle, AdminV2PilotPerson, AdminV2PilotPersonQuestion,
  AdminV2PilotQaTeamSignal, AdminV2PilotTeamSignal,
} from '@entalent/contracts';

/** Autonomy 3/3 contributors required before an interim manager report. */
export const REPORT_THRESHOLD = 5;

const WARSAW_PARTS = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

interface WarsawParts { day: string; month: string; year: string; time: string }

/** Explicit parts instead of ICU's assembled string, whose separators vary by runtime; null for a bad instant. */
function warsawParts(instant: string | null | undefined): WarsawParts | null {
  if (!instant) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    WARSAW_PARTS.formatToParts(date).find((item) => item.type === type)?.value ?? '';
  return { day: part('day'), month: part('month'), year: part('year'), time: `${part('hour')}:${part('minute')}` };
}

/** 'DD.MM, HH:MM' in Warsaw time, or '—'. */
function warsawDate(instant: string | null | undefined): string {
  const parts = warsawParts(instant);
  return parts ? `${parts.day}.${parts.month}, ${parts.time}` : '—';
}

// Same shape the API accepts for cohort ids; anything else would come back as a 400.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCohortId(value: string): boolean {
  return UUID.test(value);
}

/** 'DD.MM.YYYY, HH:MM' in Warsaw time, or '—'. */
export function warsawDateTime(instant: string | null | undefined): string {
  const parts = warsawParts(instant);
  return parts ? `${parts.day}.${parts.month}.${parts.year}, ${parts.time}` : '—';
}

/** 'HH:MM' in Warsaw time, or '—'. */
export function warsawTime(instant: string | null | undefined): string {
  return warsawParts(instant)?.time ?? '—';
}

export function lastMessageLabel(instant: string | null): string {
  const parts = warsawParts(instant);
  if (!parts) return 'в этом цикле сообщений нет';
  return `последнее сообщение в цикле: ${parts.day}.${parts.month} ${parts.time}`;
}

/** Check time of the page: the latest valid API read time among its fetches. */
export function freshnessLabel(checkedAts: (string | null | undefined)[]): string {
  const latest = checkedAts
    .map((value) => ({ value, time: value ? Date.parse(value) : Number.NaN }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time)[0];
  const parts = warsawParts(latest?.value);
  if (!parts) return 'Время проверки неизвестно';
  return `Проверено ${parts.day}.${parts.month} в ${parts.time} (Варшава)`;
}

/** Same path with every current search param kept, for a plain refresh link. */
export function refreshHref(path: string, params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function cycleStateLabel(state: AdminV2PilotCohortState): string {
  if (state === 'active') return 'Идёт';
  if (state === 'upcoming') return 'Не начался';
  return 'Завершён';
}

export function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function ruParticipants(count: number): string {
  return ruPlural(count, 'участник', 'участника', 'участников');
}

type ReportCycle = Pick<AdminV2PilotCycle, 'state' | 'periodEnd' | 'sentReports' | 'autonomyScoredParticipants'>;

// One branch decides both the text and its tone so they cannot drift apart.
function cycleReportView(cycle: ReportCycle, now: number): BadgeView {
  if (cycle.state === 'upcoming') return { tone: 'neutral', label: 'Цикл ещё не начался' };
  const cutoffPassed = now >= Date.parse(cycle.periodEnd);
  const scored = cycle.autonomyScoredParticipants;
  if (cycle.sentReports > 0) return { tone: 'success', label: 'Отчёт отправлен' };
  if (scored >= REPORT_THRESHOLD) {
    return cutoffPassed
      ? { tone: 'warning', label: 'Цикл закрыт; отправка отчёта не подтверждена' }
      : { tone: 'accent', label: 'Порог достигнут; проверка и отправка отчёта отдельно' };
  }
  if (cutoffPassed) return { tone: 'warning', label: 'Порог не достигнут до отсечки' };
  const missing = REPORT_THRESHOLD - scored;
  return { tone: 'neutral', label: `Нужно ещё ${missing} ${ruParticipants(missing)} с Автономией 3/3` };
}

export function cycleReportState(cycle: ReportCycle, now: number): string {
  return cycleReportView(cycle, now).label;
}

/** Only a cohort whose period is running is called the current cycle. */
export function cohortLabel(cohort: { state: AdminV2PilotCohortState; periodStart: string; periodEnd: string }): string {
  const period = `${warsawDate(cohort.periodStart)} → ${warsawDate(cohort.periodEnd)} (Варшава)`;
  if (cohort.state === 'active') return `Текущий цикл · ${period}`;
  if (cohort.state === 'upcoming') return `Цикл ещё не начался · ${period}`;
  return `Завершённый цикл · ${period} · активного цикла сейчас нет`;
}

interface PersonProgressView { stage: string; nextStep: string; tone: BadgeTone }

function personProgressView(person: AdminV2PilotPerson): PersonProgressView {
  const autonomy = person.questions.filter((question) => question.group === 'autonomy');
  const scored = autonomy.filter((question) => question.outcome === 'scored').length;
  const finalized = autonomy.filter((question) => question.outcome !== null).length;
  const ready = autonomy.filter((question) => question.ready).length;
  const working = autonomy.filter((question) => question.workingSummary).length;

  if (scored === 3) return { stage: 'Автономия 3/3', nextStep: 'Итог готов для проверки порога отчёта', tone: 'success' };
  if (finalized === 3) return {
    stage: `Автономия завершена · оценено ${scored}/3`, nextStep: 'Проверить темы без достаточных данных', tone: 'warning',
  };
  if (person.inbound === 0) return { stage: 'Беседа не начата', nextStep: 'Ждём первого диалога', tone: 'neutral' };
  if (ready === 3) return { stage: 'Три смысла готовы', nextStep: 'Проверить Bundle и ответ участника', tone: 'accent' };
  if (finalized > 0) return {
    stage: `Итоги Автономии ${finalized}/3`, nextStep: 'Проверить оставшиеся темы Автономии', tone: 'accent',
  };
  if (working > 0 || ready > 0) return {
    stage: `Автономия в работе · готово ${ready}/3`,
    nextStep: 'Продолжить диалог по недостающим темам',
    tone: 'accent',
  };
  if (person.questions.some((question) => question.workingSummary)) return {
    stage: 'Есть записи по другим группам',
    nextStep: 'Проверить охват Автономии',
    tone: 'accent',
  };
  return { stage: 'Диалог есть, записей пока нет', nextStep: 'Проверить обработку и продолжить диалог', tone: 'accent' };
}

export function personProgress(person: AdminV2PilotPerson): { stage: string; nextStep: string } {
  const { stage, nextStep } = personProgressView(person);
  return { stage, nextStep };
}

export function signalDirectionLabel(direction: string): string {
  const labels: Record<string, string> = { adverse: 'Негативный', mixed: 'Смешанный', favorable: 'Позитивный' };
  return labels[direction] ?? direction;
}

export function signalSeverityLabel(severity: string): string {
  const labels: Record<string, string> = { low: 'Низкая', moderate: 'Средняя', high: 'Высокая' };
  return labels[severity] ?? severity;
}

export function signalOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = { scored: 'Оценено', insufficient_evidence: 'Недостаточно данных' };
  return labels[outcome] ?? outcome;
}

export function rootCauseLabel(category: string): string {
  const labels: Record<string, string> = {
    workload: 'Нагрузка', clarity: 'Ясность', autonomy: 'Автономия', growth: 'Развитие', purpose: 'Смысл',
    belonging: 'Принадлежность', support: 'Поддержка', recognition: 'Признание', other: 'Другое',
  };
  return labels[category] ?? category;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
export interface BadgeView { tone: BadgeTone; label: string }

/** 'Анна Смирнова' → 'Анна С.'; single words and 'Участник 3' stay as they are. */
export function shortName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return 'Без имени';
  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1] ?? '';
  if (parts.length < 2 || !/^\p{L}/u.test(last)) return trimmed;
  return `${parts[0]} ${Array.from(last)[0]!.toUpperCase()}.`;
}

/** First letters (by code point) of the first two words that start with a letter. */
export function initials(displayName: string): string {
  const letters = displayName.trim().split(/\s+/)
    .map((part) => Array.from(part)[0] ?? '')
    .filter((first) => /\p{L}/u.test(first));
  return letters.slice(0, 2).map((first) => first.toUpperCase()).join('') || '?';
}

export function cycleStateBadge(state: AdminV2PilotCohortState): BadgeView {
  return { tone: state === 'active' ? 'accent' : 'neutral', label: cycleStateLabel(state) };
}

export function cycleReportBadge(cycle: ReportCycle, now: number): BadgeView {
  return cycleReportView(cycle, now);
}

export function draftStatusBadge(status: string): BadgeView {
  const badges: Record<string, BadgeView> = {
    collecting: { tone: 'neutral', label: 'Черновик' },
    pending_confirmation: { tone: 'accent', label: 'Ждёт подтверждения' },
    pending_clarification: { tone: 'warning', label: 'Нужно уточнение' },
    confirmed: { tone: 'accent', label: 'Подтверждено' },
    declined: { tone: 'danger', label: 'Отклонено' },
    no_data: { tone: 'neutral', label: 'Нет данных' },
    reset: { tone: 'neutral', label: 'Сбор заново' },
    scored: { tone: 'success', label: 'Итог оценён' },
    insufficient_evidence: { tone: 'neutral', label: 'Недостаточно данных' },
  };
  return badges[status] ?? { tone: 'neutral', label: status };
}

export function personStageBadge(person: AdminV2PilotPerson): BadgeView {
  const { stage, tone } = personProgressView(person);
  return { tone, label: stage };
}

/** An insufficient-evidence outcome carries no meaningful direction or severity. */
export function signalBadge(signal: AdminV2PilotTeamSignal): BadgeView {
  if (signal.outcome !== 'scored' || signal.score === null) {
    return { tone: 'neutral', label: signalOutcomeLabel(signal.outcome) };
  }
  const tones: Record<string, BadgeTone> = { adverse: 'danger', mixed: 'warning', favorable: 'success' };
  return {
    tone: tones[signal.direction] ?? 'neutral',
    label: `${signalDirectionLabel(signal.direction)} · ${signal.score}/100 · ${signalSeverityLabel(signal.severity)} важность`,
  };
}

export function roleLabel(role: AdminTeamHierarchyRole): string {
  const labels: Record<AdminTeamHierarchyRole, string> = {
    employee: 'Сотрудник', team_lead: 'Тимлид', manager: 'Руководитель', hr: 'HR', hrbp: 'HRBP', leadership: 'Руководство',
  };
  return labels[role] ?? role;
}

export const TOPIC_GROUPS = [
  ['autonomy', 'Автономия'], ['growth', 'Развитие'], ['purpose', 'Смысл'], ['belonging', 'Принадлежность'],
] as const;

export function topicGroupLabel(group: string): string {
  return TOPIC_GROUPS.find(([key]) => key === group)?.[1] ?? group;
}

const WORKING_STATUSES = ['collecting', 'pending_confirmation', 'pending_clarification'];

/** A draft is shown only while it is a working summary awaiting the participant. */
export function isShownWorking(question: AdminV2PilotPersonQuestion): boolean {
  return Boolean(question.workingSummary) && WORKING_STATUSES.includes(question.status);
}

export interface TopicDraft {
  userId: string;
  name: string;
  summary: string;
  ready: boolean;
  badge: BadgeView;
}

/** A QA Team Signal with its author's short name, taken from the QA row itself. */
export interface TopicSignal extends AdminV2PilotTeamSignal {
  author: { userId: string; name: string };
}

export interface TopicRow {
  stableKey: string;
  title: string;
  group: string;
  drafts: TopicDraft[];
  signals: TopicSignal[];
}

export interface TopicRows {
  /** Groups present in the data, known groups first. */
  groups: string[];
  /** The applied filter; null unless the group has at least one topic in the data (then all groups are shown). */
  group: string | null;
  rows: TopicRow[];
  /** Topics with neither drafts nor signals, collapsed by the page. */
  empty: TopicRow[];
}

/**
 * Aligns drafts and Team Signals by topic only. Topic order follows the
 * questions in the people response, then any topic only signals mention.
 * A signal's author comes from its own QA row, never from text or topic.
 */
export function buildTopicRows(
  people: AdminV2PilotPerson[] | null,
  signals: AdminV2PilotQaTeamSignal[] | null,
  group?: string,
): TopicRows {
  // Keyed by group too: a signal filed under another group than the question gets its own row there.
  const topics = new Map<string, TopicRow>();
  const topic = (stableKey: string, title: string, topicGroup: string) => {
    const key = `${topicGroup}|${stableKey}`;
    let row = topics.get(key);
    if (!row) {
      row = { stableKey, title, group: topicGroup, drafts: [], signals: [] };
      topics.set(key, row);
    }
    return row;
  };
  for (const person of people ?? []) {
    for (const question of person.questions) {
      const row = topic(question.stableKey, question.title, question.group);
      if (!isShownWorking(question)) continue;
      row.drafts.push({
        userId: person.userId,
        name: shortName(person.displayName),
        summary: question.workingSummary!,
        ready: question.ready,
        badge: draftStatusBadge(question.status),
      });
    }
  }
  for (const { author, ...signal } of signals ?? []) {
    topic(signal.stableKey, signal.title, signal.group).signals.push({
      ...signal, author: { userId: author.userId, name: shortName(author.displayName) },
    });
  }

  const known: string[] = TOPIC_GROUPS.map(([key]) => key);
  const rank = (value: string) => (known.includes(value) ? known.indexOf(value) : known.length);
  const ordered = [...topics.values()]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row.group) - rank(b.row.group) || a.index - b.index)
    .map(({ row }) => row);
  const groups = [...new Set(ordered.map((row) => row.group))];
  const applied = group && groups.includes(group) ? group : null;
  const visible = applied ? ordered.filter((row) => row.group === applied) : ordered;
  const hasData = (row: TopicRow) => row.drafts.length > 0 || row.signals.length > 0;
  return { groups, group: applied, rows: visible.filter(hasData), empty: visible.filter((row) => !hasData(row)) };
}
