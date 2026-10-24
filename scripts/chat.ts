#!/usr/bin/env tsx
/**
 * Interactive dev chat — simulates a conversation with the AI mentor.
 *
 * Usage:
 *   pnpm chat
 *   pnpm chat --user bob --name "Bob Smith"
 *   pnpm chat --help
 *
 * Requires:
 *   - API running on localhost:3000 (pnpm dev)
 *   - DEFAULT_TENANT_ID in .env (from pnpm db:seed)
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const API = 'http://localhost:3000/api/v1';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  return Object.fromEntries(
    fs.readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.includes('=') && !l.startsWith('#'))
      .map(l => {
        const [k, ...rest] = l.split('=');
        return [k!.trim(), rest.join('=').trim()];
      }),
  );
}

const env = loadEnv();

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

if (args.includes('--help')) {
  console.log(`
Usage: pnpm chat [options]

Options:
  --user <id>      External user ID (default: dev-alice)
  --name <name>    Display name (default: Alice)
  --tenant <uuid>  Tenant ID (default: DEFAULT_TENANT_ID from .env)
  --help           Show this help
`);
  process.exit(0);
}

const TENANT_ID = getArg('--tenant', env['DEFAULT_TENANT_ID'] ?? '');
const USER_ID   = getArg('--user', 'dev-alice');
const USER_NAME = getArg('--name', 'Alice');

if (!TENANT_ID) {
  console.error('❌  No tenant ID. Run pnpm db:seed and add DEFAULT_TENANT_ID=... to .env');
  process.exit(1);
}

// ── API helpers ─────────────────────────────────────────────────────────────

const API_KEY_HEADERS: Record<string, string> = env['ADMIN_API_KEY'] ? { 'X-Api-Key': env['ADMIN_API_KEY'] } : {};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API_KEY_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: API_KEY_HEADERS });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Polling ─────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  direction: string;
  text: string;
  occurredAt: string;
  messageType?: string;
  sentAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

async function waitForReply(
  conversationId: string,
  afterMessageId: string | undefined,
): Promise<Message | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  process.stdout.write('\n  ⏳ thinking');

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    process.stdout.write('.');

    const qs = afterMessageId ? `?after=${afterMessageId}` : '';
    const msgs = await get<Message[]>(
      `/dev/conversation/${conversationId}/messages${qs}`,
    );
    const reply = msgs.find(m => m.direction === 'outbound');
    if (reply) {
      process.stdout.write('\n');
      return reply;
    }
  }

  process.stdout.write('\n  ⚠️  Timeout — check worker logs\n');
  return null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Display helpers ──────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const RED    = '\x1b[31m';

const HELP_TEXT = `Commands:
  ${BOLD}/memory${RESET}               — show what AI remembers about you
  ${BOLD}/survey${RESET}               — show survey assessment state
  ${BOLD}/actions${RESET}              — show scheduled follow-ups
  ${BOLD}/checkin${RESET}              — trigger a proactive check-in (mentor writes first)
  ${BOLD}/onboard <role>${RESET}       — onboarding v2: reset and send the intro (employee|team_lead|manager|hr|hrbp|leadership)
  ${BOLD}/click <action>${RESET}       — press an intro button (start|later|decline|got_it)
  ${BOLD}/remind-now${RESET}           — fire the scheduled onboarding reminder now
  ${BOLD}/role <role>${RESET}          — change the person's role (role_changed event)
  ${BOLD}/state${RESET}                — show the onboarding state
  ${BOLD}/help${RESET}                 — show this list
  ${BOLD}/quit${RESET}                 — exit
`;

function printBanner() {
  console.log(`
${CYAN}${BOLD}╔════════════════════════════════════════╗
║     enTalent AI Mentor — Dev Chat     ║
╚════════════════════════════════════════╝${RESET}
${DIM}User: ${USER_NAME} (${USER_ID})
Tenant: ${TENANT_ID}
${RESET}
${HELP_TEXT}
Type your message and press Enter.
${DIM}─────────────────────────────────────────${RESET}
`);
}

function printUser(text: string) {
  console.log(`\n${BLUE}${BOLD}You${RESET}: ${text}`);
}

function printAI(text: string) {
  console.log(`\n${GREEN}${BOLD}Mentor${RESET}: ${text}\n`);
}

interface MemoryItem {
  category: string;
  canonicalKey?: string;
  content: string;
  confidence: string | number;
  importance: string | number;
}

async function showMemory(userId: string) {
  const data = await get<{ count: number; items: MemoryItem[] }>(`/dev/user/${userId}/memory`);
  if (data.count === 0) {
    console.log(`\n${DIM}  (no memory items yet)${RESET}\n`);
    return;
  }
  console.log(`\n${YELLOW}${BOLD}Memory (${data.count} items):${RESET}`);
  for (const item of data.items) {
    const conf = typeof item.confidence === 'string'
      ? parseFloat(item.confidence)
      : item.confidence;
    const bar = '█'.repeat(Math.round(conf * 10)).padEnd(10, '░');
    console.log(
      `  ${DIM}[${item.category}]${RESET} ${item.content}` +
      `\n    ${DIM}confidence: ${bar} ${(conf * 100).toFixed(0)}%${RESET}`,
    );
  }
  console.log();
}

interface Assessment { status: string; questionId: string; updatedAt: string }

async function showSurveyState(userId: string) {
  const data = await get<{ count: number; assessments: Assessment[] }>(`/dev/user/${userId}/survey-state`);
  if (data.count === 0) {
    console.log(`\n${DIM}  (no survey assessments yet)${RESET}\n`);
    return;
  }
  console.log(`\n${YELLOW}${BOLD}Survey assessments (${data.count}):${RESET}`);
  for (const a of data.assessments) {
    const icon = a.status === 'scored' ? '✅' : a.status === 'partially_covered' ? '🔶' : '⬜';
    console.log(`  ${icon} ${a.questionId} — ${BOLD}${a.status}${RESET}`);
  }
  console.log();
}

interface ScheduledAction { type: string; intent: string; status: string; dueAt: string }

async function showActions(userId: string) {
  const data = await get<{ count: number; actions: ScheduledAction[] }>(`/dev/user/${userId}/scheduled-actions`);
  if (data.count === 0) {
    console.log(`\n${DIM}  (no scheduled follow-ups yet)${RESET}\n`);
    return;
  }
  console.log(`\n${YELLOW}${BOLD}Scheduled actions (${data.count}):${RESET}`);
  for (const a of data.actions) {
    const due = new Date(a.dueAt).toLocaleString();
    const icon = a.status === 'pending' ? '⏰' : a.status === 'sent' ? '✅' : '❌';
    console.log(`  ${icon} ${a.type} — ${a.intent} (${a.status}, due: ${due})`);
  }
  console.log();
}

// ── Onboarding v2 dev console ───────────────────────────────────────────────

interface OnboardingStateView {
  personId: string;
  proactiveMessagingEnabled: boolean | null;
  state: null | {
    track: string; introStatus: string; participation: string; reminderStatus: string;
    reminderDueAt: string | null; buttonsActive: boolean; version: number;
  };
}

interface DevApiError extends Error { status?: number }

async function devPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API_KEY_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err: DevApiError = new Error(`${res.status}: ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Outbound messages already shown, so polling prints only what the worker delivered since. */
const seenOutbound = new Set<string>();

