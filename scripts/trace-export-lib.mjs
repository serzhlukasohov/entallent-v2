// Pure helpers of `scripts/trace-export.mjs`: machine-readable views of admin API answers for the QA
// screenshot skill (`.claude/skills/qa-screenshot-to-test`). No I/O here; tested by trace-export.test.mjs.

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Title and row key of the per-turn section `buildTraceExportReport` (@entalent/conversation-trace) adds to every bot step.
export const TRACE_SECTION_TITLE = 'Трейс ходу';
const TRACE_ROW_KEY = 'трейс';
const MAX_VALUE_CHARS = 1500;

/**
 * Groups the answers of several searches (one per fragment, in argument order) by conversation. A conversation
 * hit by more fragments ranks first; ties go to the most recent match. Fragments are referred to by their
 * 1-based position, never echoed.
 */
export function groupSearchResults(results) {
  const byConversation = new Map();
  const searches = results.map((result, i) => {
    const fragment = i + 1;
    for (const match of result.matches ?? []) {
      let entry = byConversation.get(match.conversationId);
      if (!entry) {
        entry = { conversationId: match.conversationId, fragmentsHit: [], lastMatchAt: match.startedAt, matches: [] };
        byConversation.set(match.conversationId, entry);
      }
      if (!entry.fragmentsHit.includes(fragment)) entry.fragmentsHit.push(fragment);
      if (match.startedAt > entry.lastMatchAt) entry.lastMatchAt = match.startedAt;
      entry.matches.push({
        fragment,
        traceRowId: match.traceRowId,
        startedAt: match.startedAt,
        status: match.status,
        matchedIn: match.matchedIn,
        snippet: match.snippet,
      });
    }
    return {
      fragment,
      scanned: result.scanned,
      skipped: result.skipped,
      scanStopped: result.scanStopped ?? null,
      matches: (result.matches ?? []).length,
    };
  });
  const conversations = [...byConversation.values()].sort((a, b) => (
    b.fragmentsHit.length - a.fragmentsHit.length || (a.lastMatchAt < b.lastMatchAt ? 1 : a.lastMatchAt > b.lastMatchAt ? -1 : 0)
  ));
  conversations.forEach((entry, index) => {
    // Equal fragment counts are ordered by recency only; the caller must not treat the first as the winner.
    entry.tiedWithNext = conversations[index + 1]?.fragmentsHit.length === entry.fragmentsHit.length;
  });
  for (const entry of conversations) {
    entry.matches.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.fragment - b.fragment));
  }
  return {
    fragments: results.length,
    // A cut scan may hide matches: the ranking is then incomplete.
    complete: searches.every((s) => s.scanStopped === null),
    searches,
    conversations,
  };
}

/** Trace row id of a bot step, read from its «Трейс ходу» section; null when the step has none. */
export function traceRowIdOf(step) {
  const section = (step?.sections ?? []).find((s) => s?.title === TRACE_SECTION_TITLE);
  const row = section?.rows?.find((r) => r?.key === TRACE_ROW_KEY);
  const match = typeof row?.value === 'string' ? row.value.match(UUID_IN_TEXT) : null;
  return match ? match[0].toLowerCase() : null;
}

function exportTest(report) {
  const test = report?.suite?.tests?.[0];
  if (!test || !Array.isArray(test.steps)) throw new Error('the export is not a trace export report (no steps)');
  return test;
}

/**
 * One entry per traced turn of a conversation export: the employee message, the bot reply and the trace row id
 * the extract command takes. Steps come in employee/bot pairs, oldest first.
 */
export function conversationIndex(report) {
  const test = exportTest(report);
  const turns = [];
  for (let i = 0; i < test.steps.length; i += 1) {
    const step = test.steps[i];
    if (step?.role !== 'bot') continue;
    const previous = test.steps[i - 1];
    const status = (step.sections ?? []).find((s) => s?.title === TRACE_SECTION_TITLE)?.summary?.split(' ')[0] ?? null;
    turns.push({
      step: turns.length + 1,
      traceRowId: traceRowIdOf(step),
      status,
      employee: previous?.role === 'user' ? previous.text : null,
      bot: step.text,
      missing: Boolean(step.missing),
    });
  }
  return turns;
}

const clip = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}… [cut; full value in the report JSON]` : text;
};

/** The «деталі» of the bot step with `traceRowId`: sections and side-effect badges, long values cut. Null when absent. */
export function turnDetail(report, traceRowId) {
  const test = exportTest(report);
  const wanted = traceRowId.toLowerCase();
  const index = test.steps.findIndex((step) => step?.role === 'bot' && traceRowIdOf(step) === wanted);
  if (index < 0) return null;
  const step = test.steps[index];
  return {
    traceRowId: wanted,
    step: test.steps.slice(0, index + 1).filter((s) => s?.role === 'bot').length,
    employee: test.steps[index - 1]?.role === 'user' ? test.steps[index - 1].text : null,
    bot: step.text,
    badges: (step.badges ?? []).map((b) => ({ icon: b.icon, label: b.label, tone: b.tone ?? null, details: b.details ?? [] })),
    sections: (step.sections ?? []).map((s) => ({
      title: s.title,
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.empty && !(s.rows ?? []).length ? { empty: s.empty } : {}),
      rows: (s.rows ?? []).map((r) => ({ key: r.key, value: clip(r.value), ...(r.tone ? { tone: r.tone } : {}) })),
    })),
  };
}
