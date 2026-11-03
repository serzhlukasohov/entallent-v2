#!/usr/bin/env node
// Finds a traced turn by message text, exports a traced conversation and renders it as the sim report page, or turns
// one traced turn into a sim precondition plus a QA test draft (test tenants only).
//
//   pnpm trace:export -- --tenant <uuid> --search "<text fragment>" [--search "<another>" ...] [--days 7] [--limit 20]
//   pnpm trace:export -- --tenant <uuid> --conversation <uuid> [--turn <trace row id>] [--turns 100] [--out <file.json>] [--no-html]
//   pnpm trace:export -- --tenant <uuid> --extract <trace row id> [--force]
//
// --tenant falls back to TRACE_TENANT_ID. --json prints one JSON document on stdout instead of text (human
// messages and the HTML renderer go to stderr); the QA screenshot skill (.claude/skills/qa-screenshot-to-test)
// reads it. Up to 5 --search fragments are searched one by one and grouped by conversation, the conversation hit
// by most fragments first. With --json, --conversation prints an index of the turns (trace row ids, texts) and
// --turn adds the details of one turn.
//
// --extract writes packages/conversation-sim/preconditions/traced/trace-<id>.json and
// packages/conversation-sim/qa-tests/drafts/trace-<id>.json. The API refuses unless the tenant carries the
// `conversation_trace_test_tenant` feature flag: only test-tenant conversations may become repository fixtures.
// The draft has no expected results; QA fills them in and moves it up into qa-tests/ to make it a test.
//
// Env: TRACE_API_BASE (e.g. http://localhost:3000/api/v1) and ADMIN_API_KEY, read from .env by the pnpm script.
// The API must run with CONVERSATION_TRACE_ADMIN_ENABLED=true. Exports hold conversation text: they are written
// under runs/trace-exports/ (gitignored) by default and must never be committed. The search fragment is sent in the
// request body, but as a command-line argument it stays in your shell history: search with a short, neutral fragment.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conversationIndex, groupSearchResults, turnDetail } from './trace-export-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usage(message) {
  if (message) console.error(message);
  console.error('usage: pnpm trace:export -- [--tenant <uuid>] [--json] (--search "<text>" [--search "<text>" ...] [--days N] [--limit N] | --conversation <uuid> [--turn <trace row uuid>] [--turns N] [--out file.json] [--no-html] | --extract <trace row uuid> [--force])');
  process.exit(1);
}

// pnpm passes a literal `--` through to the script.
const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const VALUE_FLAGS = new Set(['tenant', 'search', 'days', 'limit', 'conversation', 'turns', 'out', 'extract', 'turn']);
const MAX_FRAGMENTS = 5;
const args = { search: [] };
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) usage(`unexpected argument ${argv[i]}`);
  const key = argv[i].slice(2);
  if (key === 'no-html') { args.noHtml = true; continue; }
  if (key === 'force') { args.force = true; continue; }
  if (key === 'json') { args.json = true; continue; }
  if (!VALUE_FLAGS.has(key)) usage(`unknown flag --${key}`);
  if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) usage(`missing value for --${key}`);
  if (key === 'search') args.search.push(argv[i + 1]);
  else if (args[key] !== undefined) usage(`--${key} given twice`);
  else args[key] = argv[i + 1];
  i += 1;
}
if (args.search.length > MAX_FRAGMENTS) usage(`at most ${MAX_FRAGMENTS} --search fragments`);
args.tenant ??= process.env.TRACE_TENANT_ID?.trim() || undefined;
for (const key of ['days', 'limit', 'turns']) {
  if (args[key] !== undefined && !/^\d+$/.test(args[key])) usage(`--${key} must be a positive integer`);
}

