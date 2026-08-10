import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { and, desc, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { getDbClient, messages, runtimeAttempts } from '@entalent/database';
import { resolveMafShadowLiveSmokeEnv } from '../packages/application/src/use-cases/maf-shadow-live-smoke';

type MafShadowLiveSmokeEnvResolution = ReturnType<typeof resolveMafShadowLiveSmokeEnv>;

const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const agentServiceDir = join(repoRoot, 'agent-service');
const pythonPath = join(agentServiceDir, '.venv', 'bin', 'python');
const apiPort = process.env.API_PORT ?? '3000';
const DEFAULT_API_HOST = `http://127.0.0.1:${apiPort}`;
const API_BASE = resolveApiBase(process.env.MAF_RUNTIME_API_BASE, DEFAULT_API_HOST);
const IS_REMOTE_SMOKE = isRemoteMode(
  process.env.MAF_PRIMARY_APP_SMOKE_REMOTE,
  API_BASE,
  DEFAULT_API_HOST,
);
const SERVICE_HOST = '127.0.0.1';
const HEALTH_TIMEOUT_MS = 20_000;
const HEALTH_POLL_MS = 250;
const QUEUE_POLL_TIMEOUT_MS = 30_000;
const QUEUE_POLL_INTERVAL_MS = 500;
const SECRET_LIKE_PATTERN =
  /(api[_-]?key|bearer|password|secret|token|xox[abprs]-|sk-[A-Za-z0-9_-]+)/i;

type ChildHandle = ChildProcessWithoutNullStreams;
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueueState = 'active' | 'waiting' | 'delayed' | 'completed' | 'failed';

interface FeatureFlag {
  id: string;
  key: string;
  tenantId: string | null;
  enabled: boolean;
  rolloutPercentage: number | null;
  metadata: Record<string, unknown> | null;
}

interface FeatureFlagsResponse {
  flags: FeatureFlag[];
}

interface SimulateMessageResponse {
  traceId: string;
  messageId: string;
  conversationId: string;
  userId: string;
}

interface ConversationMessage {
  id: string;
  direction: string;
  text: string;
  occurredAt: string;
  traceId: string | null;
}

interface MessageSendJobData {
  messageId: string;
}

interface DbOutboundMessage {
  id: string;
  metadata: Record<string, unknown> | null;
  traceId: string | null;
}

interface RuntimeAttemptRecord {
  id: string;
  runtimeMode: string;
  phase: string;
  failureReason: string | null;
}

interface QueueCountsSnapshot {
  name: string;
  counts: Record<string, number | string>;
}

interface AdminQueuesResponse {
  queues: QueueCountsSnapshot[];
  timestamp: string;
}

interface QueueCheckResult {
  checked: boolean;
  found: boolean;
  state: string | null;
  source: 'redis' | 'admin' | 'none';
  reason?: string;
}

interface RuntimeCheckConfig {
  includePersistenceChecks: boolean;
  includeQueueChecks: boolean;
  allowAdminQueueCheck: boolean;
}

interface RuntimeEvidence {
  status: 'valid' | 'invalid';
  validationStatus: 'passed' | 'failed';
  traceId: string;
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  runtimeAttempt: RuntimeAttemptRecord | null;
  outboundMetadata: Record<string, unknown> | null;
  messageSendJobFound: boolean | null;
  messageSendJobState: string | null;
  messageSendQueueChecked: boolean;
  messageSendQueueSource?: 'redis' | 'admin' | 'not_checked';
  runtimeMetadataChecked: boolean;
  runtimeAttemptChecked: boolean;
  queueChecksRequested: boolean;
  failureReason?: string;
}

const activeChildren = new Set<ChildHandle>();
let workerReadyMarker = false;
let dbHandle: ReturnType<typeof getDbClient> | null = null;
let priorPrimaryFlag: FeatureFlag | null = null;
let priorDisabledFlag: FeatureFlag | null = null;

async function main(): Promise<void> {
  registerSignalHandlers();
  if (process.env.MAF_RUNTIME_API_BASE && !isValidApiBaseUrl(process.env.MAF_RUNTIME_API_BASE)) {
    printEvidence({
      status: 'invalid',
      validationStatus: 'failed',
      traceId: 'redacted',
      tenantId: tenantIdFromEnv(),
      conversationId: 'redacted',
      inboundMessageId: 'redacted',
      outboundMessageId: null,
      runtimeAttempt: null,
      outboundMetadata: null,
      messageSendJobFound: null,
      messageSendJobState: null,
      messageSendQueueChecked: false,
      runtimeMetadataChecked: false,
      runtimeAttemptChecked: false,
      queueChecksRequested: false,
      failureReason: 'invalid_api_base',
    });
    process.exit(1);
  }

  const runtimeChecks = resolveRuntimeCheckConfig(IS_REMOTE_SMOKE);

  const envResolution: MafShadowLiveSmokeEnvResolution = IS_REMOTE_SMOKE
    ? { env: {}, missingConfigKeys: [] }
    : resolveMafShadowLiveSmokeEnv(process.env);
  if (
    !IS_REMOTE_SMOKE &&
    (envResolution.missingConfigKeys.length > 0 || envResolution.invalidConfigKeys)
  ) {
    printEvidence({
      status: 'invalid',
      validationStatus: 'failed',
      traceId: 'redacted',
      tenantId: tenantIdFromEnv(),
      conversationId: 'redacted',
      inboundMessageId: 'redacted',
      outboundMessageId: null,
      runtimeAttempt: null,
      outboundMetadata: null,
      messageSendJobFound: null,
      messageSendJobState: null,
      messageSendQueueChecked: false,
      runtimeMetadataChecked: false,
      runtimeAttemptChecked: false,
      queueChecksRequested: runtimeChecks.includeQueueChecks,
      failureReason: envResolution.invalidConfigKeys
        ? 'runtime_configuration_invalid'
        : 'runtime_configuration_missing',
    });
    process.exit(1);
  }

  if (!IS_REMOTE_SMOKE && !existsPythonRuntime()) {
    printEvidence({
      status: 'invalid',
      validationStatus: 'failed',
      traceId: 'redacted',
      tenantId: tenantIdFromEnv(),
      conversationId: 'redacted',
      inboundMessageId: 'redacted',
      outboundMessageId: null,
      runtimeAttempt: null,
      outboundMetadata: null,
      messageSendJobFound: null,
      messageSendJobState: null,
      messageSendQueueChecked: false,
      runtimeMetadataChecked: false,
      runtimeAttemptChecked: false,
      queueChecksRequested: runtimeChecks.includeQueueChecks,
      failureReason: 'agent_service_python_missing',
    });
    process.exit(1);
  }

  const tenantId = tenantIdFromEnv();
  if (!tenantId) {
    printEvidence({
      status: 'invalid',
      validationStatus: 'failed',
      traceId: 'redacted',
      tenantId: '',
      conversationId: 'redacted',
      inboundMessageId: 'redacted',
      outboundMessageId: null,
      runtimeAttempt: null,
      outboundMetadata: null,
      messageSendJobFound: null,
      messageSendJobState: null,
      messageSendQueueChecked: false,
      runtimeMetadataChecked: false,
      runtimeAttemptChecked: false,
      queueChecksRequested: runtimeChecks.includeQueueChecks,
      failureReason: 'tenant_id_missing',
    });
    process.exit(1);
  }

  let evidence: RuntimeEvidence = {
    status: 'invalid',
    validationStatus: 'failed',
    traceId: 'redacted',
    tenantId,
    conversationId: 'redacted',
    inboundMessageId: 'redacted',
    outboundMessageId: null,
    runtimeAttempt: null,
    outboundMetadata: null,
    messageSendJobFound: null,
    messageSendJobState: null,
    messageSendQueueChecked: false,
    runtimeMetadataChecked: false,
    runtimeAttemptChecked: false,
    queueChecksRequested: runtimeChecks.includeQueueChecks,
  };

  let apiChild: ChildHandle | undefined;
  let workerChild: ChildHandle | undefined;
  let serviceChild: ChildHandle | undefined;

  try {
    if (!IS_REMOTE_SMOKE) {
      const agentPort = await reserveLoopbackPort();
      const serviceUrl = `http://${SERVICE_HOST}:${agentPort}`;

      serviceChild = await startAgentService(agentPort, envResolution.env);
      activeChildren.add(serviceChild);
      await waitForHealth(`${serviceUrl}/health/ready`, 'agent-service', HEALTH_TIMEOUT_MS);

      const sharedRuntimeEnv = buildRuntimeEnvironment(envResolution.env, serviceUrl);

      apiChild = spawnService('api', ['--filter', '@entalent/api', 'dev'], sharedRuntimeEnv);
      workerChild = spawnService(
        'worker',
        ['--filter', '@entalent/worker', 'dev'],
        sharedRuntimeEnv,
      );
      activeChildren.add(apiChild);
      activeChildren.add(workerChild);

      await waitForWorkerReady(workerChild, HEALTH_TIMEOUT_MS);
    }

    await waitForHealth(`${API_BASE}/health/ready`, 'api-ready', HEALTH_TIMEOUT_MS);

    if (runtimeChecks.includePersistenceChecks) {
      dbHandle = getDbClient();
    }

    priorPrimaryFlag = await getFeatureFlag('maf_runtime_primary', null);
    priorDisabledFlag = await getFeatureFlag('maf_runtime_disabled', null);

    await setFeatureFlag('maf_runtime_primary', { enabled: true, rolloutPercentage: 100 }, null);
    await setFeatureFlag('maf_runtime_disabled', { enabled: false, rolloutPercentage: 100 }, null);

    evidence = await runConversationSmoke(tenantId, runtimeChecks);
    printEvidence(evidence);
    process.exitCode = evidence.status === 'valid' ? 0 : 1;
  } catch (error) {
    evidence.failureReason = safeFailureReason(error);
    evidence.validationStatus = 'failed';
    printEvidence(evidence);
    process.exitCode = 1;
  } finally {
    try {
      await restoreFeatureFlags();
    } catch {
      // best-effort cleanup for feature flags
    }

    if (dbHandle?.sql) {
      await dbHandle.sql.end({ timeout: 2 });
      dbHandle = null;
    }

    await stopChildren();
  }
}

function buildRuntimeEnvironment(
  envResolution: Record<string, string>,
  agentServiceUrl: string,
): Record<string, string> {
  return {
    AGENT_SERVICE_INTERNAL_URL: agentServiceUrl,
    ...(process.env.AGENT_SERVICE_TIMEOUT_MS
      ? { AGENT_SERVICE_TIMEOUT_MS: process.env.AGENT_SERVICE_TIMEOUT_MS }
      : {}),
    ...(process.env.INTERNAL_SERVICE_AUTH_SECRET
      ? { INTERNAL_SERVICE_AUTH_SECRET: process.env.INTERNAL_SERVICE_AUTH_SECRET }
      : {}),
    ...(envResolution['AGENT_SERVICE_MODEL_PROVIDER']
      ? { AGENT_SERVICE_MODEL_PROVIDER: envResolution['AGENT_SERVICE_MODEL_PROVIDER'] }
      : {}),
    ...(envResolution['AGENT_SERVICE_MODEL_NAME']
      ? { AGENT_SERVICE_MODEL_NAME: envResolution['AGENT_SERVICE_MODEL_NAME'] }
      : {}),
    ...(envResolution['AGENT_SERVICE_OPENAI_API_KEY']
      ? { AGENT_SERVICE_OPENAI_API_KEY: envResolution['AGENT_SERVICE_OPENAI_API_KEY'] }
      : {}),
    ...(envResolution['AGENT_SERVICE_OPENAI_ORG_ID']
      ? { AGENT_SERVICE_OPENAI_ORG_ID: envResolution['AGENT_SERVICE_OPENAI_ORG_ID'] }
      : {}),
    ...(envResolution['AGENT_SERVICE_AZURE_OPENAI_ENDPOINT']
      ? {
          AGENT_SERVICE_AZURE_OPENAI_ENDPOINT: envResolution['AGENT_SERVICE_AZURE_OPENAI_ENDPOINT'],
        }
      : {}),
    ...(envResolution['AGENT_SERVICE_AZURE_OPENAI_API_KEY']
      ? { AGENT_SERVICE_AZURE_OPENAI_API_KEY: envResolution['AGENT_SERVICE_AZURE_OPENAI_API_KEY'] }
      : {}),
    ...(envResolution['AGENT_SERVICE_AZURE_OPENAI_API_VERSION']
      ? {
          AGENT_SERVICE_AZURE_OPENAI_API_VERSION:
            envResolution['AGENT_SERVICE_AZURE_OPENAI_API_VERSION'],
        }
      : {}),
  };
}

function resolveRuntimeCheckConfig(isRemoteSmoke: boolean): RuntimeCheckConfig {
  const remoteDbAvailable = Boolean(process.env.DATABASE_URL);
  const remoteQueueAvailable = Boolean(process.env.REDIS_URL) || Boolean(process.env.ADMIN_API_KEY);

  const includePersistenceChecks = isRemoteSmoke
    ? (parseBoolean(process.env.MAF_PRIMARY_APP_SMOKE_CHECK_DB) ?? remoteDbAvailable)
    : true;
  const includeQueueChecks = isRemoteSmoke
    ? (parseBoolean(process.env.MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE) ?? remoteQueueAvailable)
    : true;

  return {
    includePersistenceChecks,
    includeQueueChecks,
    allowAdminQueueCheck: Boolean(process.env.ADMIN_API_KEY),
  };
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function isRemoteMode(
  remoteFlag: string | undefined,
  apiBase: string,
  defaultApiHost: string,
): boolean {
  if (remoteFlag !== undefined) {
    return parseBoolean(remoteFlag) ?? false;
  }

  const normalizedDefault = `${defaultApiHost}/api/v1`;
  return apiBase !== normalizedDefault;
}

function resolveApiBase(explicit: string | undefined, defaultHost: string): string {
  const trimmed = explicit?.trim();
  if (!trimmed || trimmed.length === 0) {
    return `${defaultHost}/api/v1`;
  }

  if (!isValidApiBaseUrl(trimmed)) {
    return `${defaultHost}/api/v1`;
  }

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, '');
    const normalizedPath =
      path === '' ? '/api/v1' : path.endsWith('/api/v1') ? path : `${path}/api/v1`;
    return `${parsed.protocol}//${parsed.host}${normalizedPath}`;
  } catch {
    return `${defaultHost}/api/v1`;
  }
}

function isValidApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function spawnService(
  label: string,
  command: string[],
  extraEnv: Record<string, string>,
): ChildHandle {
  const child = spawn('pnpm', command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (label === 'worker') {
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      if (/Nest application successfully started/.test(text)) {
        workerReadyMarker = true;
      }
    });
  }

  child.stderr?.on('data', () => {
    // drain stderr to avoid pipe blocking
  });

  return child;
}

async function startAgentService(
  port: number,
  smokeEnv: Record<string, string>,
): Promise<ChildHandle> {
  const child = spawn(
    pythonPath,
    [
      '-m',
      'uvicorn',
      'agent_service.main:create_app',
      '--factory',
      '--host',
      SERVICE_HOST,
      '--port',
      String(port),
      '--log-level',
      'warning',
    ],
    {
      cwd: agentServiceDir,
      env: {
        ...process.env,
        ...smokeEnv,
        PYTHONPATH: join(agentServiceDir, 'src'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stderr?.on('data', () => {
    // Drain stderr so provider warnings do not block the subprocess.
  });

  return child;
}

async function runConversationSmoke(
  tenantId: string,
  checks: RuntimeCheckConfig,
): Promise<RuntimeEvidence> {
  const evidence: RuntimeEvidence = {
    status: 'invalid',
    validationStatus: 'failed',
    traceId: 'redacted',
    tenantId,
    conversationId: 'redacted',
    inboundMessageId: 'redacted',
    outboundMessageId: null,
    runtimeAttempt: null,
    outboundMetadata: null,
    messageSendJobFound: null,
    messageSendJobState: null,
    messageSendQueueChecked: false,
    runtimeMetadataChecked: false,
    runtimeAttemptChecked: false,
    queueChecksRequested: checks.includeQueueChecks,
  };

  const inbound = await request<SimulateMessageResponse>('/dev/simulate-message', 'POST', {
    tenantId,
    userId: `smoke-${Date.now()}`,
    userName: 'Smoke Primary User',
    text: 'Smoke check: please reply in one short sentence.',
  });

  evidence.traceId = safeTraceId(inbound.traceId);
  evidence.conversationId = inbound.conversationId;
  evidence.inboundMessageId = inbound.messageId;

  const outbound = await pollForOutboundMessage(
    inbound.conversationId,
    inbound.messageId,
    QUEUE_POLL_TIMEOUT_MS,
  );
  if (!outbound) {
    evidence.failureReason = 'outbound_message_timeout';
    return evidence;
  }

  evidence.outboundMessageId = outbound.id;

  if (checks.includePersistenceChecks) {
    const outboundDbRow = await fetchOutboundMetadataFromDb(outbound.id, tenantId);
    evidence.outboundMetadata = outboundDbRow?.metadata ?? null;
    evidence.runtimeMetadataChecked = true;

    evidence.runtimeAttempt = await fetchRuntimeAttempt(
      inbound.messageId,
      inbound.traceId,
      tenantId,
    );
    evidence.runtimeAttemptChecked = true;
    if (!isPrimaryOutboundMetadata(evidence.outboundMetadata)) {
      evidence.failureReason = 'runtime_metadata_invalid';
      return evidence;
    }

    if (!evidence.runtimeAttempt || evidence.runtimeAttempt.runtimeMode !== 'maf_primary') {
      evidence.failureReason = 'runtime_attempt_missing_or_wrong_mode';
      return evidence;
    }

    if (!['reply_committed', 'actions_committed'].includes(evidence.runtimeAttempt.phase)) {
      evidence.failureReason = 'runtime_attempt_phase_not_committed';
      return evidence;
    }
  }

  if (checks.includeQueueChecks) {
    const queueEvidence = await findMessageSendJob(outbound.id, checks.allowAdminQueueCheck);
    evidence.messageSendQueueChecked = queueEvidence.checked;
    evidence.messageSendQueueSource = queueEvidence.source;
    evidence.messageSendJobFound = queueEvidence.found;
    evidence.messageSendJobState = queueEvidence.state;

    if (!queueEvidence.checked) {
      evidence.failureReason = queueEvidence.reason ?? 'queue_evidence_not_available';
      return evidence;
    }

    if (!queueEvidence.found) {
      evidence.failureReason = 'message_send_queue_missing';
      return evidence;
    }

    if (queueEvidence.state === 'failed') {
      evidence.failureReason = 'message_send_job_failed';
      return evidence;
    }
  } else {
    evidence.messageSendQueueSource = 'not_checked';
  }

  evidence.status = 'valid';
  evidence.validationStatus = 'passed';
  evidence.failureReason = undefined;
  return evidence;
}

function isPrimaryOutboundMetadata(value: Record<string, unknown> | null): value is {
  runtimeMode: string;
  runtimeVersion: string;
  modelCalls: number;
  toolCalls: number;
  retryCount: number;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.runtimeMode === 'maf_primary' &&
    typeof value.runtimeVersion === 'string' &&
    typeof value.modelCalls === 'number' &&
    typeof value.toolCalls === 'number' &&
    typeof value.retryCount === 'number'
  );
}

async function fetchOutboundMetadataFromDb(
  messageId: string,
  tenantId: string,
): Promise<DbOutboundMessage | null> {
  if (!dbHandle) {
    return null;
  }

  const [row] = await dbHandle.client
    .select({ id: messages.id, metadata: messages.metadata, traceId: messages.traceId })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId)))
    .limit(1);

  return row ? { ...row, metadata: toRecord(row.metadata) } : null;
}

