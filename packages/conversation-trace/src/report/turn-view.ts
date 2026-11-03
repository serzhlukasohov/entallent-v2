import type { TraceEvent } from '../events';

/**
 * How one turn reads in the suite report: the «деталі» sections under a bot reply and the side-effect
 * icons. Sim run reports (`from-sim-run.mjs`) and production trace exports share it, so a production
 * turn renders exactly like a sim turn. Inputs are report JSON of several harness versions, so every
 * field is optional and old reports degrade to fewer rows instead of failing.
 */

export type RowTone = 'ok' | 'bad' | 'warn';

export interface ReportRow {
  key: string;
  value: unknown;
  tone?: RowTone;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
  empty?: string;
  summary?: string;
}

export interface ReportBadge {
  icon: string;
  label: string;
  tone: 'bad' | 'warn' | null;
  details: string[];
}

interface ClassificationView {
  primaryIntent?: string;
  secondaryIntents?: string[];
  dialogueAct?: string;
  latestUserSubstance?: string;
  emotionalState?: string[];
  urgency?: string;
  confidence?: number;
  reasoningSummary?: string;
  reminderRequest?: { intent: string; dueAt: string } | null;
  dataUseAlongsideDisclosure?: boolean;
  cycleStatusQuestion?: boolean;
  priorAssistantOffer?: unknown;
  acceptsPriorOffer?: boolean;
  formatRequest?: string | null;
  pulseCaptureScope?: unknown;
  onboardingSignal?: { intent: string; substantive?: boolean } | null;
  requiresSafetyCheck?: boolean;
  surveyAllowed?: boolean;
}

interface ReplyPlanView {
  topicAnchor?: unknown;
  resolvedDetails?: unknown[];
  memoryAnchors?: unknown;
  correctionCarryover?: unknown;
  questionPolicy?: { maxQuestions: number; reason: string } | null;
  responseMove?: string;
  forbiddenMoves?: string[];
  requiredGrounding?: unknown;
  formatRequest?: unknown;
  mayInferFromBrevity?: boolean;
}

interface QuestionGroupRef { questionGroup: string }

interface ResponseInputsView {
  memoryContext?: { items?: string[]; goals?: string[] };
  localTime?: unknown;
  isSessionStart?: boolean;
  cycleProgress?: {
    inCycle: boolean;
    topicsClosed: number;
    topicsTotal: number;
    awaitingReply?: boolean;
    openTopics?: unknown;
  } | null;
  confirmationRequest?: (QuestionGroupRef & { evidence: Array<{ polarity: string; evidenceSummary: string }> }) | null;
  topicQuestion?: (QuestionGroupRef & { focus: string; questionId: string }) | null;
  surveyProbeQuestion?: { id: string; responseType?: string } | null;
  topicConfirmed?: (QuestionGroupRef & { topicsTotal?: number; topicsClosed?: number }) | null;
  questionNotCollected?: QuestionGroupRef | null;
  captureFacts?: unknown;
  reportingDisclosure?: unknown;
  trailingBundle?: { kind: string; text: string } | null;
  styleAdaptationWeight?: unknown;
  reminderConfirmation?: { intent: string; dueAt: string } | null;
  reminderIntent?: unknown;
  followUpIntent?: unknown;
}

interface EffectsView {
  outboundMetadata?: Record<string, unknown> | null;
  memoryAdded: Array<{ category: string; content: string }>;
  escalations: Array<{ type: string; severity: string; riskType?: string | null }>;
  generationAttempts: number;
}

/** A turn as report JSON holds it (`ReportTurn` of current runs, fewer fields in old ones). */
export interface ReportTurnView {
  index: number;
  classification?: ClassificationView;
  responseInputs?: ResponseInputsView | null;
  effects?: EffectsView | null;
  mode?: string;
  risk?: { severity: string; type: string | null };
  replyPlan?: ReplyPlanView | null;
}

type TraceList = readonly TraceEvent[] | null | undefined;

// Outbound metadata the orchestrator writes; fields read by name are listed here, the rest stay generic.
interface OutboundMetaView {
  topicQuestionDecision?: unknown;
  topicQuestionFallbackReason?: unknown;
  topicQuestion?: unknown;
  containsSurveyProbe?: unknown;
  surveyProbeQuestionId?: unknown;
  reportingDisclosureVersion?: unknown;
  confirmationSummary?: unknown;
  dataUseReply?: unknown;
  v2BundleReply?: unknown;
  dataUseReplyFallbackReason?: unknown;
  v2BundleReplyFallbackReason?: unknown;
  [key: string]: unknown;
}

