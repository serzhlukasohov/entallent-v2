# enTalent — Product & Functional Requirements (As-Built)

> **Status:** Reverse-engineered from the current codebase (`codex/maf-runtime-spike` branch, 2026-08-05).
> This document describes requirements **as actually implemented**, not aspirations. Where a capability
> exists as a stub or is gated behind a feature flag, it is noted explicitly.

---

## 1. Product Overview

### 1.1 Vision
enTalent is a **multi-tenant SaaS AI mentor** delivered to employees inside Slack. It holds ongoing,
supportive 1:1 conversations, remembers context about each person across time, measures employee
engagement passively through natural dialogue (rather than explicit questionnaires), watches for
psychological risk, and surfaces **privacy-safe aggregate** insight to managers — without ever exposing
raw individual conversations.

### 1.2 Target Users & Roles
| Role | Access | Primary value |
|------|--------|---------------|
| **Employee (end user)** | Slack DM with the mentor; own memory/goals via API | A private, always-available mentor that remembers them and checks in proactively |
| **Manager** | Aggregate analytics only (cohort ≥ 5) | Engagement/wellbeing trends for their team without surveillance |
| **Admin** | Full admin panel via `X-Api-Key` (all access audit-logged) | Operate queues, review LLM runs, debug users, manage feature flags |
| **AI system** | Full conversation context during a job; no retention beyond the job | Processing only |

### 1.3 Core Product Principles (enforced in code)
- **Passive measurement:** engagement is inferred from conversation evidence, not forms.
- **Privacy by construction:** managers never see individual text; cohort minimum of 5 is enforced server-side.
- **Safety first:** risk detection can suppress surveys and cancel proactive outreach.
- **Consent-driven:** proactive messaging and survey probing are opt-in / opt-out per user.
- **Provider-swappable:** AI provider, queue backend, and encryption are behind ports (hexagonal architecture).

---

## 2. System Context (Implemented)

Three deployable apps plus shared domain packages:

| App | Tech | Responsibility |
|-----|------|----------------|
| `apps/api` | NestJS + Fastify | Slack webhook ingestion (HMAC-verified), user/admin/manager REST endpoints, queue submission |
| `apps/worker` | NestJS + BullMQ | Async conversation pipeline, memory extraction, survey evidence, follow-ups, proactive scans |
| `apps/dashboard` | Next.js (App Router) | Manager-facing **Pulse** and **Trends** UI + dev controls |

Backing services: **PostgreSQL** (Drizzle ORM), **Redis** (BullMQ queues + DLQ), **OpenAI** (`gpt-4o` for generation, `gpt-4o-mini` for analysis).

---

## 3. Functional Requirements by Capability

### 3.1 Conversational Mentor (Inbound Message Pipeline)

**PRD:** An employee messages the mentor in Slack and receives a thoughtful, context-aware reply.

**Functional requirements:**
- **FR-CONV-1** The API MUST accept Slack events at `POST /channel/slack/events` and MUST verify the HMAC signature before processing.
- **FR-CONV-2** Each inbound message MUST be persisted (immutable log), associated with a conversation (created if none exists), and MUST NOT be processed synchronously — a `ConversationJob` is enqueued to the `conversation` queue.
- **FR-CONV-3** The worker pipeline MUST, per turn, execute in order:
  1. Load conversation + last 20 messages.
  2. Load active memory items (if `memory_extraction` flag enabled).
  3. **Classify situation** (`gpt-4o-mini`) → produces `requiresSafetyCheck`, `surveyAllowed`, reply strategy.
  4. **Detect risk** (`gpt-4o-mini`) if `requiresSafetyCheck` is true.
  5. Persist a risk signal if severity ≠ none; trigger escalation if critical / immediate.
  6. Find a survey probe if survey is enabled and allowed.
  7. **Generate response** (`gpt-4o`) using memory + style + probe context.
  8. Save the outbound message and enqueue send + memory-extraction + survey-evidence jobs.
- **FR-CONV-4** Message delivery MUST be a separate `message-send` job (decoupled from generation, higher concurrency).
- **FR-CONV-5** Duplicate/normalized text MUST be tracked (`normalized_text`) for dedup.
- **FR-CONV-6** Every DB operation for one request MUST share a `trace_id` for observability.

**Reliability:** conversation, message-send, memory, survey, and follow-up-execution queues retry **3× with exponential backoff**; exhausted jobs land in BullMQ's failed set (DLQ) and are retriable via `POST /admin/queues/dead-letter/:jobId/retry`.

---

### 3.2 Long-Term Memory

**PRD:** The mentor remembers durable facts about each user (goals, concerns, preferences) and uses them to personalize responses.