const base = process.env.TRACE_API_BASE?.replace(/\/+$/, '');
const apiKey = process.env.ADMIN_API_KEY;
if (!base) usage('TRACE_API_BASE is not set (e.g. http://localhost:3000/api/v1)');
let baseUrl;
try { baseUrl = new URL(base); } catch { usage('TRACE_API_BASE is not a URL'); }
// The admin key and decrypted conversations must not cross a network in clear text.
if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) {
  usage('TRACE_API_BASE must use https unless it points at localhost');
}
if (!apiKey) console.warn('trace:export: ADMIN_API_KEY is not set; only an API without a key (local dev) will answer.');
if (!args.tenant) usage('--tenant <uuid> (or TRACE_TENANT_ID) is required');
if (!UUID.test(args.tenant)) usage('--tenant / TRACE_TENANT_ID is not a uuid');
if ([args.search.length > 0, args.conversation, args.extract].filter(Boolean).length !== 1) {
  usage('pass exactly one of --search, --conversation or --extract');
}
if (args.turn && (!args.conversation || !args.json)) usage('--turn needs --conversation and --json');
if (args.turn && !UUID.test(args.turn)) usage('--turn must be a trace row uuid');

// In --json mode stdout carries exactly one JSON document; everything meant for a person goes to stderr.
const say = args.json ? (...parts) => console.error(...parts) : (...parts) => console.log(...parts);
const emit = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const headers = { accept: 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) };

async function call(path, init = {}) {
  let response;
  let body;
  try {
    // A redirect would forward x-api-key (and the search body) to another origin, past the https check above.
    response = await fetch(`${base}${path}`, { ...init, redirect: 'error', headers: { ...headers, ...(init.headers ?? {}) } });
    body = await response.text();
  } catch (error) {
    console.error(`trace:export: cannot reach ${baseUrl.origin}: ${error?.cause?.code ?? error?.message ?? error}`);
    process.exit(2);
  }
  if (!response.ok) {
    // The API answers with fixed messages; the body is printed as-is for the operator.
    console.error(`trace:export: ${init.method ?? 'GET'} ${path.split('?')[0]} -> ${response.status} ${body.slice(0, 300)}`);
    process.exit(2);
  }
  try {
    return JSON.parse(body);
  } catch {
    console.error(`trace:export: ${path.split('?')[0]} answered ${response.status} without JSON`);
    process.exit(2);
  }
}

const tenantQuery = `tenantId=${encodeURIComponent(args.tenant)}`;

