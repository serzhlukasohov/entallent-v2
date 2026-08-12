# Extended Verification — CI, Integration, Evals, Schema, Queues, Threat Model

> Completed: 2026-08-01 · Status: **DONE**  
> Follows: [`2026-08-01-verification-pass.md`](./2026-08-01-verification-pass.md)  
> Agents: [Eval/prompt coverage](0bddef83-78a6-41a5-bb0c-f8cd4cbc6b35) · [Schema/queues/threat](a781da49-8e77-4baf-b20f-ee43d8e05420)

---

## Progress

| Check | Status |
|-------|--------|
| CI on PR / branch | ⚠️ **No PR** for `feature/conversation-quality-evals` → no GitHub Actions runs. Workflow exists and would run on PR to `main`/`develop`. |
| Integration tests | ✅ **10 passed** locally (with `DATABASE_URL`). Skipped without env. |
| Smoke / E2E | ❌ **None** — no Playwright/Cypress; only `scripts/chat.ts` |
| Prompt / eval coverage | ✅ Reviewed — foundation ~80% code / ~40% proven as gate |
| Schema & migrations | ✅ Reviewed |
| Queue & idempotency | ✅ Reviewed |
| Threat model (deeper) | ✅ Reviewed |
| Deslop / PR readiness | ✅ Reviewed |
| Complexity / hot paths | ✅ Reviewed |
| Lint (sample) | ❌ `@entalent/application` lint **FAIL** — 8× `@typescript-eslint/no-explicit-any` in tests |

---

## Executive verdict

This pass did **not** invent many new P0s — it **confirmed** the verification-pass cluster and added:

1. **CI blind spot:** no PR → no automated quality/integration gate until opened.  
2. **Lint will fail CI** on `application` test `any`s.  
3. **Evals goal of the branch is incomplete as a regression gate** (baseline deferred, thin naturalness suite, no confirm/crisis promptfoo).  
4. **Schema/queue races:** no unique on assessments/active window; no Bull `jobId` on hot paths → duplicate Slack/evidence under retry.  
5. **No E2E/smoke** tooling at all.

**Merge readiness:** still blocked on P0 auth (dev endpoints, DevControls, insights tenant) + recommended fix lint before opening PR.

---

## 1. CI

### Workflow (`.github/workflows/ci.yml`)

| Job | What |
|-----|------|
| `quality` | build (excl. api/worker), typecheck, lint, `pnpm test` |
| `integration` | Postgres (pgvector) + Redis services → migrate → `pnpm test:integration` |

**Triggers:** push to `main`/`develop`, PRs targeting those branches.

### Branch state

- Branch: `feature/conversation-quality-evals`
- **`gh pr view`:** no PR
- **`gh run list`:** empty for this branch

→ Local green typecheck/unit tests are **not** validated by GitHub until a PR exists.

### Predicted CI failures (from local sample)

| Check | Prediction |
|-------|------------|
| Typecheck | PASS (verified earlier) |
| Unit tests | PASS (121 core) |
| Lint | **FAIL** on `@entalent/application` (8 `no-explicit-any` in orchestrator + survey-evidence tests) |
| Integration | PASS if services healthy (local 10/10 with DB) |
| AI evals | **Not in CI** — `EVALS.md` shows suggested step, not wired |

---

## 2. Integration tests

| Suite | Result |
|-------|--------|
| `tenant.integration.test.ts` | 7 passed |
| `memory.integration.test.ts` | 3 passed |

**Gaps:** no integration coverage for survey evidence, group confirmation states, Slack ingest idempotency, GDPR deletion, or admin insights tenant isolation. Only tenant/user/memory smoke against real Postgres.

**Local note:** without `DATABASE_URL`, suites **skip** (not fail) via `describeIntegration`.

---

## 3. Smoke / E2E

| Tool | Present? |
|------|----------|
| Playwright / Cypress | No |
| Dashboard smoke | No |
| API health e2e | No |
| Manual helpers | `scripts/chat.ts`, `scripts/setup-slack-workspace.mjs`, dashboard DevControls |

---

## 4. Prompt / eval coverage

**Branch named goal:** measurable style/naturalness + confirmation-in-conversation.

### What shipped (style)

| Piece | Status |
|-------|--------|
| `style-antipatterns` + `hasReflectiveOpener` | Done |
| Few-shot BAD→GOOD (2 pairs; design wanted 3–4) | Thin but done |
| Opener gate (regen once) | Done + unit tests |
| Real-prompt provider `evals/providers/respond-prompt.js` | Done |
| `naturalness.yaml` | **2 cases only** + llm-rubric |
| Live baseline pass rate | **Deferred** (needs `OPENAI_API_KEY`) |
| `EVALS.md` updated | **No** — still lists old 5 datasets, claims JS-only asserts |

### Confirmation / probe / crisis (eval gaps)

| Area | Code | Eval/unit gap |
|------|------|----------------|
| Phase A surface + no probe | Implemented | 1 unit test; no promptfoo |
| Phase B agree/correct/unclear | Implemented | Thin units; unclear parsing untested in provider |
| Probe while `awaitingPresent` | **Bug** (confirmed earlier) | **No test** |
| Crisis × probe | Gated in orchestrator | **No orchestrator test**; safety.yaml is stub prompt |
| Crisis × confirmation mode | Confirm can override crisis strategy | Untested product risk |
| Unsanitized `evidenceSummary` in `respond.ts` | **Prompt injection risk** | Contrast: `group-confirmation.ts` / `confirm-interpret.ts` sanitize |

### Verdict on evals goal

**~80% engineered / ~40% proven as a gate.** Foundation is real; not yet a reliable regression loop for conversation quality or confirmation behavior.