**Functional requirements:**
- **FR-MEM-1** After each turn, memory extraction MUST run asynchronously (`memory-extraction` queue), taking the last 20 turns + existing active items as input.
- **FR-MEM-2** Extracted items MUST be categorized as one of: `goal | preference | concern | achievement | context`, with an `importance` score (0–1).
- **FR-MEM-3** The extractor MUST detect **conflicts** (new fact contradicts old → old marked `conflicted`, both linked via `conflict_with`) and **supersessions** (new fact updates old → old marked `superseded`).
- **FR-MEM-4** On response generation, the system MUST inject the top-20 active memory items by importance into the prompt as a structured section.
- **FR-MEM-5** Memory items MUST NOT expire by time; they change only via supersede/conflict/delete. Default retention 365 days (per-tenant configurable).
- **FR-MEM-6** Users MUST be able to list (`GET /users/:userId/memory`) and delete (`DELETE /users/:userId/memory/:memoryId`) their memory; both require `X-Api-Key` and MUST write audit entries.

---

### 3.3 Conversational Pulse / Engagement Survey

**PRD:** Measure engagement across engagement dimensions by embedding optional probes into normal replies and scoring extracted evidence — never as an explicit questionnaire.

**Implemented question model (from seed):** a global survey definition seeded with the **Gallup Q12** set plus additional items, organized into **five dimension groups**:
`autonomy`, `belonging`, `engagement`, `growth`, `purpose`. Tenants MAY override with their own definition + questions.

**Functional requirements:**
- **FR-SURV-1** A `survey_window` MUST be auto-created for a user on their first conversation each quarter (`findOrCreateActiveWindow`), bounded by `period_start`/`period_end`.
- **FR-SURV-2** A probe MUST be attempted only when ALL hold:
  1. classification `surveyAllowed = true`,
  2. risk `surveyMustBeBlocked = false`,
  3. `conversational_survey` flag enabled for tenant/user,
  4. a pending probe question exists in the user's window.
- **FR-SURV-3** A question is a valid pending probe only if: assessment not `scored`/`suppressed`, evidence count < `maxFollowUpProbes` (typ. 3), and per-question cooldown (typ. 7 days) has elapsed.
- **FR-SURV-4** Survey evidence extraction MUST run async (`survey-evidence` queue), producing per record: `evidenceSummary`, `polarity (positive|negative|neutral|mixed)`, `strength`, `completeness`, `confidence`, `sourceMessageIds`, `promptVersion`.
- **FR-SURV-5** Assessment status MUST follow the lifecycle: `unknown → insufficient_evidence → partially_covered → scored`, with `needs_review` (admin flag) and `suppressed` (safety block) as side states. Thresholds: completeness ≥ 0.4 → partially covered; `scored` when a single item crosses both completeness+confidence thresholds (~0.7) OR accumulated completeness ≥ threshold.
- **FR-SURV-6** Score value MUST be a polarity-adjusted weighted average of evidence strength (positive adds, negative subtracts).
- **FR-SURV-7** Survey activity MUST be suppressed when: `surveyMustBeBlocked`, active high-risk signal, user opt-out (`consent_state.surveyEnabled = false`), or flag disabled.

---

### 3.4 Proactive Pulse Check-Ins (Agent-Initiated)

**PRD:** The mentor reaches out first — on a cadence — to keep the relationship warm and collect pulse evidence over time.

**Functional requirements:**
- **FR-PROA-1** A periodic scan (`ProactiveSchedulerUseCase`) MUST select **who** to contact. SQL filtering handles silence, cadence, and active-risk exclusion; the use case applies the timezone-aware quiet-hours guard.
- **FR-PROA-2** Default cadence config: `minSilenceDays = 3`, `minCheckInGapDays = 3`, `batchLimit = 50` (anti–thundering-herd), `quietHoursEnabled = true`. Config is tenant-overridable.
- **FR-PROA-3** For each eligible user, `ProactiveCheckInUseCase` MUST pick the next pending question from the **per-user pulse backlog** (`PulseBacklogService`) and let the AI steer naturally toward that topic — the AI MAY open warmly and ignore the topic (evidence collection is long-horizon).
- **FR-PROA-4** Proactive outreach MUST be suppressed when: `proactiveMessagingEnabled = false`, within user quiet hours, active high-risk signal, or `proactive_messaging` flag disabled. Users skipped for quiet hours are retried on the next scan.
- **FR-PROA-5** A legacy scheduled-action follow-up path (`scheduled_actions`, `FollowUpScheduler`/`FollowUpExecution`, cron ~15 min) also exists for `follow_up | check_in | nudge | milestone` intents, cancelling on active high-risk.