function buttonsOf(m: Message): string[] {
  const actions = m.metadata?.['onboardingActions'];
  return Array.isArray(actions)
    ? actions.map((a) => (a && typeof a === 'object' ? String((a as { label?: unknown }).label ?? '') : '')).filter(Boolean)
    : [];
}

function printOutbound(m: Message) {
  printAI(m.text);
  const buttons = buttonsOf(m);
  if (buttons.length) console.log(`  ${YELLOW}${buttons.map((b) => `[${b}]`).join(' ')}${RESET}\n`);
}

async function markAllSeen(conversationId: string) {
  const all = await get<Message[]>(`/dev/conversation/${conversationId}/messages`);
  for (const m of all) if (m.direction === 'outbound' && m.sentAt) seenOutbound.add(m.id);
}

/** Prints newly delivered outbound messages until `done` holds, or after `quietMs` without new ones, or timeout. */
async function pollOutbound(conversationId: string, opts: {
  timeoutMs: number; quietMs?: number; done?: (printed: Message[]) => boolean;
}): Promise<Message[]> {
  const printed: Message[] = [];
  const deadline = Date.now() + opts.timeoutMs;
  let lastNew = Date.now();
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const all = await get<Message[]>(`/dev/conversation/${conversationId}/messages`);
    for (const m of all) {
      if (m.direction !== 'outbound' || !m.sentAt || seenOutbound.has(m.id)) continue;
      seenOutbound.add(m.id);
      printed.push(m);
      printOutbound(m);
      lastNew = Date.now();
    }
    if (opts.done?.(printed)) break;
    if (opts.quietMs !== undefined && printed.length > 0 && Date.now() - lastNew >= opts.quietMs) break;
  }
  return printed;
}

