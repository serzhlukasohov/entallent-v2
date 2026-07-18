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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Polling ─────────────────────────────────────────────────────────────────

interface Message { id: string; direction: string; text: string; occurredAt: string }

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

function printBanner() {
  console.log(`
${CYAN}${BOLD}╔════════════════════════════════════════╗
║     enTalent AI Mentor — Dev Chat     ║
╚════════════════════════════════════════╝${RESET}
${DIM}User: ${USER_NAME} (${USER_ID})
Tenant: ${TENANT_ID}
${RESET}
Commands:
  ${BOLD}/memory${RESET}    — show what AI remembers about you
  ${BOLD}/survey${RESET}    — show survey assessment state
  ${BOLD}/actions${RESET}   — show scheduled follow-ups
  ${BOLD}/checkin${RESET}   — trigger a proactive check-in (mentor writes first)
  ${BOLD}/quit${RESET}      — exit

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
