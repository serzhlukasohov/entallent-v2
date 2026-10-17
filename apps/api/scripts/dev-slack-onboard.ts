/**
 * LOCAL DEV ONLY: put one real Slack user through onboarding v2 without the
 * Company Setup UI. Connects the Slack workspace from .env, ensures a work
 * calendar, links the Slack user to a person with the given role, resets their
 * onboarding and queues the real intro dispatch.
 *
 *   pnpm --filter @entalent/api exec tsx scripts/dev-slack-onboard.ts --email you@x.com --role employee [--fresh]
 *
 * --fresh also wipes the person's conversation history, memory, goals, risk and
 * pulse data through the existing dev reset endpoint (API must be running).
 */
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { createDbClient } from '@entalent/database';
import { QUEUE_NAMES } from '@entalent/contracts';
import { encryptField } from '@entalent/crypto-utils';

const ROLES = ['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership'] as const;

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function slackUserByEmail(botToken: string, email: string) {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const body = await res.json() as { ok: boolean; error?: string; user?: { id: string; tz?: string; profile?: { real_name?: string } } };
  if (!body.ok || !body.user) throw new Error(`slack lookup failed: ${body.error ?? 'unknown'}`);
  return { id: body.user.id, tz: body.user.tz ?? null, name: body.user.profile?.real_name ?? email };
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') throw new Error('dev only');
  const email = arg('email')?.trim().toLowerCase();
  const role = arg('role') as (typeof ROLES)[number] | undefined;
  if (!email || !role || !ROLES.includes(role)) {
    throw new Error(`usage: --email <slack email> --role <${ROLES.join('|')}>`);
  }
  const tenantId = env('DEFAULT_TENANT_ID');
  const teamId = env('SLACK_TEAM_ID');
  const botToken = env('SLACK_BOT_TOKEN');
  const signingSecret = env('SLACK_SIGNING_SECRET');
  const slackUser = await slackUserByEmail(botToken, email);
  const pulse = role === 'employee' || role === 'team_lead';
  const db = createDbClient(env('DATABASE_URL'));

  try {
    const result = await db.sql.begin(async (tx) => {
      const credentials = encryptField(JSON.stringify({ botToken, signingSecret }), env('FIELD_ENCRYPTION_KEY'));
      await tx`INSERT INTO workspace_connections (tenant_id, channel_type, external_workspace_id, encrypted_credentials, status, scopes)
        VALUES (${tenantId}, 'slack', ${teamId}, ${credentials}, 'active', ${JSON.stringify(['chat:write', 'im:write', 'im:history', 'users:read', 'users:read.email'])}::jsonb)
        ON CONFLICT (channel_type, external_workspace_id)
        DO UPDATE SET encrypted_credentials = EXCLUDED.encrypted_credentials, status = 'active', tenant_id = EXCLUDED.tenant_id`;

      const [calendar] = await tx`SELECT tenant_id FROM tenant_work_calendars WHERE tenant_id = ${tenantId}`;
      if (!calendar) {
        await tx`INSERT INTO tenant_work_calendars (tenant_id, timezone, working_days, work_start, work_end, updated_by)
          VALUES (${tenantId}, 'Europe/Kyiv', '{1,2,3,4,5}', '09:00', '18:00', 'dev-slack-onboard')`;
      }

      const [account] = await tx`SELECT user_id FROM channel_accounts
        WHERE channel_type = 'slack' AND external_workspace_id = ${teamId} AND external_user_id = ${slackUser.id}`;
      const userId: string = account?.user_id ?? randomUUID();
      if (!account) {
        await tx`INSERT INTO users (id, tenant_id, status, preferred_name, timezone, proactive_messaging_enabled)
          VALUES (${userId}, ${tenantId}, 'active', ${slackUser.name}, ${slackUser.tz}, false)`;
        await tx`INSERT INTO channel_accounts (user_id, tenant_id, channel_type, external_workspace_id, external_user_id, link_status, display_name)
          VALUES (${userId}, ${tenantId}, 'slack', ${teamId}, ${slackUser.id}, 'linked', ${slackUser.name})`;
      } else {
        await tx`UPDATE users SET status = 'active', deleted_at = NULL, timezone = COALESCE(${slackUser.tz}, timezone)
          WHERE id = ${userId}`;
      }

      await tx`INSERT INTO people (id, tenant_id, customer_employee_id, work_email, display_name, primary_role, pulse_participant, lifecycle_status)
        VALUES (${userId}, ${tenantId}, ${`dev-${slackUser.id}`}, ${email}, ${slackUser.name}, ${role}, ${pulse}, 'active')
        ON CONFLICT (id) DO UPDATE SET primary_role = EXCLUDED.primary_role,
          pulse_participant = EXCLUDED.pulse_participant, lifecycle_status = 'active', updated_at = now()`;

      const [unit] = await tx`INSERT INTO org_units (tenant_id, customer_unit_key, name)
        VALUES (${tenantId}, 'dev-slack-unit', 'Dev Slack Unit')
        ON CONFLICT (tenant_id, customer_unit_key) DO UPDATE SET name = EXCLUDED.name
        RETURNING id`;

      // Reset: fresh onboarding for this person. Version is seeded from the clock so
      // stable message ids never collide with an earlier run.
      await tx`DELETE FROM onboarding_states WHERE tenant_id = ${tenantId} AND person_id = ${userId}`;
      await tx`DELETE FROM org_onboarding_deliveries WHERE tenant_id = ${tenantId} AND person_id = ${userId}`;
      const track = role === 'employee' ? 'employee' : role === 'team_lead' ? 'team_lead' : 'management';
      await tx`INSERT INTO onboarding_states (tenant_id, person_id, track, participation, version)
        VALUES (${tenantId}, ${userId}, ${track}, ${track === 'management' ? 'not_applicable' : 'undecided'},
          ${Math.floor(Date.now() / 1000)})`;
      await tx`INSERT INTO org_onboarding_deliveries (tenant_id, person_id, unit_id, external_workspace_id)
        VALUES (${tenantId}, ${userId}, ${unit!.id}, ${teamId})`;
      return { userId, unitId: unit!.id as string };
    });

    if (process.argv.includes('--fresh')) {
      const res = await fetch('http://localhost:3000/api/v1/dev/reset-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
          ...(process.env['ADMIN_API_KEY'] ? { 'X-Api-Key': process.env['ADMIN_API_KEY'] } : {}) },
        body: JSON.stringify({ userId: result.userId, tenantId, deep: true }),
      });
      if (!res.ok) throw new Error(`dev reset failed: ${res.status} ${await res.text()}`);
    }

    const url = new URL(env('REDIS_URL'));
    const queue = new Queue(QUEUE_NAMES.PROACTIVE_SCAN, { connection: {
      host: url.hostname, port: Number(url.port) || 6379, db: Number(url.pathname.slice(1) || '0'),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    } });
    try {
      await queue.add('onboarding-only', { tenantId, unitId: result.unitId }, {
        jobId: `dev-onboarding-${randomUUID()}`, attempts: 1,
      });
    } finally {
      await queue.close();
    }
    process.stdout.write(`${JSON.stringify({ queued: true, email, role, slackUserId: slackUser.id, personId: result.userId })}\n`);
  } finally {
    await db.sql.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