async function fetchOnboardingState(): Promise<OnboardingStateView> {
  return get<OnboardingStateView>(`/dev/onboarding/state/${encodeURIComponent(USER_ID)}?tenantId=${TENANT_ID}`);
}

function printStateLine(view: OnboardingStateView) {
  const s = view.state;
  if (!s) {
    console.log(`${DIM}  state: (no onboarding state)  proactive=${view.proactiveMessagingEnabled}${RESET}\n`);
    return;
  }
  const due = s.reminderDueAt ? ` due=${new Date(s.reminderDueAt).toLocaleString()}` : '';
  console.log(`${DIM}  state: track=${s.track} intro=${s.introStatus} participation=${s.participation} ` +
    `reminder=${s.reminderStatus}${due} buttons=${s.buttonsActive ? 'active' : 'inactive'} ` +
    `proactive=${view.proactiveMessagingEnabled} v=${s.version}${RESET}\n`);
}

async function waitForStateChange(before: OnboardingStateView, timeoutMs: number): Promise<OnboardingStateView> {
  const deadline = Date.now() + timeoutMs;
  let current = before;
  while (Date.now() < deadline) {
    current = await fetchOnboardingState();
    if (current.state?.version !== before.state?.version) return current;
    await sleep(POLL_INTERVAL_MS);
  }
  return current;
}

const ONBOARD_ROLES = ['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership'];
const CLICK_ACTIONS = ['start', 'later', 'decline', 'got_it'];

async function onboard(conversationId: string, role: string | undefined) {
  if (!role || !ONBOARD_ROLES.includes(role)) {
    console.log(`\n${RED}Usage: /onboard <${ONBOARD_ROLES.join('|')}>${RESET}\n`);
    return;
  }
  await markAllSeen(conversationId);
  const res = await devPost<{ personId: string; calendarCreated: boolean; calendar: Record<string, unknown> | null }>(
    '/dev/onboarding/start', { tenantId: TENANT_ID, userId: USER_ID, userName: USER_NAME, role },
  );
  if (res.calendarCreated) {
    console.log(`\n${YELLOW}  Created dev work calendar: ${JSON.stringify(res.calendar)}${RESET}`);
  }
  console.log(`${DIM}  onboarding reset; intro queued for role=${role} (person ${res.personId})${RESET}`);
  const printed = await pollOutbound(conversationId, {
    timeoutMs: 15_000,
    done: (msgs) => msgs.some((m) => m.metadata?.['onboardingIntroPart'] === 'trust'),
  });
  if (!printed.length) console.log(`\n  ${RED}No intro delivered — is the worker running? Check its log.${RESET}\n`);
  printStateLine(await fetchOnboardingState());
}

async function click(conversationId: string, action: string | undefined) {
  if (!action || !CLICK_ACTIONS.includes(action)) {
    console.log(`\n${RED}Usage: /click <${CLICK_ACTIONS.join('|')}>${RESET}\n`);
    return;
  }
  await markAllSeen(conversationId);
  const before = await fetchOnboardingState();
  try {
    await devPost('/dev/onboarding/click', { tenantId: TENANT_ID, userId: USER_ID, action });
  } catch (err) {
    if ((err as DevApiError).status === 409) {
      console.log(`\n${RED}  Buttons not delivered yet — run /onboard first.${RESET}\n`);
      return;
    }
    throw err;
  }
  console.log(`\n${DIM}  clicked [${action}]${RESET}`);
  const after = await waitForStateChange(before, 8_000);
  // "start" kicks off the model-generated first conversation turn; give it time.
  await pollOutbound(conversationId, { timeoutMs: action === 'start' ? 30_000 : 4_000, quietMs: 1_500 });
  if (before.state?.buttonsActive && after.state && !after.state.buttonsActive) {
    console.log(`${YELLOW}  buttons replaced: intro buttons removed (worker log: [DEV BUTTONS REPLACED] <text>)${RESET}`);
  }
  if (after.state?.version === before.state?.version) console.log(`${DIM}  (no state change — stale or no-op click)${RESET}`);
  printStateLine(await fetchOnboardingState());
}

