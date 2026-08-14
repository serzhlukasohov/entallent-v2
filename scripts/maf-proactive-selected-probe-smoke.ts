import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { getDbClient } from '@entalent/database';

const QUEUE_POLL_TIMEOUT_MS = Number(process.env.MAF_SELECTED_PROBE_SMOKE_TIMEOUT_MS ?? 120_000);
const QUEUE_POLL_INTERVAL_MS = 1_000;
const EXTERNAL_WORKSPACE_ID = process.env.MAF_SELECTED_PROBE_SMOKE_WORKSPACE_ID ?? 'dev-workspace';

interface Evidence {
  status: 'valid' | 'invalid';
  validationStatus: 'passed' | 'failed';
  failureReason?: string;
  tenantId: string;
  userId?: string;
  conversationId?: string;
  traceId?: string;
  selectedProbeQuestionId?: string;
  selectedProbeStableKey?: string;
  requestLocale?: string;
  requestMetadataProbePresent?: boolean;
  backlogProbeQuestionId?: string;
  outboundContainsSurveyProbe?: boolean;
  outboundSurveyProbeQuestionId?: string;
  runtimeAttemptPhase?: string;
  runtimeAttemptFailureReason?: string | null;
}

async function main(): Promise<void> {
  const tenantId = process.env.TENANT_ID ?? process.env.DEFAULT_TENANT_ID;
  const redisUrl = process.env.REDIS_URL;
  if (!tenantId) {
    printEvidence({ status: 'invalid', validationStatus: 'failed', tenantId: '', failureReason: 'tenant_id_missing' });
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    printEvidence({ status: 'invalid', validationStatus: 'failed', tenantId, failureReason: 'database_url_missing' });
    process.exit(1);
  }
  if (!redisUrl) {
    printEvidence({ status: 'invalid', validationStatus: 'failed', tenantId, failureReason: 'redis_url_missing' });
    process.exit(1);
  }

  const db = getDbClient();
  const redis = createRedis(redisUrl);
  const queue = new Queue('conversation', { connection: redis });
  const evidence: Evidence = {
    status: 'invalid',
    validationStatus: 'failed',
    tenantId,
  };

  try {
    await assertSurveyProbeAvailable(tenantId);
    const runId = Date.now();
    const externalUserId = process.env.MAF_SELECTED_PROBE_SMOKE_USER_ID ?? `maf-selected-probe-smoke-${runId}`;
    const externalConversationId =
      process.env.MAF_SELECTED_PROBE_SMOKE_CONVERSATION_ID ?? `dev-conv-${externalUserId}`;

    const userId = await findOrCreateSmokeUser(tenantId, externalUserId);
    const conversationId = await findOrCreateSmokeConversation(tenantId, userId, externalConversationId);
    evidence.userId = userId;
    evidence.conversationId = conversationId;

    await insertRussianPrimerMessage(tenantId, userId, conversationId);

    const traceId = `selected-probe-smoke-${randomUUID()}`;
    evidence.traceId = traceId;
    await queue.add('check-in', {
      conversationId,
      userId,
      tenantId,
      externalWorkspaceId: EXTERNAL_WORKSPACE_ID,
      externalConversationId,
      traceId,
    });

    const result = await pollForSelectedProbeResult(traceId, tenantId, userId);
    Object.assign(evidence, result);

    if (!result.selectedProbeQuestionId) {
      evidence.failureReason = 'selected_probe_missing';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.requestMetadataProbePresent !== true) {
      evidence.failureReason = 'request_probe_metadata_missing';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.requestLocale !== 'ru') {
      evidence.failureReason = 'request_locale_not_ru';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.outboundContainsSurveyProbe !== true) {
      evidence.failureReason = 'outbound_probe_flag_missing';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.outboundSurveyProbeQuestionId !== result.selectedProbeQuestionId) {
      evidence.failureReason = 'outbound_probe_id_mismatch';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.runtimeAttemptPhase !== 'reply_committed') {
      evidence.failureReason = 'runtime_attempt_not_committed';
      printEvidence(evidence);
      process.exit(1);
    }
    if (result.runtimeAttemptFailureReason) {
      evidence.failureReason = 'runtime_attempt_failed';
      printEvidence(evidence);
      process.exit(1);
    }

    evidence.status = 'valid';
    evidence.validationStatus = 'passed';
    evidence.failureReason = undefined;
    printEvidence(evidence);
  } catch (error) {
    evidence.failureReason = safeFailureReason(error);
    printEvidence(evidence);
    process.exit(1);
  } finally {
    await queue.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await db.sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function assertSurveyProbeAvailable(tenantId: string): Promise<void> {
  const { sql } = getDbClient();
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM survey_questions q
    JOIN survey_definitions d ON d.id = q.survey_definition_id
    WHERE d.active = true
      AND (d.tenant_id = ${tenantId}::uuid OR d.tenant_id IS NULL)
      AND q.question_group <> 'engagement'
  `;
  if (Number(rows[0]?.count ?? 0) < 1) {
    throw new Error('survey_probe_unavailable');
  }
}

async function findOrCreateSmokeUser(tenantId: string, externalUserId: string): Promise<string> {
  const { sql } = getDbClient();
  const existing = await sql<{ user_id: string }[]>`
    SELECT user_id
    FROM channel_accounts
    WHERE channel_type = 'dev'
      AND external_workspace_id = ${EXTERNAL_WORKSPACE_ID}
      AND external_user_id = ${externalUserId}
    LIMIT 1
  `;
  if (existing[0]?.user_id) {
    await sql`
      UPDATE users
      SET locale = 'en-US',
          preferred_name = 'MAF Selected Probe Smoke',
          timezone = 'Europe/Warsaw',
          timezone_updated_at = now(),
          proactive_messaging_enabled = true,
          updated_at = now()
      WHERE id = ${existing[0].user_id}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;
    return existing[0].user_id;
  }

  const inserted = await sql<{ id: string }[]>`
    INSERT INTO users (
      tenant_id,
      preferred_name,
      timezone,
      timezone_updated_at,
      locale,
      proactive_messaging_enabled,
      onboarding_status
    )
    VALUES (
      ${tenantId}::uuid,
      'MAF Selected Probe Smoke',
      'Europe/Warsaw',
      now(),
      'en-US',
      true,
      'complete'
    )
    RETURNING id
  `;
  const userId = inserted[0]?.id;
  if (!userId) {
    throw new Error('smoke_user_create_failed');
  }

  await sql`
    INSERT INTO channel_accounts (
      user_id,
      tenant_id,
      channel_type,
      external_workspace_id,
      external_user_id,
      display_name
    )
    VALUES (
      ${userId}::uuid,
      ${tenantId}::uuid,
      'dev',
      ${EXTERNAL_WORKSPACE_ID},
      ${externalUserId},
      'MAF Selected Probe Smoke'
    )
  `;
  return userId;
}

async function findOrCreateSmokeConversation(
  tenantId: string,
  userId: string,
  externalConversationId: string,
): Promise<string> {
  const { sql } = getDbClient();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO conversations (
      tenant_id,
      user_id,
      channel_type,
      external_conversation_id,
      status,
      updated_at
    )
    VALUES (
      ${tenantId}::uuid,
      ${userId}::uuid,
      'dev',
      ${externalConversationId},
      'active',
      now()
    )
    ON CONFLICT (tenant_id, channel_type, external_conversation_id)
    DO UPDATE SET updated_at = now(), status = 'active'
    RETURNING id
  `;
  const conversationId = rows[0]?.id;
  if (!conversationId) {
    throw new Error('smoke_conversation_create_failed');
  }
  return conversationId;
}

async function insertRussianPrimerMessage(
  tenantId: string,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { sql } = getDbClient();
  const text = 'Я пытаюсь понять, что именно сейчас считается успехом и где у меня зона ответственности.';
  await sql`
    INSERT INTO messages (
      tenant_id,
      conversation_id,
      user_id,
      direction,
      sender_type,
      text,
      normalized_text,
      message_type,
      occurred_at,
      received_at,
      trace_id
    )
    VALUES (
      ${tenantId}::uuid,
      ${conversationId}::uuid,
      ${userId}::uuid,
      'inbound',
      'user',
      ${text},
      ${text.toLowerCase()},
      'text',
      now() - interval '30 seconds',
      now() - interval '30 seconds',
      ${`selected-probe-smoke-primer-${randomUUID()}`}
    )
  `;
}

async function pollForSelectedProbeResult(
  traceId: string,
  tenantId: string,
  userId: string,
): Promise<Partial<Evidence>> {
  const deadline = Date.now() + QUEUE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await fetchSelectedProbeResult(traceId, tenantId, userId);
    if (result.runtimeAttemptPhase === 'reply_committed' || result.runtimeAttemptPhase === 'failed') {
      return result;
    }
    await delay(QUEUE_POLL_INTERVAL_MS);
  }
  return { failureReason: 'selected_probe_smoke_timeout' };
}

async function fetchSelectedProbeResult(
  traceId: string,
  tenantId: string,
  userId: string,
): Promise<Partial<Evidence>> {
  const { sql } = getDbClient();
  const rows = await sql<{
    request_probe_id: string | null;
    request_probe_stable_key: string | null;
    request_metadata_probe_present: boolean | null;
    request_locale: string | null;
    backlog_probe_id: string | null;
    outbound_contains_probe: string | null;
    outbound_probe_id: string | null;
    runtime_phase: string | null;
    runtime_failure_reason: string | null;
  }[]>`
    SELECT
      req.metadata->>'surveyProbeQuestionId' AS request_probe_id,
      req.metadata->>'surveyProbeStableKey' AS request_probe_stable_key,
      req.metadata ? 'surveyProbeQuestionId' AS request_metadata_probe_present,
      req.metadata->>'userLocale' AS request_locale,
      backlog.survey_question_id::text AS backlog_probe_id,
      out.metadata->>'containsSurveyProbe' AS outbound_contains_probe,
      out.metadata->>'surveyProbeQuestionId' AS outbound_probe_id,
      r.phase AS runtime_phase,
      r.failure_reason AS runtime_failure_reason
    FROM messages req
    LEFT JOIN messages out
      ON out.trace_id = req.trace_id
     AND out.tenant_id = req.tenant_id
     AND out.user_id = req.user_id
     AND out.direction = 'outbound'
     AND out.message_type = 'proactive_check_in'
    LEFT JOIN LATERAL (
      SELECT pb.survey_question_id
      FROM pulse_backlog pb
      WHERE pb.tenant_id = req.tenant_id
        AND pb.user_id = req.user_id
        AND pb.status = 'active'
        AND pb.proactive_sent_at >= req.occurred_at - interval '10 seconds'
        AND pb.proactive_sent_at <= COALESCE(out.occurred_at, now()) + interval '10 seconds'
      ORDER BY pb.proactive_sent_at DESC
      LIMIT 1
    ) backlog ON true
    LEFT JOIN LATERAL (
      SELECT phase, failure_reason
      FROM runtime_attempts
      WHERE trace_id = req.trace_id
        AND tenant_id = req.tenant_id
      ORDER BY runtime_attempt DESC, created_at DESC
      LIMIT 1
    ) r ON true
    WHERE req.trace_id = ${traceId}
      AND req.tenant_id = ${tenantId}::uuid
      AND req.user_id = ${userId}::uuid
      AND req.direction = 'inbound'
      AND req.sender_type = 'system'
      AND req.message_type = 'proactive_check_in_request'
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return {};
  }

  return {
    selectedProbeQuestionId: row.request_probe_id ?? row.backlog_probe_id ?? undefined,
    selectedProbeStableKey: row.request_probe_stable_key ?? undefined,
    requestMetadataProbePresent: row.request_metadata_probe_present === true,
    requestLocale: row.request_locale ?? undefined,
    backlogProbeQuestionId: row.backlog_probe_id ?? undefined,
    outboundContainsSurveyProbe:
      row.outbound_contains_probe === null ? undefined : row.outbound_contains_probe === 'true',
    outboundSurveyProbeQuestionId: row.outbound_probe_id ?? undefined,
    runtimeAttemptPhase: row.runtime_phase ?? undefined,
    runtimeAttemptFailureReason: row.runtime_failure_reason,
  };
}

function createRedis(redisUrl: string): IORedis {
  const parsed = new URL(redisUrl);
  return new IORedis({
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

function safeFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown_error';
  }
  return error.message.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 120);
}

function printEvidence(evidence: Evidence): void {
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

void main();