const text = (value: unknown): string => String(value);
const code = (value: unknown): string => `\`${text(value)}\``;
const short = (value: unknown, max = 400): string => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
};
const row = (key: string, value: unknown, tone?: RowTone): ReportRow | null => (
  value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)
    ? null : { key, value, tone });
const rows = (items: Array<ReportRow | null>): ReportRow[] => items.filter((item): item is ReportRow => Boolean(item));
const yesNo = (value: unknown): string => (value ? 'так' : 'ні');

// Outbound metadata keys already shown in a named section; the rest go to "Інші метадані".
const SHOWN_METADATA = new Set(['topicQuestionDecision', 'topicQuestionFallbackReason', 'topicQuestion', 'containsSurveyProbe',
  'surveyProbeQuestionId', 'reportingDisclosureVersion', 'confirmationSummary', 'confirmationSourceMessageIds', 'dataUseReply',
  'dataUseReplyFallbackReason', 'v2BundleReply', 'v2BundleReplyFallbackReason', 'mode', 'classification', 'risk',
  'dialogueAct', 'responseMove', 'isSessionStart', 'sourceInboundMessageId']);
const CONTINUITY_ACTION: Record<string, string> = {
  none: 'тема та сама', replace: 'нова тема замінює попередню', keep: 'тема зберігається', clear: 'тему скинуто',
};

interface ReplyShapeMeta {
  askedQuestion?: unknown;
  maxQuestions?: unknown;
  questionPolicyReason?: unknown;
  conciseSession?: unknown;
  resolvedDetails?: unknown[];
  [key: string]: unknown;
}

/** Plain-language view of outbound metadata the orchestrator writes; unknown keys fall back to a key/value tree. */
export function humanizeMeta(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const v = value as Record<string, unknown>;
  switch (key) {
    case 'replyShape': {
      const shape = value as ReplyShapeMeta;
      return {
        'питання у відповіді': yesNo(shape.askedQuestion),
        'макс. питань': shape.maxQuestions,
        'чому стільки': shape.questionPolicyReason,
        'коротка сесія': yesNo(shape.conciseSession),
        ...(shape.resolvedDetails?.length ? { 'вже встановлено': shape.resolvedDetails } : {}),
        ...Object.fromEntries(Object.entries(shape).filter(([k]) => !['askedQuestion', 'maxQuestions', 'questionPolicyReason', 'conciseSession', 'resolvedDetails'].includes(k))),
      };
    }
    case 'languagePolicy':
      return `${text(v.responseLanguage)} (${v.source === 'product_default' ? 'продуктове правило: завжди англійською' : text(v.source)})`;
    case 'memoryGrounding':
      return v.used ? `відповідь спирається на ${text(v.count)} спогад(ів)` : 'пам\'ять у відповіді не використано';
    case 'continuityDecision':
      return `${CONTINUITY_ACTION[text(v.action)] ?? text(v.action)}; якір теми: ${v.anchorSource === 'stored' ? 'збережений раніше' : v.anchorSource === 'new' ? 'нова репліка' : text(v.anchorSource)}; у репліці є суть: ${yesNo(v.hasSubstance)}`;
    case 'goalDecision':
      return v.selected
        ? `обрано ціль${v.goalId ? ` ${text(v.goalId)}` : ''}${v.reason ? ` (${text(v.reason)})` : ''}`
        : `ціль не обрано: кандидатів ${text(v.candidateGoalCount ?? 0)}, причина ${text(v.reason)}`;
    case 'measurementVersion':
      return `версія вимірювання рішень: ${text(value)}`;
    case 'reportingDisclosureVersion':
      return `показано дисклеймер звітності (${text(value)})`;
    case 'containsSurveyProbe':
      return value ? 'містить pulse-пробу' : 'pulse-проби немає';
    case 'surveyProbeQuestionId':
      return `pulse-питання ${text(value)}`;
    default:
      return typeof value === 'object' ? value : text(value);
  }
}