async function fetchRuntimeAttempt(
  messageId: string,
  traceId: string,
  tenantId: string,
): Promise<RuntimeAttemptRecord | null> {
  if (!dbHandle) {
    return null;
  }

  const [row] = await dbHandle.client
    .select({
      id: runtimeAttempts.id,
      runtimeMode: runtimeAttempts.runtimeMode,
      phase: runtimeAttempts.phase,
      failureReason: runtimeAttempts.failureReason,
    })
    .from(runtimeAttempts)
    .where(
      and(
        eq(runtimeAttempts.messageId, messageId),
        eq(runtimeAttempts.traceId, traceId),
        eq(runtimeAttempts.tenantId, tenantId),
      ),
    )
    .orderBy(desc(runtimeAttempts.createdAt))
    .limit(1);

  return row ?? null;
}

async function findMessageSendJob(
  outboundMessageId: string,
  allowAdminFallback: boolean,
): Promise<QueueCheckResult> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    if (allowAdminFallback) {
      return findMessageSendJobFromAdminEndpoint();
    }

    return {
      checked: false,
      found: false,
      state: null,
      source: 'none',
      reason: 'redis_url_missing',
    };
  }

  const connection = parseRedisConnection(redisUrl);
  const queue = new Queue<MessageSendJobData>('message-send', { connection });
  const states: QueueState[] = ['waiting', 'active', 'delayed', 'completed', 'failed'];

  try {
    const jobs = await queue.getJobs(states, 0, 200);
    const match = jobs.find((job) => {
      const data = job.data as Partial<MessageSendJobData> | undefined;
      return data?.messageId === outboundMessageId;
    });
    if (!match) {
      return { checked: true, found: false, state: null, source: 'redis' };
    }

    const state = await match.getState();
    return { checked: true, found: true, state, source: 'redis' };
  } catch {
    if (allowAdminFallback) {
      return findMessageSendJobFromAdminEndpoint();
    }
    return {
      checked: false,
      found: false,
      state: null,
      source: 'none',
      reason: 'queue_lookup_failed',
    };
  } finally {
    await queue.close();
  }
}