async function remindNow(conversationId: string) {
  await markAllSeen(conversationId);
  try {
    const res = await devPost<{ dueAt: string }>('/dev/onboarding/remind-now', { tenantId: TENANT_ID, userId: USER_ID });
    console.log(`\n${DIM}  reminder re-queued for ${res.dueAt} (postponed if outside work hours or you wrote <30 min ago)${RESET}`);
  } catch (err) {
    if ((err as DevApiError).status === 409) {
      console.log(`\n${RED}  No scheduled reminder: ${(err as Error).message}${RESET}\n`);
      return;
    }
    throw err;
  }
  await pollOutbound(conversationId, { timeoutMs: 8_000, quietMs: 1_000 });
  printStateLine(await fetchOnboardingState());
}

async function changeRole(conversationId: string, role: string | undefined) {
  if (!role || !ONBOARD_ROLES.includes(role)) {
    console.log(`\n${RED}Usage: /role <${ONBOARD_ROLES.join('|')}>${RESET}\n`);
    return;
  }
  await markAllSeen(conversationId);
  const before = await fetchOnboardingState();
  try {
    const res = await devPost<{ from: string; to: string }>('/dev/onboarding/role', { tenantId: TENANT_ID, userId: USER_ID, role });
    console.log(`\n${DIM}  role ${res.from} → ${res.to}${RESET}`);
  } catch (err) {
    if ((err as DevApiError).status === 409) {
      console.log(`\n${RED}  ${(err as Error).message}${RESET}\n`);
      return;
    }
    throw err;
  }
  await waitForStateChange(before, 8_000);
  await pollOutbound(conversationId, { timeoutMs: 6_000, quietMs: 1_500 });
  printStateLine(await fetchOnboardingState());
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  // Verify API is reachable
  try {
    await get('/health');
  } catch {
    console.error(`${RED}❌  Cannot reach API at ${API}${RESET}`);
    console.error('   Make sure you ran: pnpm dev');
    process.exit(1);
  }

  printBanner();

  // Find or create user + conversation without triggering the worker
  const boot = await get<{ conversationId: string; userId: string }>(
    `/dev/find-conversation?tenantId=${TENANT_ID}&userId=${USER_ID}&userName=${encodeURIComponent(USER_NAME)}`,
  );

  const { conversationId, userId } = boot;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let lastInboundId: string | undefined;

  const ask = () => {
    rl.question(`${BLUE}${BOLD}You${RESET}: `, async (input) => {
      const text = input.trim();
      if (!text) { ask(); return; }

      if (text === '/quit' || text === '/exit') {
        console.log(`\n${DIM}Goodbye.${RESET}\n`);
        rl.close();
        process.exit(0);
      }

      if (text === '/memory') {
        await showMemory(userId);
        ask();
        return;
      }

      if (text === '/survey') {
        await showSurveyState(userId);
        ask();
        return;
      }

      if (text === '/actions') {
        await showActions(userId);
        ask();
        return;
      }

      if (text === '/help') {
        console.log(`\n${HELP_TEXT}`);
        ask();
        return;
      }

      const [command, arg] = text.split(/\s+/);
      if (command && ['/onboard', '/click', '/remind-now', '/role', '/state'].includes(command)) {
        try {
          if (command === '/onboard') await onboard(conversationId, arg);
          else if (command === '/click') await click(conversationId, arg);
          else if (command === '/remind-now') await remindNow(conversationId);
          else if (command === '/role') await changeRole(conversationId, arg);
          else printStateLine(await fetchOnboardingState());
        } catch (err) {
          console.error(`\n${RED}Error: ${(err as Error).message}${RESET}\n`);
        }
        ask();
        return;
      }

      if (text === '/checkin') {
        try {
          const all = await get<Message[]>(`/dev/conversation/${conversationId}/messages`);
          const lastId = all.length > 0 ? all[all.length - 1]!.id : lastInboundId;

          await post('/dev/simulate-checkin', {
            tenantId: TENANT_ID, userId: USER_ID, userName: USER_NAME,
          });

          const reply = await waitForReply(conversationId, lastId);
          if (reply) printAI(reply.text);
        } catch (err) {
          console.error(`\n${RED}Error: ${(err as Error).message}${RESET}\n`);
        }
        ask();
        return;
      }

      try {
        const result = await post<{ messageId: string }>(
          '/dev/simulate-message',
          { tenantId: TENANT_ID, userId: USER_ID, userName: USER_NAME, text },
        );

        const reply = await waitForReply(conversationId, result.messageId);
        if (reply) {
          printAI(reply.text);
          lastInboundId = result.messageId;
        }
      } catch (err) {
        console.error(`\n${RED}Error: ${(err as Error).message}${RESET}\n`);
      }

      ask();
    });
  };

  ask();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