export const META_LABEL: Record<string, string> = {
  replyShape: 'форма відповіді', languagePolicy: 'мова', memoryGrounding: 'пам\'ять', continuityDecision: 'тема розмови',
  goalDecision: 'цілі', measurementVersion: 'версія', reportingDisclosureVersion: 'дисклеймер', containsSurveyProbe: 'pulse-проба',
  surveyProbeQuestionId: 'pulse-питання',
};

export const EVENT_LABEL: Record<string, string> = {
  inbound: 'вхід', llm: 'LLM', write: 'база', queue: 'черга', warning: 'попередження', error: 'помилка', decision: 'рішення',
};

/** The turn's event chain section; `turnEvents` null means the run predates event tracing. */
export function eventChainSection(turnEvents: readonly TraceEvent[] | null): ReportSection {
  const events: ReportSection = {
    title: 'Ланцюжок подій: виклики LLM, записи в базу і черги, рішення',
    rows: turnEvents?.map((e, i) => ({
      key: `${i + 1}. ${EVENT_LABEL[e.kind] ?? e.kind}`,
      value: `${code(e.name)}${e.summary ? ` · ${e.summary}` : ''}`,
      tone: e.kind === 'error' ? 'bad' as const : undefined,
    })) ?? [],
    empty: turnEvents ? 'Подій цього ходу не записано.' : 'Цей прогін зроблено до того, як харнес почав вести трейс. Події з\'являться з наступного прогону.',
  };
  const count = (kinds: string[]) => turnEvents?.filter((e) => kinds.includes(e.kind)).length ?? 0;
  events.summary = turnEvents
    ? [`LLM: ${count(['llm'])}`, `записів: ${count(['write'])}`, `у черги: ${count(['queue'])}`, count(['warning']) ? `попереджень: ${count(['warning'])}` : null, count(['error']) ? `помилок: ${count(['error'])}` : null].filter(Boolean).join(' · ')
    : 'не записувалось у цьому прогоні';
  return events;
}

/**
 * The «деталі» sections of one bot reply. `trace` is the whole run's event list (events carry their
 * turn); null or undefined for runs recorded before the harness kept a trace.
 */