async function findMessageSendJobFromAdminEndpoint(): Promise<QueueCheckResult> {
  try {
    const queueStats = await request<AdminQueuesResponse>('/admin/queues', 'GET');
    const messageSendQueue = queueStats.queues.find((entry) => entry.name === 'message-send');
    if (!messageSendQueue) {
      return {
        checked: true,
        found: false,
        state: null,
        source: 'admin',
        reason: 'admin_queue_list_missing',
      };
    }

    return {
      checked: true,
      found: true,
      state: `queue_counts:${serializeQueueCounts(messageSendQueue.counts)}`,
      source: 'admin',
    };
  } catch {
    return {
      checked: false,
      found: false,
      state: null,
      source: 'none',
      reason: 'admin_queue_check_failed',
    };
  }
}

function serializeQueueCounts(counts: Record<string, number | string>): string {
  const total = Object.values(counts).reduce((total, value) => total + toSafeNumber(value), 0);
  return `${total}`;
}

function toSafeNumber(value: number | string): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function pollForOutboundMessage(
  conversationId: string,
  inboundMessageId: string,
  timeoutMs: number,
): Promise<ConversationMessage | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const rows = await request<ConversationMessage[]>(
        `/dev/conversation/${conversationId}/messages?after=${encodeURIComponent(inboundMessageId)}`,
        'GET',
      );
      const outbound = rows.find((row) => row.direction === 'outbound');
      if (outbound) {
        return outbound;
      }
    } catch {
      // Keep polling until timeout.
    }

    await delay(QUEUE_POLL_INTERVAL_MS);
  }

  return null;
}