if (args.search.length) {
  const results = [];
  for (const text of args.search) {
    // The fragment goes in the body, never in the URL.
    results.push(await call(`/admin/conversation-traces/search?${tenantQuery}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(args.days ? { days: Number(args.days) } : {}),
        ...(args.limit ? { limit: Number(args.limit) } : {}),
      }),
    }));
  }
  if (args.json) {
    emit(results.length === 1 ? results[0] : groupSearchResults(results));
  } else if (results.length === 1) {
    const [result] = results;
    console.log(`scanned ${result.scanned} trace(s) in the last ${result.window.days} day(s)`
      + `${result.skipped ? `, ${result.skipped} unreadable` : ''}${result.scanStopped ? `, stopped by ${result.scanStopped}` : ''}`);
    for (const match of result.matches) {
      console.log(`${match.startedAt}  trace ${match.traceRowId}  conversation ${match.conversationId}  [${match.matchedIn}] ${match.snippet}`);
    }
    if (!result.matches.length) console.log('no matches');
  } else {
    const grouped = groupSearchResults(results);
    for (const s of grouped.searches) {
      console.log(`fragment ${s.fragment}: scanned ${s.scanned}, ${s.matches} match(es)${s.scanStopped ? `, stopped by ${s.scanStopped}` : ''}`);
    }
    for (const c of grouped.conversations) {
      console.log(`conversation ${c.conversationId}  fragments ${c.fragmentsHit.join(',')} of ${grouped.fragments}  last ${c.lastMatchAt}`);
      for (const m of c.matches) console.log(`  ${m.startedAt}  trace ${m.traceRowId}  #${m.fragment} [${m.matchedIn}] ${m.snippet}`);
    }
    if (!grouped.conversations.length) console.log('no matches');
  }
} else if (args.extract) {
  if (!UUID.test(args.extract)) usage('--extract must be a trace row uuid (printed by --search)');
  const extraction = await call(`/admin/conversation-traces/turns/${args.extract}/precondition?${tenantQuery}`);
  // File names come from the row id, never from the response, and must stay inside the sim package folders.
  const name = `trace-${args.extract.toLowerCase().replace(/-/g, '').slice(0, 8)}`;
  if (extraction?.name !== name || extraction?.precondition?.origin?.kind !== 'trace'
    || extraction.precondition.origin.tenantId !== args.tenant || !Array.isArray(extraction?.testDraft?.replies)) {
    console.error('trace:export: the API answered with an unexpected extraction; nothing was written');
    process.exit(2);
  }
  const sim = join(root, 'packages', 'conversation-sim');
  const targets = [
    [join(sim, 'preconditions', 'traced', `${name}.json`), extraction.precondition],
    [join(sim, 'qa-tests', 'drafts', `${name}.json`), extraction.testDraft],
  ];
  const existing = targets.filter(([path]) => existsSync(path)).map(([path]) => path);
  if (existing.length && !args.force) {
    console.error(`trace:export: ${existing.join(', ')} already exist; pass --force to overwrite`);
    process.exit(2);
  }
  for (const [path, body] of targets) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    say(`written: ${path}`);
  }
  const gaps = Array.isArray(extraction.gaps) ? extraction.gaps.filter((gap) => typeof gap === 'string') : [];
  if (args.json) {
    emit({ name, preconditionPath: targets[0][0], draftPath: targets[1][0], gaps });
  } else {
    console.log(gaps.length ? `fidelity gaps (also in the precondition description):\n- ${gaps.join('\n- ')}` : 'no known fidelity gaps');
    console.log(`next: fill "expected" in qa-tests/drafts/${name}.json, then run pnpm sim:qa:promote qa-tests/drafts/${name}.json`);
  }
} else {
  if (!UUID.test(args.conversation)) usage('--conversation must be a uuid');
  const turns = args.turns ? `&limit=${encodeURIComponent(args.turns)}` : '';
  const report = await call(`/admin/conversation-traces/conversations/${args.conversation}/export?${tenantQuery}${turns}`);
  let index;
  let detail = null;
  if (args.json) {
    try {
      index = conversationIndex(report);
      if (args.turn) detail = turnDetail(report, args.turn);
    } catch (error) {
      console.error(`trace:export: ${error.message}`);
      process.exit(2);
    }
    if (args.turn && !detail) {
      console.error(`trace:export: no turn with trace row ${args.turn} in this export (older turns may be cut: raise --turns)`);
      process.exit(2);
    }
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const out = resolve(args.out ?? join(root, 'runs', 'trace-exports', `trace-${args.conversation.slice(0, 8)}-${stamp}.json`));
  if (!out.startsWith(join(root, 'runs') + sep) && out.startsWith(root + sep)) {
    console.warn(`trace:export: ${out} is inside the repository but outside runs/; never commit it, it holds conversation text.`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1));
  say(`report data written: ${out}`);
  let html = null;
  if (!args.noHtml) {
    const render = join(root, 'packages', 'conversation-sim', 'report', 'render-report.mjs');
    html = out.replace(/\.json$/, '') + '.html';
    // The renderer's own output goes to stderr in --json mode so stdout stays one JSON document.
    const status = spawnSync(process.execPath, [render, out, html], { stdio: ['ignore', args.json ? 2 : 'inherit', 'inherit'] }).status;
    if (status !== 0) process.exit(status ?? 1);
  }
  if (args.json) {
    emit({
      conversationId: args.conversation.toLowerCase(),
      reportJson: out,
      reportHtml: html,
      totalTurnsShown: index.length,
      turns: index,
      ...(detail ? { detail } : {}),
    });
  }
}