export function turnSections(turn: ReportTurnView, trace: TraceList): ReportSection[] {
  const c = turn.classification ?? {};
  const plan: ReplyPlanView = turn.replyPlan ?? {};
  const inputs = turn.responseInputs ?? null;
  const effectsTrace = turn.effects ?? null;
  const meta: OutboundMetaView = effectsTrace?.outboundMetadata ?? {};
  const turnEvents = trace ? trace.filter((e) => e.turn === turn.index) : null;
  if (!turn.classification) {
    return [{ title: 'Розбір ходу', rows: [], empty: 'Старий формат звіту: класифікації й трейсу ходу в ньому немає.' }];
  }
  const flags = [
    c.reminderRequest ? `нагадування: «${c.reminderRequest.intent}» на ${c.reminderRequest.dueAt}` : null,
    c.dataUseAlongsideDisclosure ? 'питання про дані + розповідь' : null,
    c.cycleStatusQuestion ? 'питає, що лишилось у pulse-циклі' : null,
    c.priorAssistantOffer ? `бот щось пропонував; працівник ${c.acceptsPriorOffer ? 'прийняв' : 'не прийняв'}` : null,
    c.formatRequest ? `просить формат: ${c.formatRequest}` : null,
    c.pulseCaptureScope ? `питає, що зафіксовано: ${JSON.stringify(c.pulseCaptureScope)}` : null,
    c.onboardingSignal ? `онбординг: ${c.onboardingSignal.intent}${c.onboardingSignal.substantive ? ' + суть' : ''}` : null,
    c.requiresSafetyCheck ? 'потрібна перевірка безпеки' : null,
    c.surveyAllowed === false ? 'pulse-питання заборонені цього ходу' : null,
  ].filter((flag): flag is string => Boolean(flag));
  const classifier: ReportSection = {
    title: 'Що зрозумів класифікатор',
    rows: rows([
      row('інтент', `${code(c.primaryIntent)}${c.secondaryIntents?.length ? ` + ${c.secondaryIntents.map(code).join(', ')}` : ''}`),
      row('тип репліки', c.dialogueAct ? code(c.dialogueAct) : null),
      row('суть репліки', c.latestUserSubstance),
      row('емоції', c.emotionalState?.join(', ')),
      row('терміновість', c.urgency && c.urgency !== 'low' ? c.urgency : null, 'bad'),
      row('впевненість', c.confidence !== undefined ? String(c.confidence) : null),
      row('прапорці', flags),
      row('пояснення', c.reasoningSummary),
    ]),
  };
  const state: ReportSection = {
    title: 'Стан розмови',
    rows: rows([
      row('тема гілки', plan.topicAnchor),
      row('вже встановлено', plan.resolvedDetails),
      row('спогади в ході', plan.memoryAnchors),
      row('пам\'ять у контексті', inputs?.memoryContext?.items),
      row('цілі в контексті', inputs?.memoryContext?.goals),
      row('корекція з минулого', plan.correctionCarryover ? 'так' : null),
      row('локальний час', inputs?.localTime),
      row('початок сесії', inputs?.isSessionStart ? 'так' : null),
    ]),
    empty: 'Нічого не встановлено і пам\'яті немає.',
  };
  const progress = inputs?.cycleProgress;
  const confirmation = inputs?.confirmationRequest;
  const decision = meta.topicQuestionDecision;
  const pulseRows = rows([
    row('цикл', progress ? `${progress.inCycle ? 'відкритий' : 'не відкритий'}: закрито ${progress.topicsClosed} з ${progress.topicsTotal} тем${progress.awaitingReply ? ', чекаємо відповідь' : ''}` : null),
    row('відкриті теми', progress?.openTopics),
    row('питання на тему', inputs?.topicQuestion ? `${code(inputs.topicQuestion.questionGroup)} (${inputs.topicQuestion.focus === 'driver' ? 'що за цим стоїть' : 'відкрити тему'}), ${code(inputs.topicQuestion.questionId)}` : null),
    row('pulse-проба', inputs?.surveyProbeQuestion ? `${code(inputs.surveyProbeQuestion.id)}${inputs.surveyProbeQuestion.responseType ? ` (${inputs.surveyProbeQuestion.responseType})` : ''}` : null),
    row('рішення про питання', decision ? short(decision, 300) : null),
    row('питання в відповіді', meta.topicQuestion ? short(meta.topicQuestion, 300) : null),
    row('фолбек питання', meta.topicQuestionFallbackReason, 'bad'),
    row('у відповіді є проба', meta.containsSurveyProbe ? `так${meta.surveyProbeQuestionId ? `, ${code(meta.surveyProbeQuestionId)}` : ''}` : null),
    row('підтвердження теми', confirmation ? `${code(confirmation.questionGroup)}: ${confirmation.evidence.length} доказ(ів)` : null),
    row('зібрані докази', confirmation?.evidence.map((e) => `${e.polarity}: ${e.evidenceSummary}`)),
    row('підсумок на підтвердження', meta.confirmationSummary),
    row('тему підтверджено', inputs?.topicConfirmed ? `${code(inputs.topicConfirmed.questionGroup)}${inputs.topicConfirmed.topicsTotal ? `, ${text(inputs.topicConfirmed.topicsClosed)} з ${inputs.topicConfirmed.topicsTotal}` : ''}` : null, 'ok'),
    row('пункт не зараховано', inputs?.questionNotCollected ? code(inputs.questionNotCollected.questionGroup) : null, 'bad'),
    row('факти для відповіді «що зафіксовано»', inputs?.captureFacts ? short(inputs.captureFacts, 300) : null),
    row('дисклеймер звітності', inputs?.reportingDisclosure || meta.reportingDisclosureVersion ? `показано${meta.reportingDisclosureVersion ? ` (${text(meta.reportingDisclosureVersion)})` : ''}` : null),
  ]);
  const pulse: ReportSection = {
    title: 'Pulse-цикл',
    rows: pulseRows,
    empty: 'Цього ходу pulse-циклу в контексті немає: питань на тему, проб і підтверджень не було.',
  };
  const policy = plan.questionPolicy;
  const replyPlan: ReportSection = {
    title: 'План відповіді',
    rows: rows([
      row('хід', plan.responseMove ? code(plan.responseMove) : null),
      row('режим', code(turn.mode)),
      row('питань можна', policy ? `${policy.maxQuestions} (${policy.reason})` : null),
      row('заборонено', plan.forbiddenMoves?.map(code)),
      row('спиратися на', plan.requiredGrounding),
      row('формат', plan.formatRequest),
      row('можна читати між рядків', plan.mayInferFromBrevity === false ? 'ні' : null),
      row('фіксований текст', inputs?.trailingBundle ? `${code(inputs.trailingBundle.kind)}: ${short(inputs.trailingBundle.text, 160)}` : null),
      row('як доставлено', meta.dataUseReply ?? meta.v2BundleReply ?? null),
      row('фолбек', meta.dataUseReplyFallbackReason ?? meta.v2BundleReplyFallbackReason ?? null, 'bad'),
      row('генерацій', effectsTrace && effectsTrace.generationAttempts > 1 ? `${effectsTrace.generationAttempts} (була виправна регенерація)` : null, 'bad'),
      row('ризик', turn.risk && turn.risk.severity !== 'none' ? `${turn.risk.severity} (${text(turn.risk.type)})` : null, 'bad'),
      row('стиль', inputs?.styleAdaptationWeight ? `адаптація ${text(inputs.styleAdaptationWeight)}` : null),
    ]),
  };
  const effects: ReportSection = {
    title: 'Побічні ефекти',
    rows: rows([
      row('пам\'ять додано', effectsTrace?.memoryAdded.map((m) => `${m.category}: ${m.content}`)),
      row('нагадування', inputs?.reminderConfirmation ? `підтверджено: «${inputs.reminderConfirmation.intent}» на ${inputs.reminderConfirmation.dueAt}` : null),
      row('намір нагадати', inputs?.reminderIntent),
      row('follow-up', inputs?.followUpIntent),
      row('ескалації', effectsTrace?.escalations.map((e) => `${e.type} · ${e.severity}${e.riskType ? ` · ${e.riskType}` : ''}`), 'bad'),
    ]),
    empty: effectsTrace ? 'Нічого не записано: пам\'яті, нагадувань і ескалацій немає.' : 'Трейсу ходу немає.',
  };
  const restMeta = Object.entries(meta).filter(([key, value]) => !SHOWN_METADATA.has(key) && key !== 'measurementVersion' && value !== undefined && value !== null);
  const other: ReportSection = {
    title: 'Інші метадані відповіді',
    rows: restMeta.map(([key, value]) => ({ key: META_LABEL[key] ?? key, value: humanizeMeta(key, value) })).filter((r) => r.value !== null),
    empty: 'Немає.',
  };
  const events = eventChainSection(turnEvents);
  classifier.summary = [code(c.primaryIntent), c.dialogueAct ? code(c.dialogueAct) : null, c.emotionalState?.length ? c.emotionalState.join(', ') : null, flags.length ? `прапорців: ${flags.length}` : null].filter(Boolean).join(' · ');
  state.summary = [plan.resolvedDetails?.length ? `встановлено фактів: ${plan.resolvedDetails.length}` : 'встановлених фактів немає', inputs?.memoryContext?.items?.length ? `спогадів у контексті: ${inputs.memoryContext.items.length}` : null].filter(Boolean).join(' · ');
  pulse.summary = inputs?.topicQuestion ? `питання на тему ${code(inputs.topicQuestion.questionGroup)}` : confirmation ? `підтвердження теми ${code(confirmation.questionGroup)}` : pulseRows.length ? `${pulseRows.length} поле(ів)` : 'не активний цього ходу';
  replyPlan.summary = [plan.responseMove ? code(plan.responseMove) : null, policy ? `питань ≤ ${policy.maxQuestions}` : null, effectsTrace && effectsTrace.generationAttempts > 1 ? 'була регенерація' : null].filter(Boolean).join(' · ');
  effects.summary = effects.rows.length ? effects.rows.map((r) => r.key).join(', ') : 'нічого';
  other.summary = `${other.rows.length} поле(ів)`;
  // Sections with nothing to show are left out instead of rendering an empty block under every turn.
  return [classifier, state, pulse, replyPlan, effects, events, other].filter((sec) => sec.rows.length);
}