---

### 3.5 Safety & Risk Detection

**PRD:** Detect emotional/psychological risk and respond appropriately, escalating critical cases — while never exposing risk detail to managers.

**Functional requirements:**
- **FR-SAFE-1** Risk detection MUST run whenever classification sets `requiresSafetyCheck = true`, over the last 20 turns.
- **FR-SAFE-2** Risk taxonomy MUST be one of: `burnout | crisis | harassment | disengagement`; severity one of `none | low | medium | high | critical` with auto-expiry (7d/30d/90d/90d).
- **FR-SAFE-3** Detection output MUST include `riskType`, `severity`, `confidence`, `immediateResponseRequired`, `surveyMustBeBlocked`, `recommendedAction`.
- **FR-SAFE-4** Detected risk MUST be persisted with evidence message IDs and a `policy_version`; subsequent messages update the active signal or create a new one.
- **FR-SAFE-5** Response mode MUST scale with severity (none → normal; low/medium → supportive; high → mentions professional resources; critical → crisis resources + escalation).
- **FR-SAFE-6** Escalation MUST fire on `severity = critical` OR `immediateResponseRequired = true`, calling `EscalationPort.raise()` + audit log. Current implementation is a stub (`EscalationStubService`) that logs + audits; production adapters (email/PagerDuty/Slack/HRIS) plug into the unchanged port.
- **FR-SAFE-7** Risk detail MUST NEVER appear in manager analytics; admin debug shows only sanitized status (`hasActiveRisk`, `severity`, `type`) — no reasoning or triggering excerpts.

---

### 3.6 Style Adaptation (Linguistic Accommodation)

**PRD:** The mentor gradually mirrors the user's communication style across conversations to build rapport.

**Functional requirements:**
- **FR-STYLE-1** After sufficient user turns (`MIN_USER_TURNS`), `StyleAnalysisUseCase` MUST analyze recent inbound turns (excluding the `__init__` sentinel) and update a persisted per-user style profile.
- **FR-STYLE-2** Adaptation MUST be **gradual and cross-conversation** (weighted blend of current profile + newly observed style by turn count) — NOT an intra-conversation shortcut. A default profile is used until enough data exists.

---

### 3.7 Profile Hydration

- **FR-PROF-1** `ProfileHydrationUseCase` MUST fetch the user's timezone from the external channel (Slack) and update the user record, enabling correct quiet-hours math. No-op if timezone unavailable.

---

### 3.8 Manager Analytics (Privacy-Safe)

**PRD:** Managers see team-level engagement/wellbeing signal, never individuals.

**Functional requirements:**
- **FR-MGR-1** All manager/analytics endpoints MUST enforce a **cohort minimum of 5** server-side; any metric with < 5 users MUST be suppressed. The frontend MUST NOT be relied on for this.
- **FR-MGR-2** **Pulse overview** (`GET /admin/pulse/overview?tenantId`) MUST return, per employee, the five dimension groups with status/score/confirmation and a pulse-backlog summary (`doneCount`, `pendingCount`, `totalIgnoreCount`, `nextQuestion`). *(Individual view is admin-scoped, behind `X-Api-Key`.)*
- **FR-MGR-3** **Manager trends** (`GET /admin/manager/trends?tenantId&days`) MUST return time-series (default 14 days, max 120), UTC-day bucketed: daily engagement (active users + inbound volume, excluding `__init__`), daily risk/evidence signals by polarity, funnel, and per-question aggregates.
- **FR-MGR-4** **Group report** (`GroupReportUseCase`) MUST send a team engagement summary to the manager only when confirmed states reach a threshold of `max(5, ceil(0.8 × activeTeamSize))` — otherwise it MUST NOT send.
- **FR-MGR-5** Manager analytics are gated by the `manager_analytics` feature flag.

---

### 3.9 Admin Console

Admin endpoints (all `X-Api-Key`-guarded and audit-logged):
- **FR-ADM-1** Queues: inspect + retry dead-letter jobs (`/admin/queues`, `/admin/queues/dead-letter/:jobId/retry`).
- **FR-ADM-2** LLM runs: observability log of every LLM call (`/admin/llm-runs`) — task type, model, prompt version, token counts, latency, estimated USD cost, status, trace id.
- **FR-ADM-3** Audit logs: append-only compliance query (`/admin/audit-logs`).
- **FR-ADM-4** User debug (`/admin/user-debug`) and per-user insights (`/admin/users/:userId/insights`) — the latter exposes per-question `currentState` (synthesised) + `rootCause` (evidence summary). Viewing MUST be audit-logged.
- **FR-ADM-5** Feature flags (`/admin/feature-flags`): tenant-aware gating; `tenant_id = NULL` is global default, tenant row overrides; `rollout_percentage` uses `MD5(userId) % 100` for stable bucketing.
- **FR-ADM-6** Survey coverage (`/admin/survey/coverage`) and analytics (`/admin/analytics`) MUST enforce the cohort minimum.

