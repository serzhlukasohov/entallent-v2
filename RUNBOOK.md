# Operations Runbook

## Table of Contents

1. [OpenAI provider outage](#1-openai-provider-outage)
2. [Slack outage](#2-slack-outage)
3. [Stuck queue / BullMQ issue](#3-stuck-queue--bullmq-issue)
4. [DLQ replay](#4-dlq-replay)
5. [Database incident](#5-database-incident)
6. [Accidental prompt release](#6-accidental-prompt-release)
7. [Feature flag rollback](#7-feature-flag-rollback)
8. [User data deletion request](#8-user-data-deletion-request)
9. [Worker crash / restart](#9-worker-crash--restart)
10. [Redis restart](#10-redis-restart)

---

## 1. OpenAI provider outage

**Symptoms:** LLM calls failing; conversation jobs moving to failed state; circuit breaker logging "Circuit OPEN".

**Impact:** Users receive no AI responses. Follow-up executions fail. New messages are queued but not processed.

**Steps:**

1. Check OpenAI status page.
2. The circuit breaker opens automatically after 5 failures in 60s. No action needed — it will probe again after 30s.
3. If a fallback provider is configured (`AiProviderWithFallback`), it activates automatically.
4. Monitor queue metrics: `GET /api/v1/admin/queues` — watch the `failed` count.
5. When OpenAI recovers, the circuit breaker transitions to HALF_OPEN on next probe request.
6. Replay failed jobs from DLQ once the provider is healthy (see §4).

**Prevention:** Ensure `AiProviderWithFallback` has at least one secondary provider configured in worker env.

---

## 2. Slack outage

**Symptoms:** Slack Events API stops delivering; Socket Mode disconnects; no new messages ingested.

**Impact:** Users' messages are not received. Outbound messages queue but cannot be sent.

**Steps:**

1. Check Slack status page.
2. Slack retries failed webhook deliveries for up to 3 hours. Our idempotency layer (Redis `slack:event:{id}`) prevents duplicate processing when Slack replays.
3. Socket Mode (`SlackSocketModeService`) reconnects automatically — log `Slack Socket Mode connected`.
4. No manual action needed for ingestion side.
5. For outbound failures: check `message-send` queue in admin panel. Failed sends have the outbound message persisted in PostgreSQL — manually replay via DLQ (§4) once Slack is healthy.

---

## 3. Stuck queue / BullMQ issue

**Symptoms:** Queue depth growing without processing; workers not picking up jobs; `GET /admin/queues` shows `waiting` count increasing with no `active` count.

**Diagnosis:**

```bash
# Check worker health
curl https://your-worker-host/api/v1/health

# Check queue stats
curl -H "x-api-key: $ADMIN_API_KEY" https://your-api-host/api/v1/admin/queues
```

**Steps:**

1. Check worker logs for errors on startup (DB connection, Redis connection, env vars).
2. Verify Redis is reachable from the worker (`redis-cli -u $REDIS_URL ping`).
3. Check for jobs stuck in `active` state (worker died mid-job):
   - BullMQ has a stalled job check interval — it will automatically move stalled jobs back to `waiting`.
   - Default stalled check: 30s. Jobs remain stalled for up to `lockDuration` (default 30s) before recovery.
4. Restart the worker if it is unresponsive: `docker restart entalent-worker`.
5. If the queue module itself is broken, scale down workers to 0, drain active jobs, then scale back up.

---

## 4. DLQ replay

Jobs that exhaust all retry attempts move to the BullMQ "failed" set (our DLQ).

**Inspect DLQ:**

```bash
curl -H "x-api-key: $ADMIN_API_KEY" \
  https://your-api-host/api/v1/admin/queues/dead-letter
```

**Replay a specific job:**

```bash
curl -X POST \
  -H "x-api-key: $ADMIN_API_KEY" \
  https://your-api-host/api/v1/admin/queues/dead-letter/{jobId}/retry
```

**Bulk replay (all failed jobs in a queue):**

This is not exposed via the admin API — use the BullMQ CLI or a one-off script:

```typescript
import { Queue } from 'bullmq';
const queue = new Queue('conversation', { connection: { url: process.env.REDIS_URL } });
await queue.retryJobs({ state: 'failed' });
```

**Before replaying:**
- Confirm the root cause is fixed (provider recovered, DB accessible, etc.)
- Check if the job data is still valid (user/conversation still exists)
- Replay in small batches to avoid overwhelming the system

---

## 5. Database incident

### PostgreSQL connection failure

**Symptoms:** API/worker throwing `Error: DATABASE_URL is required` or connection pool exhaustion.

**Steps:**
1. Check managed PostgreSQL status dashboard.
2. Verify `DATABASE_URL` secret is set correctly in the deployment.
3. Check connection pool limits: default `max: 10` connections per process. Scale workers down if needed.
4. Once the DB is accessible, the API/worker will reconnect automatically on the next request.

### Migration failure

**Symptoms:** Application fails to start with `Migration failed` error.

**Steps:**
1. Check migration logs: `pnpm db:migrate` output.
2. Do NOT run the application before migrations succeed.
3. To roll back a migration: restore from the pre-migration backup, or write and apply a down migration manually.
4. Migrations are applied from the `packages/database/migrations/` directory.

### Accidental data deletion

1. Stop the application immediately to prevent further writes.
2. Restore from the most recent backup.
3. Use point-in-time recovery if available on your managed PostgreSQL provider.
4. Audit the deletion in the audit log before restoring: `GET /admin/audit-logs?action=hard_delete`.

---

## 6. Accidental prompt release

**Symptoms:** A prompt change causes regression in AI behavior (detected via Promptfoo or user reports).

**Rollback steps:**

1. Identify the commit that changed the prompt: `git log packages/ai-openai/src/prompts/`.
2. Revert the specific prompt file: `git revert <commit> -- packages/ai-openai/src/prompts/respond.ts`.
3. Bump the evaluator version constant in the changed prompt file (e.g., `1.0.0 → 1.0.1`) to mark the rollback in `llm_runs`.
4. Deploy the reverted version.
5. Verify via `GET /admin/prompt-versions` that the old version string is no longer active.
6. Run Promptfoo eval suite to confirm regression is resolved: `npx promptfoo eval --config evals/promptfooconfig.yaml`.

**Note:** Historical LLM outputs that used the bad prompt version have `evaluatorVersion` stamped — they can be flagged or re-processed.

---

## 7. Feature flag rollback

To immediately disable a feature for all tenants:

```bash
# Disable globally
curl -X PUT \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "rolloutPercentage": 0}' \
  https://your-api-host/api/v1/admin/feature-flags/proactive_messaging
```

To disable for a specific tenant:

```bash
curl -X PUT \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false, "rolloutPercentage": 0}' \
  "https://your-api-host/api/v1/admin/feature-flags/proactive_messaging?tenantId=<uuid>"
```

Available flag keys: `proactive_messaging`, `conversational_survey`, `risk_detection`, `human_escalation`, `memory_extraction`, `manager_analytics`, `vector_retrieval`.

---

## 8. User data deletion request

When a user submits a GDPR/CCPA deletion request:

```bash
curl -X DELETE \
  -H "x-api-key: $ADMIN_API_KEY" \
  https://your-api-host/api/v1/users/{userId}/data
```

**What this does:**
- Soft-deletes the user record (sets `deleted_at`)
- Hard-deletes: messages, memory items, goals, risk signals, scheduled actions, survey evidence, channel accounts
- Cancels pending BullMQ jobs for this user (any queued follow-ups, memory extractions)
- Records an audit event (`user_data_deletion_completed`)

**What it does NOT delete:**
- Audit log entries (required for legal accountability)
- Aggregate analytics (no individual data, already anonymized)
- Workspace-level data (shared with other users)

**Verify deletion:**
```bash
curl -H "x-api-key: $ADMIN_API_KEY" \
  https://your-api-host/api/v1/admin/user-debug/{userId}
```
Should return 404 or empty data after deletion.

---

## 9. Worker crash / restart

The worker is stateless — restart safely at any time.

1. BullMQ's stalled job detection will reclaim any jobs that were active at crash time.
2. Jobs will be retried according to the `backoff` configuration (`exponential, base 1s`).
3. Outbound messages that were in-flight are idempotent — the `message-send` job will retry.
4. Graceful shutdown (`SIGTERM`) drains active jobs before exit. The Docker health check will mark the container unhealthy before the orchestrator restarts it.

```bash
docker restart entalent-worker
# or in Kubernetes:
kubectl rollout restart deployment/entalent-worker
```

---

## 10. Redis restart

Redis holds BullMQ queue state and idempotency keys. A Redis restart has the following effects:

| Data | Impact | Recovery |
|------|--------|----------|
| Queue jobs (BullMQ) | All pending/active jobs lost | Manually re-trigger or wait for Slack replay |
| Idempotency keys (`slack:event:*`) | Cleared — Slack retries may be processed | Safe: Drizzle DB has message dedup via `external_message_id` unique constraint |
| Feature flag cache | None — feature flags are always read from PostgreSQL | No action needed |

**After Redis restart:**
1. Verify queue module reconnects: check worker startup logs for `BullMQ connected`.
2. Check if any conversations were in-flight and need re-processing.
3. The idempotency TTL is 24h — only events within the last 24h could be duplicated after a Redis flush.