// Small icons under a bot reply for the side effects worth noticing. Writes and queues every turn makes
// (saving and delivering the message, the standard background jobs) are left out so the icons stay meaningful.
const ROUTINE_EVENTS = new Set([
  'conversation.saveMessage', 'conversation.updateMessageDelivery',
  'outbox.enqueueMessageSend', 'outbox.enqueueMemoryExtraction', 'outbox.enqueueStyleAnalysis', 'outbox.enqueueSurveyEvidence',
]);

interface BadgeDef {
  key: string;
  icon: string;
  label: string;
  tone?: 'bad' | 'warn';
  match: (name: string, kind: string) => boolean;
}

const BADGES: BadgeDef[] = [
  { key: 'memory', icon: '🧠', label: 'пам\'ять', match: (name) => name.startsWith('memory.') },
  { key: 'goal', icon: '🎯', label: 'ціль', match: (name) => name.startsWith('goals.') },
  { key: 'reminder', icon: '⏰', label: 'нагадування', match: (name) => name.startsWith('scheduledActions.') || name === 'outbox.enqueueFollowUpExecution' },
  { key: 'escalation', icon: '🚨', label: 'ескалація', tone: 'bad', match: (name) => name.startsWith('escalation.') },
  { key: 'topic', icon: '🧵', label: 'тема', match: (name) => name === 'conversation.updateActiveTopic' },
  { key: 'style', icon: '✍️', label: 'стиль', match: (name) => name.startsWith('style.') },
  { key: 'db', icon: '💾', label: 'база', match: (_name, kind) => kind === 'write' },
  { key: 'queue', icon: '📨', label: 'черга', match: (_name, kind) => kind === 'queue' },
];

