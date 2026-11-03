#!/usr/bin/env node
// Builds report data for a live sim run from Vitest's JSON output and the harness's runs/*.json files.
// usage: node from-sim-run.mjs --vitest <vitest.json[,later.json]> --runs <runs dir> --since <ISO time> --out <report.json> [--title <text>]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { humanizeMeta, META_LABEL, stepBadges as sharedStepBadges, turnSections as sharedTurnSections } from '@entalent/conversation-trace';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (key === 'live-only') { args.liveOnly = true; i -= 1; continue; }
  else args[key] = process.argv[i + 1];
}
for (const key of ['vitest', 'runs', 'since', 'out']) {
  if (!args[key]) {
    console.error('usage: node from-sim-run.mjs --vitest <vitest.json> --runs <runs dir> --since <ISO time> --out <report.json> [--title <text>]');
    process.exit(1);
  }
}

// Several Vitest files may be passed comma-separated; a later file's result replaces an earlier one for the same test.
const vitestFiles = args.vitest.split(',').map((path) => JSON.parse(readFileSync(path, 'utf8')));
const vitest = vitestFiles[0];
const since = Date.parse(args.since);
const allScenarios = readdirSync(args.runs)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(args.runs, file), 'utf8')))
  .filter((report) => report.schemaVersion === 1 && Date.parse(report.runAt) >= since)
  .sort((a, b) => a.scenarioName.localeCompare(b.scenarioName));

// A provider outage or quota error says nothing about the bot's behavior: it is reported as ERROR, not FAIL.
const INFRA_ERROR = /\b429\b|rate limit|ECONNRESET|ETIMEDOUT|socket hang up|\b50[234]\b|AI_RetryError/i;
const allTests = [...new Map(vitestFiles.flatMap((v) => v.testResults).flatMap((file) => file.assertionResults.map((test) => {
  const lines = (test.failureMessages ?? []).join('\n').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const failure = lines[0] ?? '';
  // The first lines up to the stack trace: enough to read an assertion's expected/received values.
  const failureDetail = lines.slice(0, lines.findIndex((line) => line.startsWith('at ')) >>> 0).slice(0, 40).join('\n').slice(0, 3000);
  return {
    file: relative(process.cwd(), file.name),
    name: test.fullName,
    status: test.status === 'failed' && INFRA_ERROR.test(failure) ? 'error' : test.status,
    durationMs: test.duration ?? 0,
    failure,
    failureDetail,
    // Every failure message, for matching soft assertions that failed after the first one.
    failureDetailFull: lines.join('\n'),
    path: file.name,
  };
})).map((test) => [test.name, test])).values()];


const code = (value) => `\`${value}\``;
const short = (value, max = 400) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
// The turn breakdown and side-effect icons are shared with production trace exports.
const turnSections = (turn, s) => sharedTurnSections(turn, s.trace);
const stepBadges = (turn, s) => sharedStepBadges(turn, s.trace);

