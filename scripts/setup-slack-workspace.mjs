#!/usr/bin/env node
/**
 * Inserts a Slack workspace_connections row with encrypted credentials.
 *
 * Usage:
 *   node scripts/setup-slack-workspace.mjs \
 *     --team-id T0123456789 \
 *     --bot-token xoxb-... \
 *     --signing-secret abc123...
 *
 * Reads DATABASE_URL and FIELD_ENCRYPTION_KEY from .env (via dotenv).
 * TENANT_ID is read from .env or overridden with --tenant-id.
 */

import { createCipheriv, randomBytes } from 'crypto';
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// --- minimal dotenv loader ---
function loadDotenv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env file — rely on environment */ }
}

// --- AES-256-GCM encrypt (mirrors packages/crypto-utils/src/aes-gcm.ts) ---
function encryptField(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex chars');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// --- arg parser ---
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    teamId: get('--team-id'),
    botToken: get('--bot-token'),
    signingSecret: get('--signing-secret'),
    tenantId: get('--tenant-id'),
  };
}

async function main() {
  loadDotenv();

  const { teamId, botToken, signingSecret, tenantId: tenantIdArg } = parseArgs();

  const missing = [];
  if (!teamId) missing.push('--team-id');
  if (!botToken) missing.push('--bot-token');
  if (!signingSecret) missing.push('--signing-secret');
  if (missing.length) {
    console.error('Missing required args:', missing.join(', '));
    console.error('Run: node scripts/setup-slack-workspace.mjs --team-id T... --bot-token xoxb-... --signing-secret ...');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const encKey = process.env.FIELD_ENCRYPTION_KEY;
  const tenantId = tenantIdArg ?? process.env.TENANT_ID;

  if (!databaseUrl) { console.error('DATABASE_URL not set'); process.exit(1); }
  if (!encKey) { console.error('FIELD_ENCRYPTION_KEY not set'); process.exit(1); }
  if (!tenantId) { console.error('TENANT_ID not set (pass --tenant-id or set in .env)'); process.exit(1); }

  const encrypted = encryptField(
    JSON.stringify({ botToken, signingSecret }),
    encKey,
  );

  const sql = postgres(databaseUrl);

  try {
    const [row] = await sql`
      INSERT INTO workspace_connections
        (tenant_id, channel_type, external_workspace_id, encrypted_credentials, status, scopes)
      VALUES
        (${tenantId}, 'slack', ${teamId}, ${encrypted}, 'active', '["chat:write","im:read","im:history","users:read"]'::jsonb)
      ON CONFLICT (channel_type, external_workspace_id)
        DO UPDATE SET
          encrypted_credentials = EXCLUDED.encrypted_credentials,
          status = 'active',
          last_validated_at = now()
      RETURNING id, external_workspace_id, status
    `;

    console.log('✓ workspace_connections row upserted:');
    console.log(' ', row);
  } finally {
    await sql.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