/** Side-effect icons under one bot reply; `trace` as in `turnSections`. */
export function stepBadges(turn: ReportTurnView, trace: TraceList): ReportBadge[] {
  const found = new Map<string, ReportBadge>();
  const add = (key: string, detail: string | null, extra: { icon?: string; label?: string; tone?: 'bad' | 'warn' } = {}) => {
    const def = BADGES.find((b) => b.key === key) ?? { key, ...extra };
    if (!found.has(key)) found.set(key, { icon: def.icon ?? '', label: def.label ?? key, tone: def.tone ?? null, details: [] });
    if (detail) found.get(key)?.details.push(detail);
  };
  const events = trace?.filter((e) => e.turn === turn.index) ?? [];
  for (const e of events) {
    const describe = `${e.name}${e.summary ? `: ${e.summary}` : ''}`;
    if (e.kind === 'error') { add('error', describe, { icon: '⛔', label: 'помилка', tone: 'bad' }); continue; }
    if (e.kind === 'warning') { add('warning', describe, { icon: '⚠️', label: 'попередження', tone: 'warn' }); continue; }
    if (!['write', 'queue'].includes(e.kind) || ROUTINE_EVENTS.has(e.name)) continue;
    const badge = BADGES.find((b) => b.match(e.name, e.kind));
    if (badge) add(badge.key, describe);
  }
  // Older runs have no event trace; the turn's own effects still show memory and escalations.
  const effects = turn.effects;
  if (!trace) {
    for (const m of effects?.memoryAdded ?? []) add('memory', `${m.category}: ${m.content}`);
    for (const e of effects?.escalations ?? []) add('escalation', `${e.type} · ${e.severity}`);
  }
  const inputs: ResponseInputsView = turn.responseInputs ?? {};
  const meta: OutboundMetaView = effects?.outboundMetadata ?? {};
  if (inputs.reminderConfirmation) add('reminder', `підтверджено: «${inputs.reminderConfirmation.intent}» на ${inputs.reminderConfirmation.dueAt}`);
  if (inputs.topicConfirmed) add('pulse', `тему ${inputs.topicConfirmed.questionGroup} підтверджено`, { icon: '📊', label: 'pulse' });
  if (inputs.questionNotCollected) add('pulse', `пункт ${inputs.questionNotCollected.questionGroup} не зараховано`, { icon: '📊', label: 'pulse' });
  if (meta.topicQuestion || meta.containsSurveyProbe) add('pulse', 'бот поставив pulse-питання', { icon: '📊', label: 'pulse' });
  if (turn.risk && turn.risk.severity !== 'none') add('risk', `${turn.risk.severity} (${text(turn.risk.type)})`, { icon: '🛡️', label: 'ризик', tone: 'bad' });
  return [...found.values()].map((b) => ({ ...b, details: [...new Set(b.details)] }));
}