async function restoreFeatureFlags(): Promise<void> {
  if (priorPrimaryFlag === null) {
    await deleteFeatureFlag('maf_runtime_primary', null);
  } else {
    await setFeatureFlag(
      'maf_runtime_primary',
      {
        enabled: priorPrimaryFlag.enabled,
        rolloutPercentage: priorPrimaryFlag.rolloutPercentage ?? undefined,
        metadata: priorPrimaryFlag.metadata ?? undefined,
      },
      null,
    );
  }

  if (priorDisabledFlag === null) {
    await deleteFeatureFlag('maf_runtime_disabled', null);
  } else {
    await setFeatureFlag(
      'maf_runtime_disabled',
      {
        enabled: priorDisabledFlag.enabled,
        rolloutPercentage: priorDisabledFlag.rolloutPercentage ?? undefined,
        metadata: priorDisabledFlag.metadata ?? undefined,
      },
      null,
    );
  }
}

async function getFeatureFlag(key: string, tenantId?: string | null): Promise<FeatureFlag | null> {
  const response = await request<FeatureFlagsResponse>(
    '/admin/feature-flags',
    'GET',
    undefined,
    tenantId,
  );
  if (!response || !Array.isArray(response.flags)) {
    return null;
  }

  return (
    response.flags.find((flag) => flag.key === key && flag.tenantId === (tenantId ?? null)) ?? null
  );
}