**Highest-leverage next (evals):** sanitize confirmation evidence in respond · run/record naturalness baseline · orchestrator tests for unclear/probe/crisis · small confirm+interpret promptfoo suite · refresh `EVALS.md`.

---

## 5. Schema & migrations

Migrations present: `0000_initial`, `0001_feature_flags`, `0002_pulse_check_groups`, `0003_pulse_backlog`.

| Sev | Finding |
|-----|---------|
| P1 | `survey_evidence` — no dedup unique; app-level supersede only → duplicate rows under concurrency/retry |
| P1 | `survey_assessments` — no UNIQUE `(window_id, question_id)`; upsert is select-then-write race |
| P1 | No DB constraint for single `active` survey window per user |
| P1 | Message reads may ignore `deletedAt` → GDPR `[deleted]` text can re-enter LLM/backfill |
| P2 | `survey_definitions.tenant_id` nullable (global defs — OK if intentional) |
| P2 | `team_memberships` — possible duplicate active memberships |
| OK | `pulse_backlog`, `survey_group_states` uniques look solid |

---

## 6. Queue & idempotency

| Sev | Finding |
|-----|---------|
| **P0** | Hot-path `.add(...)` **without `jobId`**: conversation, message-send, survey-evidence, memory, follow-up, group-report. Only proactive scan uses fixed `jobId`. Retries → duplicate Slack / duplicate evidence |
| P1 | `message-send` not delivery-idempotent after partial Slack success |
| P1 | Backfill mode: overlapping windows + no jobId → cost/dupe amplification |
| P1 | Admin `queues.controller` list stale (missing live queues) |
| P2 | Drain leftover Redis `bull:group-confirmation:*` in deployed envs; docs still mention old path |
| OK | Default `attempts: 3`, exponential backoff |

---

## 7. Threat model (deeper)

**Trust boundaries:** Slack HMAC → ingest → Bull → worker (bot tokens) → DB · Dashboard/admin → shared `ADMIN_API_KEY` + caller `tenantId` · optional `/dev/*` in prod.

| Scenario | L | I | Sev |
|----------|---|---|-----|
| `ENABLE_DEV_ENDPOINTS` + unauthenticated `/dev/*` wipe/check-in/backfill | Med | Crit | **P0** |
| Always-on DevControls → server actions → `/dev/*` with server API key | High* | Crit | **P0** |
| Insights ignores `tenantId` | High | High | **P0** |
| Shared `ADMIN_API_KEY` = cross-tenant if any endpoint trusts client `tenantId` only | Med | High | **P0/P1** |
| Slack verify fail-open without `rawBody` | Low–Med | High | **P1** |
| `force-checkin` without tenant → all tenants | Med | High | **P1** |
| GDPR delete/export omit survey/pulse tables | High (compliance) | High | **P1** |
| Soft-deleted messages fed to models | Med | Med | **P1** |

\*If dashboard is network-reachable without auth (current README posture).

---

## 8. Deslop / PR readiness

| Item | Sev |
|------|-----|
| DevControls always rendered on Pulse | **P0** ship blocker |
| `console.log` bootstrap noise in `main.ts` | P1 |
| Mixed RU/EN UI strings | P2 |
| Stale group-confirmation docs/plans | P2 |
| Branch is large: ~57 files, +5918/−345 vs `origin/main` — hard to review as one PR | P2 process |

**Suggestion:** split or at least open PR now so CI runs; keep auth fixes in first reviewable chunk.

---

## 9. Complexity / hot paths

| File | Lines | Note |
|------|------:|------|
| `conversation-orchestrator.ts` | 533 | Phase A/B confirmation + classify + probe + risk — thermo-nuclear god-object still valid |
| `dev-simulate.controller.ts` | 515 | Growing unauthenticated surface |
| `survey-evidence.use-case.ts` | 269 | Live + backfill paths |
| `respond.ts` | 137 | Dense prompt assembly; confirmation/probe/crisis branches |

LLM fan-out per inbound turn remains high (classify ± risk ± respond ± evidence job ± memory). Confirmation interpretation adds another LLM call when awaiting.

---

## 10. Consolidated new/reinforced backlog

### Do before opening PR to main (or immediately after)

1. Fix application lint `any`s (or CI stays red).  
2. Open PR so quality + integration CI actually run.  
3. **P0 auth trio** (dev guard, DevControls gate, insights tenant) — unchanged from verification pass.

### Do next (product + reliability)

4. Probe gate: `!phaseB.awaitingPresent`.  
5. Bull `jobId`s on message-send / conversation / survey-evidence.  
6. Sanitize confirmation evidence in `respond.ts`.  
7. Schema uniques: assessments + consider active-window constraint.  
8. Filter `deletedAt` on message reads used by LLM.  
9. GDPR survey wipe/export.  
10. Grow naturalness suite + record baseline; add confirm/interpret evals; update `EVALS.md`.  
11. Extract `GroupConfirmationService` (thermo-nuclear plan).

### Optional

12. Add minimal Playwright smoke (Pulse load + insights page).  
13. Wire promptfoo to CI (nightly / optional PR job with cheap model).  
14. Bump `next` / `@fastify/middie` from prior audit.

---

## Cross-check: prior docs still valid?

| Doc | Still valid? |
|-----|--------------|
| Thermo-nuclear cleanup plan | Yes — not implemented |
| Full-repo file review P0s | Yes — reconfirmed |
| Verification pass | Yes — extended here |
| Conversation-quality evals design | Partially shipped; measurement loop incomplete |

---

## Suggested next step

1. Fix lint → open PR → watch CI.  
2. Or implement **P0 auth trio** first, then open PR.  

Say which track to start.