// Facts read from the test file itself: why it exists, what the scenario says, what the code asserts.
const sourceCache = new Map();
function testSource(path) {
  if (!path || !existsSync(path)) return null;
  if (sourceCache.has(path)) return sourceCache.get(path);
  const text = readFileSync(path, 'utf8');
  const purpose = [...text.matchAll(/\/\*\*([\s\S]*?)\*\/\s*\n\s*(?:describe|it)\b/g)]
    .map((m) => m[1].split('\n').map((line) => line.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' '));
  const descriptions = [...text.matchAll(/description:\s*([^\n]+(?:\n\s+'[^\n]*)*)/g)].map((m) => {
    const raw = m[1].trim().replace(/,$/, '');
    const literal = [...raw.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((q) => q[2]).join('');
    return literal || `з фікстури \`${raw}\``;
  });
  const asserts = [];
  // Assertions that carry their own message (`expect(value, 'message')`): each is shown as a check with its outcome.
  const checks = [];
  let comment = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) { comment.push(trimmed.replace(/^\/\/\s?/, '')); continue; }
    if (/\bexpect(\.soft)?\(/.test(trimmed)) {
      if (comment.length) asserts.push(`// ${comment.join(' ')}`);
      asserts.push(trimmed);
      const message = trimmed.match(/\bexpect(?:\.soft)?\(.*?,\s*(['`])((?:\\.|(?!\1)[^\\])*?)\1\s*\)\./);
      if (message) checks.push({ message: message[2].split('${')[0].replace(/[:\s]+$/, ''), comment: comment.join(' ') });
    }
    if (trimmed) comment = [];
  }
  const facts = { purpose, descriptions, asserts, checks };
  sourceCache.set(path, facts);
  return facts;
}
const unanswered = (s) => s.unansweredInputs ?? s.userMessages?.slice(s.turns.length) ?? [];
const normalizeName = (name) => String(name ?? '').replace(/ > /g, ' ').trim();
const testsByName = new Map(allTests.map((test) => [normalizeName(test.name), test]));
const testFor = (s) => (s.testName ? testsByName.get(normalizeName(s.testName)) : undefined);
const HARNESS_RULES = new Set(['test-failure', 'agent-turn-error']);
const heuristics = (s) => s.deterministic.violations.filter((v) => !HARNESS_RULES.has(v.rule));
// Plain-language meaning of each harness heuristic (`harness/assertions.ts`).
const RULE_EXPLAIN = {
  'reflective-opener': 'відповідь починається з шаблонного віддзеркалення почуття («That sounds like…»), а не з суті',
  'too-many-questions': 'у відповіді більше одного питання',
  'repeated-question': 'бот повторив питання, яке вже ставив у цій розмові',
  'survey-during-crisis': 'pulse-питання в розмові про кризу',
  'crisis-reply-too-long': 'відповідь на кризу задовга',
};
const describeHeuristic = (v) => `крок ${v.turn}: ${RULE_EXPLAIN[v.rule] ?? code(v.rule)}. Початок відповіді: «${v.detail}»`;
// `expect(describeViolations(...)).toBe('')` fails with Vitest's cut-off diff; the violations themselves say it better.
const HEURISTICS_ASSERT = /^AssertionError: expected '(?:turn \d+ — |\[)/;

// Live means the bot answered through the real model: the harness records a substituted provider in its setup.
const isLive = (s) => Boolean(s.context) && !s.context.setup.some((fact) => fact.startsWith('custom AI provider'));
const scenarios = args.liveOnly ? allScenarios.filter(isLive) : allScenarios;
// Kind of each test from data: its own scenario report, else the reports of other tests in the same file.
const linkedTests = new Map(allScenarios.map((s) => [testFor(s)?.name, isLive(s)]).filter(([name]) => name));
const fileKinds = new Map();
for (const s of allScenarios) {
  const test = testFor(s);
  if (test) fileKinds.set(test.path, new Set([...(fileKinds.get(test.path) ?? []), isLive(s)]));
}
function testKind(test) {
  if (linkedTests.has(test.name)) return { kind: linkedTests.get(test.name) ? 'live' : 'scripted', ownReport: true };
  if (!['passed', 'failed', 'error'].includes(test.status)) return { kind: 'skipped', ownReport: false };
  const kinds = fileKinds.get(test.path);
  if (kinds?.size === 1) return { kind: [...kinds][0] ? 'live' : 'scripted', ownReport: false };
  return { kind: 'unknown', ownReport: false };
}
const kindOf = new Map(allTests.map((test) => [test.name, testKind(test)]));
const tests = args.liveOnly ? allTests.filter((test) => kindOf.get(test.name).kind === 'live') : allTests;
const scenarioByTest = new Map(scenarios.map((s) => [testFor(s)?.name, s]).filter(([name]) => name));

const seconds = (ms) => `${Math.round(ms / 1000)} с`;
const dash = (value) => (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length) ? '—' : value);
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
// IDs the team already puts in test names (capabilities, bug numbers, sprint tasks) serve as tags until tests carry real ones.
const TAG_PATTERN = /\b(?:CAP-\d+|B\d{2,}|S\d+-T\d+)\b/g;

// Tests generated from QA test files (`qa-tests/*.json`) by this runner carry their facts in the run's `qa` section.
const QA_RUNNER = 'qa-tests.sim.test.ts';
const isQaTest = (test, s) => basename(test.file) === QA_RUNNER || Boolean(s?.qa);
const tagsOf = (test, s) => [...new Set([...(s?.qa?.tags ?? []), ...(test.name.match(TAG_PATTERN) ?? [])])];

function descriptionSummary(test, s) {
  const qa = s?.qa;
  const parts = [qa?.jira, qa?.story ? `story ${qa.story}` : null, ...tagsOf(test, s)].filter(Boolean);
  return parts.join(' ') || basename(test.file);
}

function descriptionRows(test, s, id) {
  const src = isQaTest(test, s) ? null : testSource(test.path);
  const qa = s?.qa;
  const suite = s?.testName?.includes(' > ') ? s.testName.split(' > ')[0] : null;
  const tags = tagsOf(test, s);
  const models = s?.models;
  return [
    { key: 'кейс', value: id },
    { key: 'Jira', value: dash(qa?.jira) },
    { key: 'сторі', value: dash(qa?.story) },
    { key: 'сюта', value: `${suite ? `${suite} · ` : ''}${code(basename(test.file))}` },
    { key: 'теги', value: tags.length ? tags.map(code).join(' ') : '—' },
    { key: 'тип', value: kindOf.get(test.name).kind === 'live' ? 'живий: бот відповідає реальною моделлю' : kindOf.get(test.name).kind === 'scripted' ? 'заскриптована модель' : '—' },
    { key: 'мета', value: qa ? qa.title : dash(src?.purpose[0]) },
    { key: 'сценарій', value: qa
      ? `QA-файл ${code(qa.file)} · передумова ${code(qa.precondition)}`
      : dash(src?.descriptions.length ? short([...new Set(src.descriptions)].join(' / '), 700) : null) },
    { key: 'моделі', value: models ? `бот ${models.coachBalanced ?? '?'} · суддя ${models.judge ?? '?'} · симулятор ${models.simulator ?? '?'}` : '—' },
    { key: 'запуск', value: s ? `${s.runAt.replace('T', ' ').slice(0, 19)} UTC · ${seconds(test.durationMs)}` : seconds(test.durationMs) },
  ];
}

function given(s) {
  const ctx = s?.context;
  if (!ctx) return { summary: 'немає даних', rows: [{ key: 'стан', value: s ? 'Звіт записано старою версією харнесу: контексту в ньому немає.' : 'Звіту розмови немає.' }], history: [] };
  const first = s.turns[0]?.responseInputs ?? {};
  const progress = first.cycleProgress;
  const evidence = first.confirmationRequest?.evidence ?? [];
  const onboarding = ctx.setup.filter((fact) => /onboard/i.test(fact));
  const history = ctx.messages.map((m) => ({
    role: m.direction === 'inbound' ? 'user' : 'bot',
    label: m.direction === 'inbound' ? 'працівник · історія' : 'бот · історія',
    text: m.text,
    notes: m.notes.map((note) => {
      const at = note.indexOf('=');
      const key = note.slice(0, at);
      let value = note.slice(at + 1);
      try { value = JSON.parse(value); } catch { /* keep text */ }
      const human = humanizeMeta(key, value);
      return typeof human === 'string' ? human : `${META_LABEL[key] ?? key}: ${JSON.stringify(human)}`;
    }),
    seed: true,
  }));
  if (ctx.precondition) return givenFromPrecondition(ctx, history);
  const pulse = progress ? `${progress.inCycle ? 'відкритий' : 'не відкритий'}: закрито ${progress.topicsClosed} з ${progress.topicsTotal} тем${progress.openTopics?.length ? `; відкриті: ${progress.openTopics.join(', ')}` : ''}` : null;
  return {
    summary: [
      ctx.setup[0],
      `пам'ять: ${ctx.memory.length}`,
      `історія: ${ctx.messages.length ? plural(ctx.messages.length, 'повідомлення', 'повідомлення', 'повідомлень') : 'порожня'}`,
      progress ? `pulse: ${progress.inCycle ? 'відкритий' : 'не відкритий'}` : null,
    ].filter(Boolean).join(' · '),
    rows: [
      { key: 'користувач', value: dash(ctx.setup.filter((fact) => !onboarding.includes(fact)).join(' · ')) },
      { key: 'онбординг', value: dash(onboarding.length ? onboarding : null) },
      { key: 'пам\'ять', value: dash(ctx.memory.map((m) => `${m.category}: ${m.content}`)) },
      { key: 'цілі', value: dash(first.memoryContext?.goals) },
      { key: 'pulse-цикл', value: dash(pulse) },
      { key: 'зібрані pulse-відповіді', value: dash(evidence.map((e) => `${e.polarity}: ${e.evidenceSummary}`)) },
      { key: 'історія розмови', value: ctx.messages.length ? `${plural(ctx.messages.length, 'повідомлення', 'повідомлення', 'повідомлень')}, нижче` : 'порожня: розмова починається з першого кроку' },
    ],
    history,
  };
}

// A run built from a precondition file shows the file's state, not what the first turn happened to read.
function givenFromPrecondition(ctx, history) {
  const p = ctx.precondition;
  const cycle = p.cycle;
  const historyRow = ctx.messages.length ? `${plural(ctx.messages.length, 'повідомлення', 'повідомлення', 'повідомлень')}, нижче` : 'порожня: розмова починається з першого кроку';
  const pulse = cycle
    ? (cycle.open
      ? [
          `відкритий: закрито ${cycle.topicsClosed} з ${cycle.topicsTotal} тем${cycle.openTopics.length ? `; відкриті: ${cycle.openTopics.join(', ')}` : ''}`,
          ...cycle.topics.map((topic) => `тема ${topic}`),
          cycle.nextProbe ? `наступне питання: ${cycle.nextProbe}` : null,
        ].filter(Boolean)
      : 'не відкритий')
    : null;
  return {
    summary: [
      `передумова ${code(p.name)}`,
      p.presets.length ? `пресети: ${p.presets.join(', ')}` : null,
      `пам'ять: ${ctx.memory.length}`,
      `історія: ${ctx.messages.length ? plural(ctx.messages.length, 'повідомлення', 'повідомлення', 'повідомлень') : 'порожня'}`,
      cycle ? `pulse: ${cycle.open ? `${cycle.topicsClosed}/${cycle.topicsTotal}` : 'не відкритий'}` : null,
    ].filter(Boolean).join(' · '),
    rows: [
      { key: 'передумова', value: `${code(p.name)} · ${p.origin}${p.source ? ` · ${code(basename(p.source))}` : ''}` },
      { key: 'пресети', value: dash(p.presets) },
      { key: 'користувач', value: p.user },
      { key: 'час старту', value: dash(p.startTime ? `${p.startTime}${p.elapsedMinutes !== null ? ` · з останнього повідомлення минуло ${p.elapsedMinutes} хв` : ''}` : (p.elapsedMinutes !== null ? `з останнього повідомлення минуло ${p.elapsedMinutes} хв` : null)) },
      { key: 'онбординг', value: dash(p.onboarding) },
      { key: 'пам\'ять', value: dash(ctx.memory.map((m) => `${m.category}: ${m.content}`)) },
      { key: 'цілі', value: dash(p.goals) },
      { key: 'стиль', value: dash(p.styleProfile) },
      { key: 'pulse-цикл', value: dash(pulse) },
      { key: 'зібрані pulse-відповіді', value: dash(p.evidence) },
      { key: 'заплановані дії', value: dash(p.scheduledActions) },
      { key: 'історія розмови', value: historyRow },
    ],
    history,
  };
}

function steps(s) {
  if (!s) return [];
  const total = s.turns.length + unanswered(s).length;
  const items = s.turns.flatMap((turn) => [
    { role: 'user', label: `працівник · крок ${turn.index} / ${total}`, text: s.userMessages?.[turn.index - 1] ?? turn.userText ?? '(репліку не записано: старий формат звіту)' },
    { role: 'bot', label: `бот · крок ${turn.index} · ${turn.responseLength} симв.`, text: turn.responseText, sections: turnSections(turn, s), badges: stepBadges(turn, s) },
  ]);
  for (const text of unanswered(s)) {
    items.push({ role: 'user', label: 'працівник', text });
    items.push({ role: 'bot', label: 'бот', text: 'Відповіді немає: крок упав з помилкою (див. фактичний результат).', missing: true });
  }
  return items;
}

// The failing part of Vitest's message for one check: from its message to the end of that assertion.
function failedClause(test, message) {
  const full = test.failureDetailFull ?? '';
  const at = full.indexOf(message);
  if (at < 0) return null;
  const rest = full.slice(at + message.length).replace(/^[:\s]+/, '');
  return short(rest.split(/;\s|\n/)[0], 300) || 'не виконано';
}

// One row per QA expectation (judged) and per hard check (code); the runner's own asserts are not listed.
function qaComparisons(test, s) {
  const rows = [];
  for (const e of s?.qa?.expectations ?? []) {
    const unjudged = s.judge.evaluated ? 'суддя не дав вердикту по цьому пункту' : 'не оцінено: суддя не запускався';
    rows.push({ source: 'суддя', expected: e.text, actual: e.met === true ? 'виконано' : e.met === false ? 'не виконано' : unjudged, met: e.met === true });
  }
  for (const c of s?.qa?.hardChecks ?? []) rows.push({ source: 'жорстка перевірка', expected: c.label, actual: c.actual, met: c.met });
  // A failure no judged or checked row explains (a broken file, a turn error) still shows.
  const explained = (s?.qa?.expectations ?? []).some((e) => e.met === false) || (s?.qa?.hardChecks ?? []).some((c) => !c.met);
  if (test.status === 'failed' && !explained) {
    rows.push({ source: 'харнес', expected: 'тест проходить без помилок', actual: short(test.failureDetail || test.failure, 600), met: false });
  }
  return rows;
}

function actual(test, s) {
  const comparisons = [];
  const qaRun = isQaTest(test, s);
  const src = qaRun ? null : testSource(test.path);
  const ran = ['passed', 'failed'].includes(test.status);
  if (ran && qaRun) comparisons.push(...qaComparisons(test, s));
  if (ran && !qaRun) {
    for (const check of src?.checks ?? []) {
      const failed = (test.failureDetailFull ?? '').includes(check.message);
      comparisons.push({ source: 'код тесту', expected: check.comment || check.message, actual: failed ? failedClause(test, check.message) : 'так', met: !failed });
    }
    // Plain `expect(...)` calls carry no message to match, so they show as one row with the test's own outcome.
    const matched = comparisons.some((r) => r.met === false);
    if (!src?.checks.length || (test.status === 'failed' && !matched)) {
      comparisons.push({ source: 'код тесту', expected: 'тест проходить без помилок (асерти без власного повідомлення)', actual: test.status === 'passed' ? 'пройшли' : short(test.failureDetail || test.failure, 600), met: test.status === 'passed' });
    }
  }
  if (s?.judge.evaluated && !qaRun) {
    for (const c of s.judge.metCriteria) comparisons.push({ source: 'суддя', expected: c, actual: 'виконано', met: true });
    for (const c of s.judge.unmetCriteria) comparisons.push({ source: 'суддя', expected: c, actual: 'не виконано', met: false });
  }
  const found = s ? heuristics(s) : [];
  const heuristicsChecked = HEURISTICS_ASSERT.test(test.failureDetail ?? '') || /describeViolations/.test(src?.asserts.join('\n') ?? '');
  if (heuristicsChecked) {
    if (!found.length) comparisons.push({ source: 'евристики харнесу', expected: 'жодного зауваження евристик', actual: 'зауважень немає', met: true });
    for (const v of found) comparisons.push({ source: 'евристики харнесу', expected: 'жодного зауваження евристик', actual: describeHeuristic(v), met: false });
  } else {
    for (const v of found) comparisons.push({ source: 'евристика, тест її не перевіряє', expected: '—', actual: describeHeuristic(v), met: 'info' });
  }
  for (const v of s?.deterministic.violations.filter((x) => HARNESS_RULES.has(x.rule)) ?? []) {
    if (!test.failureDetail?.includes(v.detail.slice(0, 40))) comparisons.push({ source: 'харнес', expected: 'крок відпрацьовує без помилки', actual: `крок ${v.turn}: ${v.detail}`, met: false });
  }
  const mismatches = comparisons.filter((r) => r.met === false).length;
  let failure = null;
  if (test.status === 'error') failure = `Збій інфраструктури (ліміт або недоступність провайдера), а не поведінка бота; тест треба перезапустити. ${test.failure}`;
  else if (!ran) failure = `Тест не виконувався (статус vitest: ${test.status}).`;
  const judge = s?.judge;
  const judgeTitle = !judge?.evaluated ? 'Суддя (LLM): не оцінював'
    : judge.passed ? `Суддя (LLM): прийняв, ${judge.metCriteria.length} з ${judge.metCriteria.length + judge.unmetCriteria.length} критеріїв`
      : `Суддя (LLM): не прийняв, ${judge.unmetCriteria.length} з ${judge.metCriteria.length + judge.unmetCriteria.length} критеріїв не виконано`;
  return {
    summary: [
      comparisons.some((r) => r.met !== 'info') ? `${mismatches ? '✗' : '✓'} збіглося ${comparisons.filter((r) => r.met === true).length} з ${comparisons.filter((r) => r.met !== 'info').length}` : null,
      !judge?.evaluated ? 'суддя не оцінював' : judge.passed ? 'суддя прийняв' : 'суддя не прийняв',
      test.status === 'error' ? 'збій інфраструктури' : null,
    ].filter(Boolean).join(' · '),
    failure,
    comparisons: comparisons.sort((a, b) => (a.met === false ? 0 : a.met === 'info' ? 1 : 2) - (b.met === false ? 0 : b.met === 'info' ? 1 : 2)),
    judge: { title: judgeTitle, reasoning: judge?.evaluated ? judge.reasoning ?? null : null },
  };
}

const STATUS_ORDER = { failed: 0, error: 1, skipped: 2, pending: 2, todo: 2, passed: 3 };
const ordered = [...tests].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));
const count = (status) => tests.filter((test) => test.status === status).length;
const counts = { total: tests.length, passed: count('passed'), failed: count('failed'), error: count('error') };
counts.skipped = counts.total - counts.passed - counts.failed - counts.error;
const models = scenarios[0]?.models ?? {};
const startedAt = new Date(vitest.startTime ?? since);
const data = {
  meta: {
    eyebrow: 'conversation-sim',
    title: args.title ?? (args.liveOnly ? 'Живі сценарії' : 'Сценарії'),
    details: [
      `Прогін ${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      `бот ${models.coachBalanced ?? '?'}, суддя ${models.judge ?? '?'}, симулятор ${models.simulator ?? '?'}`,
      scenarios[0]?.gitSha ? `commit \`${scenarios[0].gitSha.slice(0, 7)}\`` : null,
    ].filter(Boolean),
  },
  suite: {
    counts,
    tests: ordered.map((test, index) => {
      const s = scenarioByTest.get(test.name);
      const id = `TC-${String(index + 1).padStart(2, '0')}`;
      const turns = s ? s.turns.length : 0;
      return {
        id,
        name: test.name,
        status: test.status === 'pending' || test.status === 'todo' ? 'skipped' : test.status,
        duration: seconds(test.durationMs),
        descriptionSummary: descriptionSummary(test, s),
        description: descriptionRows(test, s, id),
        given: given(s),
        stepsSummary: s ? `${plural(turns, 'крок', 'кроки', 'кроків')}${unanswered(s).length ? `, ${unanswered(s).length} без відповіді` : ''}` : 'немає',
        steps: steps(s),
        stepsEmpty: s ? 'Жодного кроку не відбулося.' : 'Звіт розмови цього тесту перезаписав інший тест із тією ж назвою сценарію; з наступного прогону кожен тест пише свій файл.',
        actual: actual(test, s),
      };
    }),
  },
};
writeFileSync(args.out, JSON.stringify(data, null, 1));
console.log(`report data written: ${args.out} (${tests.length} tests, ${scenarios.length} scenario reports)`);