async function setFeatureFlag(
  key: string,
  payload: { enabled: boolean; rolloutPercentage?: number; metadata?: Record<string, unknown> },
  tenantId?: string | null,
): Promise<void> {
  await request<{ flag: FeatureFlag }>(
    `/admin/feature-flags/${encodeURIComponent(key)}`,
    'PUT',
    {
      ...payload,
      metadata: payload.metadata,
      rolloutPercentage: payload.rolloutPercentage,
    },
    tenantId,
  );
}

async function deleteFeatureFlag(key: string, tenantId?: string | null): Promise<void> {
  await request<void>(
    `/admin/feature-flags/${encodeURIComponent(key)}`,
    'DELETE',
    undefined,
    tenantId,
  );
}

async function waitForHealth(url: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, 1_000);
      const body = await response.json().catch(() => undefined);
      if (
        response.ok &&
        typeof body === 'object' &&
        body !== null &&
        'service' in body &&
        body.service === 'agent-service'
      ) {
        return;
      }

      // API ready endpoint does not include service name; check only HTTP 2xx
      if (url.includes('/health/ready') && response.ok) {
        return;
      }
    } catch {
      // Service is still booting.
    }

    await delay(HEALTH_POLL_MS);
  }

  throw new Error(`${label}_health_timeout`);
}

