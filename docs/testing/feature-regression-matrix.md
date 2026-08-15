# Feature Regression Matrix

Status: draft for implementation.

Goal: build a clear regression layer for every product feature before adding more features. Product scenarios must validate the MAF path first.

## Runtime Rule

All product-level regression tests should exercise this path:

`Slack/API event -> queue -> worker -> MAF runtime -> TypeScript validation/persistence -> outbound/send/audit/runtime_attempts`

Legacy `ConversationOrchestrator` tests should remain only for fallback and rollback behavior. New feature confidence should come from MAF primary runtime tests, simulations, and judged conversations.

## Test Layers

| Layer | Purpose | Existing home |
| --- | --- | --- |
| Contract tests | MAF request/response schema, metadata, runtime result validity | `packages/contracts`, `agent-service/tests` |
| Adapter tests | Worker builds correct MAF context and handles result side effects | `apps/worker`, `packages/application` |
| Integration tests | API/worker/agent-service/Postgres/Redis path with deterministic model or fake | `apps/api`, `apps/worker`, scripts |
| Conversation simulations | Multi-turn product regressions with DB side effects | `packages/conversation-sim` |
| Live judged evals | Real model quality, safety, naturalness, privacy, survey subtlety | `evals`, live MAF smoke scripts |

## Feature Matrix

| Feature | User promise | MAF path to cover | Deterministic checks | Simulation / judge checks | Gate |
| --- | --- | --- | --- | --- | --- |
| Slack AI mentor | Employee gets a useful Slack reply | Slack event or API event reaches worker and calls MAF primary | HMAC, idempotency, inbound persisted, job queued, outbound persisted, send queued, trace/runtime evidence recorded | Reply is useful, concise, natural, no extra questions | PR for Slack/runtime changes |
| Long-term memory | Mentor remembers durable user context | Worker loads memory into `runtimeContext.memoryItems` before MAF call | Active memory only, ordered/limited, deleted/conflicted excluded, export/delete behavior | Uses relevant memory without creepy over-sharing | Feature PR + sim |
| Conversational Pulse | Engagement is measured through natural conversation | MAF receives reply policy/probe context and returns survey metadata | Window creation, probe eligibility, cooldown, evidence extraction, assessment scoring | Probe is subtle, one question max, skipped in bad moments | Feature PR + sim gate |
| Proactive check-ins | Mentor reaches out on cadence | Check-in job calls MAF with `requestPurpose='proactive_check_in'` | Eligibility, quiet hours, risk suppression, feature flag, selected probe recorded only if used | Warm short outreach, avoids banned reminder language | Feature PR + live smoke |
| Safety / risk | Risky situations are handled safely | MAF classifies risk and TS persists/enforces side effects | Risk signal persisted, survey/proactive suppressed, escalation audit for critical/immediate | Crisis/harassment/burnout responses pass safety judge | Required before release |
| Style adaptation | Mentor gradually adapts tone | Style/profile context is available to MAF when present | Profile update threshold, blending, no sentinel turns | Tone adapts without mimicry or unsafe patterns | Feature PR + judged eval |
| Profile hydration | Timezone enables correct timing | Hydrated timezone affects MAF/proactive context and quiet-hours logic | Slack timezone persisted, lookup failure non-fatal, quiet hours use timezone | Proactive eligibility changes correctly after hydration | Targeted PR |
| Manager Pulse dashboard | Managers see privacy-safe pulse state | MAF-created survey state appears in admin/dashboard read model | Cohort boundaries, statuses, backlog, no raw text/memory/risk reasoning | UI renders real API data | Dashboard/API PR |
| Manager Trends | Managers see aggregate trends | MAF-created messages/evidence feed trend aggregates | Daily buckets, polarity counts, funnel, days bounds, tenant scope | Trend UI charts render expected data | Dashboard/API PR |
| Admin console | Operators can inspect and recover system state | MAF runs are visible in queues, llm/runtime logs, audit | Queue list/retry, feature flags, audit, user debug sanitized | N/A unless live ops workflow changes | Ops/API PR |
| GDPR / privacy | User can export/delete data safely | Deleted data must not re-enter MAF context | Export allowlist, deletion anonymizes messages, clears memory, cancels actions, resolves risks | Post-deletion conversation has no stale context | Privacy PR |
| MAF rollout | Runtime can be rolled out and rolled back | Runtime flags control MAF disabled/shadow/canary/primary/denylist | Mode resolver, fallback barrier, invalid result rejected, `runtime_attempts` phase/failure | Live smoke proves primary path works | Runtime PR + release |

## Command Gates

Every PR:

```bash
pnpm typecheck
pnpm test
cd agent-service && pytest
```

Feature PR:

```bash
SIM_GATE_RUNS=1 pnpm sim:gate
pnpm maf:primary:app:smoke
```

Runtime, safety, survey, proactive, or Slack changes:

```bash
pnpm maf:primary:app:smoke
pnpm maf:agent-service:readiness
```

Release:

```bash
pnpm sim
pnpm maf:prod:acceptance
pnpm maf:prod:regression
```

## First Implementation Steps

1. Add missing MAF-first test tags/names so it is obvious which tests prove the primary runtime path.
2. Pick one feature and create its first end-to-end regression around MAF primary.
3. Wire the smallest reusable helper only after the second feature needs the same setup.
4. Add judged live evals after deterministic coverage exists for the same feature.

Suggested first feature: Slack AI mentor, because every other product capability depends on the inbound-to-MAF-to-outbound path.
