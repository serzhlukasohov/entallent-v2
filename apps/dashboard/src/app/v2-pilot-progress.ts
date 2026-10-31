import { companyLabelKey } from './company-label';
import type {
  AdminTeamHierarchyRole, AdminV2PilotCohortState, AdminV2PilotCycle, AdminV2PilotPerson, AdminV2PilotPersonQuestion,
  AdminV2PilotQaTeamSignal, AdminV2PilotTeamSignal,
} from '@entalent/contracts';

/** Autonomy 3/3 contributors required before an interim manager report. */
export const REPORT_THRESHOLD = 5;

const WARSAW_PARTS = new Intl.DateTimeFormat('en', {
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
  if (!parts) return "ui.103";
  return companyLabelKey('ui.last_message', { date: instant! }, [], ['date']);
}

/** Check time of the page: the latest valid API read time among its fetches. */
export function freshnessLabel(checkedAts: (string | null | undefined)[]): string {
  const latest = checkedAts
    .map((value) => ({ value, time: value ? Date.parse(value) : Number.NaN }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((a, b) => b.time - a.time)[0];
  const parts = warsawParts(latest?.value);
  if (!parts) return "ui.104";
  return companyLabelKey('ui.checked', { date: latest!.value! }, [], ['date']);
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
  if (state === 'active') return "ui.105";
  if (state === 'upcoming') return "ui.106";
  return "ui.107";
}

export function ruPlural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

type ReportCycle = Pick<AdminV2PilotCycle, 'state' | 'periodEnd' | 'sentReports' | 'autonomyScoredParticipants'>;

// One branch decides both the text and its tone so they cannot drift apart.
function cycleReportView(cycle: ReportCycle, now: number): BadgeView {
  if (cycle.state === 'upcoming') return { tone: 'neutral', label: "ui.111" };
  const cutoffPassed = now >= Date.parse(cycle.periodEnd);
  const scored = cycle.autonomyScoredParticipants;
  if (cycle.sentReports > 0) return { tone: 'success', label: "ui.112" };
  if (scored >= REPORT_THRESHOLD) {
    return cutoffPassed
      ? { tone: 'warning', label: "ui.113" }
      : { tone: 'accent', label: "ui.114" };
  }
  if (cutoffPassed) return { tone: 'warning', label: "ui.115" };
  const missing = REPORT_THRESHOLD - scored;
  return { tone:'neutral',label:companyLabelKey('ui.need',{count:missing}) };
}

export function cycleReportState(cycle: ReportCycle, now: number): string {
  return cycleReportView(cycle, now).label;
}

/** Only a cohort whose period is running is called the current cycle. */
export function cohortLabel(cohort: { state: AdminV2PilotCohortState; periodStart: string; periodEnd: string }): string {
  return companyLabelKey(cohort.state === 'active' ? 'ui.cohort_active' : cohort.state === 'upcoming' ? 'ui.cohort_upcoming' : 'ui.cohort_closed', { start:cohort.periodStart,end:cohort.periodEnd }, [], ['start','end']);
}

interface PersonProgressView { stage: string; nextStep: string; tone: BadgeTone }

function personProgressView(person: AdminV2PilotPerson): PersonProgressView {
  const autonomy = person.questions.filter((question) => question.group === 'autonomy');
  const scored = autonomy.filter((question) => question.outcome === 'scored').length;
  const finalized = autonomy.filter((question) => question.outcome !== null).length;
  const ready = autonomy.filter((question) => question.ready).length;
  const working = autonomy.filter((question) => question.workingSummary).length;

  if (scored === 3) return { stage: "ui.064", nextStep: "ui.116", tone: 'success' };
  if (finalized === 3) return {
    stage: companyLabelKey('ui.autonomy_done',{count:scored}), nextStep: "ui.117", tone: 'warning',
  };
  if (person.inbound === 0) return { stage: "ui.118", nextStep: "ui.119", tone: 'neutral' };
  if (ready === 3) return { stage: "ui.120", nextStep: "ui.121", tone: 'accent' };
  if (finalized > 0) return {
    stage: companyLabelKey('ui.autonomy_result',{count:finalized}), nextStep: "ui.122", tone: 'accent',
  };
  if (working > 0 || ready > 0) return {
    stage: companyLabelKey('ui.autonomy_work',{count:ready}),
    nextStep: "ui.123",
    tone: 'accent',
  };
  if (person.questions.some((question) => question.workingSummary)) return {
    stage: "ui.124",
    nextStep: "ui.125",
    tone: 'accent',
  };
  return { stage: "ui.126", nextStep: "ui.127", tone: 'accent' };
}

export function personProgress(person: AdminV2PilotPerson): { stage: string; nextStep: string } {
  const { stage, nextStep } = personProgressView(person);
  return { stage, nextStep };
}

export function signalDirectionLabel(direction: string): string {
  const labels: Record<string, string> = { adverse: "ui.128", mixed: "ui.129", favorable: "ui.130" };
  return labels[direction] ?? direction;
}

export function signalSeverityLabel(severity: string): string {
  const labels: Record<string, string> = { low: "ui.131", moderate: "ui.132", high: "ui.133" };
  return labels[severity] ?? severity;
}

export function signalOutcomeLabel(outcome: string): string {
  const labels: Record<string, string> = { scored: "ui.134", insufficient_evidence: "ui.135" };
  return labels[outcome] ?? outcome;
}

export function rootCauseLabel(category: string): string {
  const labels: Record<string, string> = {
    workload: "ui.136", clarity: "ui.137", autonomy: "ui.081", growth: "ui.138", purpose: "ui.139",
    belonging: "ui.140", support: "ui.141", recognition: "ui.142", other: "ui.143",
  };
  return labels[category] ?? category;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
export interface BadgeView { tone: BadgeTone; label: string }

/** 'Анна Смирнова' → 'Анна С.'; single words and 'Участник 3' stay as they are. */
export function shortName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return "ui.144";
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
    collecting: { tone: 'neutral', label: "ui.145" },
    pending_confirmation: { tone: 'accent', label: "ui.146" },
    pending_clarification: { tone: 'warning', label: "ui.147" },
    confirmed: { tone: 'accent', label: "ui.148" },
    declined: { tone: 'danger', label: "ui.149" },
    no_data: { tone: 'neutral', label: "ui.150" },
    reset: { tone: 'neutral', label: "ui.151" },
    scored: { tone: 'success', label: "ui.152" },
    insufficient_evidence: { tone: 'neutral', label: "ui.135" },
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
    label: companyLabelKey('ui.signal_score',{direction:signalDirectionLabel(signal.direction),score:signal.score!,severity:signalSeverityLabel(signal.severity)},['direction','severity']),
  };
}

export function roleLabel(role: AdminTeamHierarchyRole): string {
  const labels: Record<AdminTeamHierarchyRole, string> = {
    employee: "ui.153", team_lead: "ui.008", manager: "ui.007", hr: 'HR', hrbp: 'HRBP', leadership: "ui.154",
  };
  return labels[role] ?? role;
}

export const TOPIC_GROUPS = [
  ['autonomy', "ui.081"], ['growth', "ui.138"], ['purpose', "ui.139"], ['belonging', "ui.140"],
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
  titleDisplay?: import('@entalent/contracts').DefinitionDisplay;
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
  const topic = (stableKey: string, title: string, topicGroup: string, titleDisplay?: import('@entalent/contracts').DefinitionDisplay) => {
    const key = `${topicGroup}|${stableKey}`;
    let row = topics.get(key);
    if (!row) {
      row = { stableKey, title, titleDisplay, group: topicGroup, drafts: [], signals: [] };
      topics.set(key, row);
    }
    return row;
  };
  for (const person of people ?? []) {
    for (const question of person.questions) {
      const row = topic(question.stableKey, question.title, question.group, question.titleDisplay);
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
    topic(signal.stableKey, signal.title, signal.group, signal.titleDisplay).signals.push({
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