async function waitForWorkerReady(worker: ChildHandle, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error('worker_exited_before_ready');
    }
    if (workerReadyMarker) {
      return;
    }
    await delay(HEALTH_POLL_MS);
  }

  if (worker.exitCode !== null) {
    throw new Error('worker_exited_before_ready');
  }

  return;
}

async function stopChildren(): Promise<void> {
  const kills = [...activeChildren].map((child) => {
    return new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }

      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref();
      setTimeout(resolve, 3_000).unref();
    });
  });

  await Promise.all(kills);
  activeChildren.clear();
}

function existsPythonRuntime(): boolean {
  return existsSync(pythonPath);
}

function parseRedisConnection(redisUrl: string): { host: string; port: number; password?: string } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

function safeTraceId(traceId: string): string {
  return SAFE_TRACE_ID_PATTERN.test(traceId) && !SECRET_LIKE_PATTERN.test(traceId)
    ? traceId
    : 'redacted';
}

function safeFailureReason(error: unknown): string {
  if (
    error instanceof Error &&
    SAFE_TRACE_ID_PATTERN.test(error.message) &&
    !SECRET_LIKE_PATTERN.test(error.message)
  ) {
    return error.message;
  }

  return 'live_primary_app_smoke_failed';
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function request<T>(
  path: string,
  method: HttpMethod,
  body?: unknown,
  tenantId?: string | null,
): Promise<T> {
  const targetUrl = path.startsWith('http') ? new URL(path) : new URL(`${API_BASE}${path}`);
  if (tenantId) {
    targetUrl.searchParams.set('tenantId', tenantId);
  }

  const headers: Record<string, string> = {};
  if (method === 'POST' || method === 'PUT' || body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey) {
    headers['X-Api-Key'] = adminKey;
  }

  const response = await fetchWithTimeout(targetUrl.toString(), 5_000, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `${method} ${targetUrl.pathname} failed: ${response.status}` +
        (text ? ` ${safeTrimmed(text)}` : ''),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  options?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function tenantIdFromEnv(): string {
  return process.env.DEFAULT_TENANT_ID ?? '';
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, SERVICE_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('loopback_port_unavailable')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function registerSignalHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      await stopChildren();
      process.exit(130);
    });
  }
}

function printEvidence(evidence: RuntimeEvidence): void {
  console.log(JSON.stringify(evidence, null, 2));
}

function safeTrimmed(text: string): string {
  return text.replaceAll('\n', ' ').trim().slice(0, 200);
}

const SAFE_TRACE_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

main().catch((error: unknown) => {
  printEvidence({
    status: 'invalid',
    validationStatus: 'failed',
    traceId: 'redacted',
    tenantId: tenantIdFromEnv(),
    conversationId: 'redacted',
    inboundMessageId: 'redacted',
    outboundMessageId: null,
    runtimeAttempt: null,
    outboundMetadata: null,
    messageSendJobFound: null,
    messageSendJobState: null,
    messageSendQueueChecked: false,
    runtimeMetadataChecked: false,
    runtimeAttemptChecked: false,
    queueChecksRequested: false,
    failureReason: safeFailureReason(error),
  });
  process.exit(1);
});