---

### 3.10 Privacy, Consent & GDPR

- **FR-PRIV-1** **Right to erasure** — `POST /users/:userId/data-deletion` (202) MUST: anonymize all message text → `[deleted]`; mark memory items deleted + clear content; cancel pending scheduled actions; resolve active risk signals; soft-delete the user; write audit entry. Audit entries themselves are retained.
- **FR-PRIV-2** **Right to portability** — `GET /users/:userId/data-export` MUST return profile (no credentials), last 500 non-deleted messages, active memory, goals, scheduled actions — and MUST exclude system metadata / `encrypted_credentials`.
- **FR-PRIV-3** Consent changes via `PATCH /users/:userId/preferences` (`surveyEnabled`, `proactiveMessagingEnabled`, quiet hours) MUST be audit-logged.
- **FR-PRIV-4** Slack OAuth credentials MUST be stored AES-256-GCM encrypted (`workspace_connections.encrypted_credentials`) via `EncryptionPort`.

---

### 3.11 Dev / Simulation Controls (non-production)

- **FR-DEV-1** A dev-only surface (`/dev/*`, gated by `devControlsEnabled()`) MUST allow `reset-user` (optionally deep) and `force-checkin` for testing. These MUST be disabled outside dev.

---

## 4. Non-Functional Requirements

| Area | Requirement (as-built) |
|------|------------------------|
| **Multi-tenancy** | Every tenant-owned table has `tenant_id NOT NULL` (FK, ON DELETE CASCADE); all queries filter by tenant; no cross-tenant joins. RLS policy documented for enterprise. |
| **Scalability** | Stateless horizontal worker scaling via BullMQ; per-queue concurrency (LLM=1, send=10); read-replica-ready analytics. |
| **Reliability** | At-least-once queue delivery, 3× exponential retry, failed-set DLQ with admin retry. |
| **Cost control** | `gpt-4o-mini` for classification/analysis, `gpt-4o` for generation (~10× cost delta); per-call cost logged in `llm_runs`. |
| **Observability** | `trace_id` links all DB ops + LLM runs for one request; `llm_runs` records tokens/latency/cost. |
| **Security** | HMAC-verified Slack ingress; `X-Api-Key` on admin/user endpoints; AES-256-GCM field encryption; TLS in transit (HTTPS, `rediss://`, TLS Postgres). |
| **Portability** | Ports for AI provider (`AiProviderWithFallback`), queue/outbox (`OutboxPort` → Temporal-ready), encryption (`EncryptionPort` → KMS-ready). |
| **Data retention** | Messages 90d, memory 365d, audit 730d, LLM runs 90d, risk signals per-severity — all tenant-configurable. |

---

## 5. Data Entities (Implemented)

`tenants`, `users`, `workspace_connections`, `channel_accounts`, `conversations`, `messages`,
`memory_items`, `user_goals`, `scheduled_actions`, `risk_signals`,
`survey_definitions`, `survey_questions`, `survey_windows`, `survey_assessments`, `survey_evidence`,
`survey_group_states`, `pulse_backlog`, `style_profiles`, `llm_runs`, `audit_logs`, `feature_flags`.

*(See `DATA_MODEL.md` for column-level detail; `pulse_backlog`, `survey_group_states`, and `style_profiles` back the newer Pulse and style-adaptation capabilities.)*

---

## 6. Feature Flags (Gating Surface)

| Flag | Gates |
|------|-------|
| `memory_extraction` | Memory load + extraction |
| `conversational_survey` | Survey probing + evidence |
| `risk_detection` | Safety pipeline |
| `human_escalation` | Escalation on critical/immediate |
| `proactive_messaging` | Agent-initiated check-ins + follow-ups |
| `manager_analytics` | Manager-facing analytics |
| `vector_retrieval` | (reserved) semantic memory retrieval |

---

## 7. Known Stubs / Boundaries

- **Escalation** is a logging stub (`EscalationStubService`) — no real HR/EAP/PagerDuty integration yet.
- **`vector_retrieval`** flag exists but semantic retrieval is not the active memory path (importance-ranked lookup is).
- **`risk-analysis` queue** is reserved/unused.
- **User self-service memory editing in Slack** is not implemented (API-only today).
- Manager Pulse overview is served under the admin (`X-Api-Key`) surface; a dedicated non-admin manager auth boundary is not yet separated.
