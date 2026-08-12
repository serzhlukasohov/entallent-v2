# Branch Diff File-by-File Review — `feature/conversation-quality-evals`

> Scope: **changed files only** (branch vs `origin/main`).  
> For **full repository** review of all ~220 source files, see [`2026-08-01-full-repo-file-review.md`](./2026-08-01-full-repo-file-review.md).  
> Dimensions: architecture, design patterns, extensibility, performance, security.  
> Companion cleanup plan: [`2026-08-01-thermo-nuclear-confirmation-cleanup.md`](./2026-08-01-thermo-nuclear-confirmation-cleanup.md)  
> Reviewed: 2026-08-01 · Status: **COMPLETE**

**Legend:** `P0` blocker · `P1` high · `P2` medium · `P3` low/nit · `OK` · `GOOD`

**Docs under `docs/superpowers/**` excluded** from per-file depth (plans/specs only).

---

## Progress

| Area | Files | Status |
|------|------:|--------|
| API / config / Docker | 10 | ✅ |
| Application package | 12 | ✅ |
| AI / contracts | 12 | ✅ |
| Worker | 8 | ✅ |
| Dashboard | 6 | ✅ |
| Cross-cutting summary | — | ✅ |

---

## Executive summary (read this first)

### Ship blockers (P0)

1. **`ENABLE_DEV_ENDPOINTS` + unauthenticated `/dev/*`** — `DevSimulateController` has **no** `ApiKeyGuard`. With the flag on in production, anyone who can reach the API can wipe users, force check-ins, backfill (LLM cost), simulate messages.
2. **Always-on `DevControls` + ungated server actions** — dashboard mounts destructive UI for every employee; Next server actions call `/dev/reset-user` / `force-checkin` with no env gate and no dashboard login. API ignores the key on `/dev` anyway.

### Highest P1 (fix before or with merge of confirmation work)

| ID | Issue |
|----|--------|
| A1 | Probe gating ignores `awaitingPresent` on `correct`/`unclear` |
| A2 | `confirmationRequest` forces strategy and **overrides crisis** |
| A3 | Phase B confirm + report runs **before** risk checks |
| A4 | Boolean soup: `confirmationHandled` means “agreed”, not “handled” |
| A5 | Insights `tenantId` query ignored; window lookup userId-only |
| A6 | `PROACTIVE_*_DAYS = 0` allowed in production (spam/cost) |
| A7 | Confirmation evidence unsanitized in respond **system** prompt |
| A8 | Confirm paraphrase vs hard rule “do not summarise” — contradictory prompt |

### What is actually good

- In-conversation confirmation (delete standalone queue/processor) — correct product architecture  
- Dead outbox removed from survey-evidence UC  
- `backfill()` reuses `processMessageWindow`  
- Confirm-interpret prompt properly sandboxes untrusted text  
- Truncation guard + higher survey/memory token budgets  
- Dockerfile `pnpm deploy` lean runners  
- `displayStatus` reconciliation on insights page  

---

## Cross-cutting themes

| Theme | Severity | Where |
|-------|----------|--------|
| Dev/prod escape hatch without auth | P0 | `app.module`, `dev-simulate`, `DevControls`, `actions.ts` |
| Confirmation domain in orchestrator | P1 | `conversation-orchestrator.ts` (+ cleanup plan Tasks 1–2) |
| Probe / crisis / Phase B ordering | P1 | orchestrator |
| Tenant boundary holes | P1 | insights API, reset-user, dashboard actions |
| N+1 evidence / sentiment loops | P2 | orchestrator, survey-evidence |
| Untyped `awaiting_confirmation` status | P2 | ports, records, group-state repo |
| Duplicated DTOs / label maps / RU↔EN | P1–P2 | dashboard + API |
| Prompt injection on confirmation evidence | P2 | `respond.ts` |
| Container runs as root (API/worker) | P2 | Dockerfiles |

---

# 1. API / config / Docker

### `apps/api/Dockerfile`

- **Change:** `pnpm deploy` lean runner; `tsconfig.base.json` + sibling app `package.json` stubs; `CMD node dist/main.js`.
- **Architecture:** Multi-stage; deploy separates build graph from runtime.
- **Extensibility:** New workspace apps may need more stub copies.
- **Performance:** GOOD — no second full prod install in runner.
- **Security:** Runs as root (no `USER`).
- **Findings:**
  - GOOD — deploy-based runner
  - P2 — no non-root user (dashboard does better)
  - P3 — copies full `packages/` into builder (cache churn)
  - OK — sibling package.json stubs intentional

### `apps/worker/Dockerfile`

- Same pattern as API.
- **Findings:** GOOD deploy; P2 no non-root user; OK stubs.

### `apps/dashboard/Dockerfile`

- **Change:** Adds `tsconfig.base.json`; drops brittle `public` copy.
- **Security:** Keeps non-root `nextjs` user — GOOD.
- **Findings:** GOOD remove missing `public`; P3 if `public/` added later must restore COPY.

### `apps/api/src/main.ts`

- **Change:** Debug `console.log` bootstrap milestones.
- **Findings:**
  - P3 — bypasses NestLogger / log levels (looks temporary)
  - OK — migrate-before-listen unchanged; no secrets logged

### `apps/api/src/app.module.ts`

- **Change:** `isDev = NODE_ENV !== 'production' \|\| ENABLE_DEV_ENDPOINTS === 'true'`.
- **Findings:**
  - **P0** — mounts unauthenticated `DevModule` in production when flag set
  - P1 — flag not in `packages/config` env schema (undocumented, untyped)
  - OK — default off unless explicitly set

### `apps/api/src/admin/admin.module.ts`

- **Change:** Registers `UserInsightsController`.
- **Findings:** OK — consistent with other admin controllers + `ApiKeyGuard` provider.

### `apps/api/src/admin/user-insights.controller.ts` *(new)*

- **Change:** `GET admin/users/:userId/insights` — window + questions + assessments + latest evidence.
- **Architecture:** Thin Nest + Drizzle; in-memory joins; DTO colocated (matches other admin controllers; no use-case layer).
- **Extensibility:** Easy to extend shape; hard to reuse (no service). Fake `tenantId` param blocks real multi-tenant filter without API break.
- **Performance:** 4 sequential queries; loads all non-superseded evidence then “latest per question” in JS.
- **Security:** `ApiKeyGuard` present. `tenantId` **ignored** (`_tenantId`). Admin key is global — any userId readable (IDOR-by-design for admin; inconsistent with siblings that filter tenant).
- **Findings:**
  - GOOD — guarded
  - **P1** — unused `tenantId`; no `surveyWindows.tenantId` filter
  - P2 — `limit(1)` active window without `orderBy` (nondeterministic if multiple active)
  - P2 — could parallelize post-window queries; SQL DISTINCT ON for latest evidence
  - P3 — no Zod/validation on params; fat controller

### `apps/api/src/dev/dev-simulate.controller.ts`

- **Change:** Injects survey-evidence queue; adds `force-checkin`, `reset-user` (incl. assessments), `backfill-evidence`.
- **Architecture:** God-controller ops toolbox; direct DB + BullMQ. Comment claims “not in production AppModule” — **now false**.
- **Extensibility:** Easy to pile more ops; no shared auth layer.
- **Performance:** GOOD parallel deletes in reset; sequential `queue.add` loops OK for small N.
- **Security:** **No auth whatsoever.** Combined with P0 flag = remote wipe / spam / LLM cost.
- **Findings:**
  - **P0** — entire `@Controller('dev')` unauthenticated
  - **P0/P1** — `reset-user` hard-deletes by `userId` only (no tenant)
  - **P1** — `force-checkin` without filters = all active conversations
  - **P1** — backfill can stampede LLM; shared `Date.now()` traceId; empty `inboundMessageId` sentinel
  - P2 — stale “dev only” comment
  - GOOD — assessment wipe via window ids fixes stale insights after evidence reset
  - OK — SURVEY_EVIDENCE inject works via global QueueModule

### `packages/config/src/env.ts`

- **Change:** `PROACTIVE_MIN_SILENCE_DAYS` / `PROACTIVE_MIN_GAP_DAYS` allow `0` (`nonnegative`).
- **Findings:**
  - **P1** — `0` valid in production → check-in flood / cost; no `superRefine` tying zeros to non-prod
  - P2 — `ENABLE_DEV_ENDPOINTS` / prod `ADMIN_API_KEY` requiredness still not in schema
  - GOOD — comments mark `0` as testing

### `packages/database/src/migrate.ts`

- **Change:** `connect_timeout: 30`.
- **Findings:** GOOD — prevents hang; P2 migrations path must survive `pnpm deploy` layout; P3 timeout not env-configurable.

### ApiKeyGuard (cross-cutting)

`apps/api/src/auth/api-key.guard.ts`: `X-Api-Key` vs `ADMIN_API_KEY`; prod without key → 401; non-prod without key → allow + warn; `!==` comparison (not timing-safe). Used by insights; **not** by DevSimulateController.

---

# 2. Application package

### `packages/application/src/use-cases/conversation-orchestrator.ts`

- **Change:** Phase B LLM interpret + Phase A woven confirmation; `computeGroupScore` / `collectGroupEvidence`; `topicConfirmed`; force `mode: 'confirmation'`.
- **Architecture:** Hexagonal UC; confirmation domain now lives inside conversation orchestrator (structural regression vs dedicated collaborator — see cleanup plan).
- **Extensibility:** `string | false` + if/else fall-through to agree; unknown verdicts silently confirm; not exhaustive `switch`/`never`.
- **Performance:** Double `findPendingConfirmationGroups`; sequential evidence fetches; open-ended path serial `scoreSentiment` (N+1 AI). Speculative probe fetched even when Phase A discards it.
- **Security / safety:** Confirmation can override crisis; Phase B can confirm+report before risk.
- **Findings:**
  - **P1** — probe gate missing `!phaseB.awaitingPresent` (correct/unclear can still probe)
  - **P1** — `confirmationRequest ? confirmation strategy : buildReplyStrategy` ignores crisis
  - **P1** — Phase B before classify/risk
  - **P1** — misnamed `confirmationHandled` (= agreed only)
  - P2 — awaiting flip after saveMessage, before send (non-atomic)
  - P2 — `awaiting[0]`/`pending[0]` nondeterministic
  - P2 — no exhaustive verdict switch; `correctionNote` discarded
  - P2 — N+1 evidence/sentiment
  - P3 — double pending fetch; Phase A uses raw evidence, Phase B interprets `aiSummary` (wording drift)
  - GOOD — Phase A blocked when `awaitingPresent`; keyword heuristic removed

### `packages/application/src/use-cases/conversation-orchestrator.test.ts` *(new)*

- **Findings:**
  - GOOD — Phase A no-probe when surfacing; unclear blocks second surface; agree → report + topicConfirmed
  - **P1** — missing probe-on-unclear/correct tests
  - P2 — no crisis+confirmation tests; no empty-evidence skip; no atomicity cases
  - P3 — mocks weak for `requiresSafetyCheck` path

### `packages/application/src/use-cases/survey-evidence.use-case.ts`

- **Change:** Drop outbox; `backfill` sliding windows; `processMessageWindow`; mark covered on any saved evidence; reopen re-complete when `in_progress`; write `pending_confirmation` + summary in-process.
- **Architecture:** GOOD split — evidence owns ripe state; conversation owns surface/interpret.
- **Performance:** Backfill ~50 AI windows on 500 msgs; N+1 in `checkGroupCompletion`; extra evidence fetch for backlog mark.
- **Findings:**
  - GOOD — outbox gone; reopen path; chronological windows
  - P1 (product) — earlier probe stop via `markQuestionCovered` on any evidence incl. `partially_covered`
  - P2 — `COMPLETE_STATUSES` includes `partially_covered` → thin groups can go pending
  - P2 — N+1 evidence in group completion
  - P2 — empty evidenceSummaries still upserts pending → Phase A never surfaces
  - P3 — backfill tail guard mostly redundant with current STEP/WINDOW

### `packages/application/src/use-cases/survey-evidence.use-case.test.ts`

- **Findings:** GOOD partially_covered / backfill / pending cases; P2 no `in_progress` re-complete test; P3 incomplete mock vs new port method.

### `packages/application/src/use-cases/group-confirmation.use-case.ts` *(DELETED)*

- **Findings:**
  - GOOD — removes dual-path Slack inject + fake messageId send
  - P2 — behavioral delta: confirmation now waits for next inbound (ops should know)
  - OK — summary generation preserved in survey-evidence

### `packages/application/src/ports/ai-provider.port.ts`

- **Findings:** GOOD JSDoc for confirm-only; P3 `polarity: string` weak; OK.

### `packages/application/src/ports/outbox.port.ts`

- **Findings:** GOOD remove group-confirmation; P2 `inboundMessageId` still required while backfill omits it (schema mismatch).

### `packages/application/src/ports/survey.repository.port.ts`

- **Findings:** GOOD pending vs awaiting split; P2 no orderBy/limit in contract; P3 status comment on records stale.

### `packages/application/src/index.ts`

- **Findings:** GOOD — public API matches deletion.

### `packages/application/src/use-cases/follow-up-execution.test.ts`

- **Findings:** OK — mechanical stub sync.

### `packages/application/src/use-cases/follow-up-scheduler.test.ts`

- **Findings:** OK — mechanical.

### `packages/application/src/use-cases/proactive-check-in.use-case.test.ts`

- **Findings:** OK — mechanical. Note: proactive path still not in Phase A/B (by design for now).

---

# 3. AI / contracts

### `packages/contracts/src/ai.ts`

- **Change:** `ConfirmationResponseSchema`; `confirmation` conversation mode.
- **Findings:** OK; P3 no max length on `correctionNote`; no require note on `correct`.

### `packages/contracts/src/ai.test.ts`

- **Findings:** OK; gap: no `unclear` case; no oversized note reject.

### `packages/ai-openai/src/openai-provider.ts`

- **Change:** Per-call maxTokens (default 2048); survey/memory 4096; confirm 512; truncation throws; opener regenerate-once; `interpretConfirmationResponse`.
- **Findings:**
  - GOOD — truncation + budgets
  - P3 — second bad opener still returned silently
  - OK otherwise

### `packages/ai-openai/src/openai-provider.test.ts`

- **Findings:** OK; gaps: unclear; retry-still-bad; assert confirm maxTokens 512.

### `packages/ai-openai/src/ai-provider-router.ts`

- **Findings:** OK — forwards with fallback.

### `packages/ai-openai/src/index.ts`

- **Findings:** GOOD — export antipatterns for evals/runtime.

### `packages/ai-openai/src/prompts/respond.ts`

- **Change:** `topicConfirmed` / `confirmationRequest` hints; few-shot block; hard rule against reflective openers.
- **Findings:**
  - **P2** — evidence summaries interpolated into **system** prompt unsanitized (sibling `group-confirmation` sanitized)
  - **P2** — confirmation requires 2–4 sentence paraphrase vs Hard rule “Do not summarise…”
  - P3 — IMPORTANT blocks before persona may dominate identity
  - OK — confirm-only companioned by orchestrator `includeFollowUpQuestion: false`

### `packages/ai-openai/src/prompts/respond.test.ts`

- **Findings:** OK; gaps: topicConfirmed; evidence presence; antipattern hard-rule assert.

### `packages/ai-openai/src/prompts/respond-examples.ts`

- **Findings:** GOOD — separated few-shots.

### `packages/ai-openai/src/prompts/confirm-interpret.ts`

- **Findings:** **GOOD** — sanitize + injection guard + untrusted fences. Primary injection watch handled correctly here.

### `packages/ai-openai/src/prompts/style-antipatterns.ts`

- **Findings:** OK; P3 `/^похоже,/i` requires comma — `Похоже это…` may slip. Comment claims “runtime gate and evals” — runtime exists in provider (one retry); honest enough if kept.

### `packages/ai-openai/src/prompts/style-antipatterns.test.ts`

- **Findings:** GOOD; could add comma-less Похоже / Latin “Sounds like”.

---

# 4. Worker

### `apps/worker/src/conversation/ai.service.ts`

- **Findings:** OK — thin port adapter for interpret.

### `apps/worker/src/conversation/outbox.service.ts`

- **Findings:** GOOD — group-confirmation enqueue removed; aligns with port.

### `apps/worker/src/queue/queue.module.ts`

- **Findings:** OK — QUEUE_NAMES + registerQueue cleaned. P3 — drain leftover Redis `group-confirmation` jobs in deployed envs.

### `apps/worker/src/survey/survey.module.ts`

- **Findings:** GOOD — processor + fake SurveyOutboxAdapter gone; evidence UC arity matches.

### `apps/worker/src/survey/survey-evidence.processor.ts`

- **Change:** `mode === 'backfill'` branch; better error logging.
- **Findings:** OK; P3 unknown mode falls through to live execute; backfill cost relies on trusted enqueue (dev path is the risk).

### `apps/worker/src/survey/repositories/group-state.repository.ts`

- **Change:** `findAwaitingConfirmationGroups`.
- **Findings:** OK query / no N+1; **P2** untyped status string; P3 no orderBy.

### `apps/worker/src/survey/repositories/survey.repository.ts`

- **Findings:** OK — facade delegate.

### `apps/worker/src/survey/group-confirmation.processor.ts` *(DELETED)*

- **Findings:** GOOD deletion if in-band confirmation is product intent (it is); P3 ops drain Redis queue; Nest wiring removal is complete.

---

# 5. Dashboard

### Security context (`apps/dashboard/src/app/lib.ts`)

- No dashboard login; server uses `ADMIN_API_KEY` for admin API.
- Trust model: network ACL / VPN. Destructive DevControls raise the bar for that model.
- `/dev/*` ignores API key even when sent.

### `apps/dashboard/src/app/pulse/page.tsx`

- **Change:** Link to insights; always mounts `DevControls`.
- **Findings:**
  - **P0** — DevControls ungated
  - P1 — RU/EN mix (“→ инсайты” vs EN insights page)
  - P2 — duplicate GROUP_LABELS vs insights (different languages)
  - GOOD — `fetchApi(..., 0)` freshness after reset
  - OK — navigation link

### `apps/dashboard/src/app/pulse/DevControls.tsx` *(new)*

- **Findings:**
  - **P0** — not gated by env
  - P1 — no confirm dialog for deep wipe
  - P2 — shared status overwrites messages
  - P3 — `React.CSSProperties` without import; mixed RU/EN strings

### `apps/dashboard/src/app/pulse/actions.ts` *(new)*

- **Findings:**
  - **P0** — ungated server actions → destructive `/dev`
  - **P0** — defense-in-depth absent (API also unauthed)
  - P1 — no `userId`/`tenantId` validation vs `TENANT_ID`
  - P1 — API error bodies forwarded to client
  - P2 — duplicated env constants vs `lib.ts`
  - P2 — `revalidatePath('/pulse')` only (not `/pulse/[userId]`)
  - P3 — loose `as Record<string, number>`

### `apps/dashboard/src/app/pulse/[userId]/page.tsx` *(new)*

- **Findings:**
  - GOOD — `displayStatus` drift handling; `cache=0`
  - P1 — mixed RU/EN labels; no tenant in fetch URL
  - P2 — GROUP_LABELS EN vs overview RU; legend/label inconsistency
  - P3 — no encodeURIComponent (OK for UUIDs)
  - OK — empty states

### `apps/dashboard/src/app/types.ts`

- **Findings:** P2 duplicated DTOs vs API; P3 stringly `assessmentStatus`/`polarity`; OK additive; GOOD pulse types untouched.

### `apps/dashboard/src/app/components/TeamTable.tsx`

- **Findings:** P2 “Not yet covered” EN next to RU copy; OK useful count; P3 no link to insights from team table.

---

# 6. Recommended fix order

Aligns with cleanup plan; security first where it diverges:

| Priority | Action | Plan task |
|----------|--------|-----------|
| 1 | Gate `/dev` with `ApiKeyGuard` **or** refuse `ENABLE_DEV_ENDPOINTS` in prod without auth; gate DevControls + server actions | Task 4 (+ security hotfix) |
| 2 | Extract `GroupConfirmationService` + `ConfirmationTurn`; fix probe/crisis/Phase B order | Tasks 1–2 |
| 3 | Shared `loadLatestGroupEvidence`; atomic awaiting | Tasks 2–3 |
| 4 | Sanitize confirmation evidence in respond; resolve paraphrase vs hard-rule | (prompt follow-up) |
| 5 | Tenant on insights; typed group status; shared DTO; opener honesty | Task 5 |
| 6 | Docker non-root for API/worker; drain Redis queue; env schema for flags | ops / chore |

---

# 7. File checklist (all non-doc changed files)

| File | Status | Top severity |
|------|--------|--------------|
| `apps/api/Dockerfile` | ✅ | P2 |
| `apps/api/src/main.ts` | ✅ | P3 |
| `apps/api/src/app.module.ts` | ✅ | **P0** |
| `apps/api/src/admin/admin.module.ts` | ✅ | OK |
| `apps/api/src/admin/user-insights.controller.ts` | ✅ | P1 |
| `apps/api/src/dev/dev-simulate.controller.ts` | ✅ | **P0** |
| `apps/worker/Dockerfile` | ✅ | P2 |
| `apps/dashboard/Dockerfile` | ✅ | OK |
| `packages/config/src/env.ts` | ✅ | P1 |
| `packages/database/src/migrate.ts` | ✅ | P2 |
| `packages/application/.../conversation-orchestrator.ts` | ✅ | P1 |
| `packages/application/.../conversation-orchestrator.test.ts` | ✅ | P1 |
| `packages/application/.../survey-evidence.use-case.ts` | ✅ | P1 product / P2 |
| `packages/application/.../survey-evidence.use-case.test.ts` | ✅ | P2 |
| `packages/application/.../group-confirmation.use-case.ts` | ✅ deleted | GOOD |
| `packages/application/.../ai-provider.port.ts` | ✅ | P3 |
| `packages/application/.../outbox.port.ts` | ✅ | P2 |
| `packages/application/.../survey.repository.port.ts` | ✅ | P2 |
| `packages/application/src/index.ts` | ✅ | GOOD |
| `packages/application/.../follow-up-*.test.ts` | ✅ | OK |
| `packages/application/.../proactive-check-in.use-case.test.ts` | ✅ | OK |
| `packages/contracts/src/ai.ts` | ✅ | P3 |
| `packages/contracts/src/ai.test.ts` | ✅ | OK |
| `packages/ai-openai/src/openai-provider.ts` | ✅ | P3 |
| `packages/ai-openai/src/openai-provider.test.ts` | ✅ | OK |
| `packages/ai-openai/src/ai-provider-router.ts` | ✅ | OK |
| `packages/ai-openai/src/index.ts` | ✅ | GOOD |
| `packages/ai-openai/src/prompts/respond.ts` | ✅ | P2 |
| `packages/ai-openai/src/prompts/respond.test.ts` | ✅ | OK |
| `packages/ai-openai/src/prompts/respond-examples.ts` | ✅ | GOOD |
| `packages/ai-openai/src/prompts/confirm-interpret.ts` | ✅ | GOOD |
| `packages/ai-openai/src/prompts/style-antipatterns.ts` | ✅ | P3 |
| `packages/ai-openai/src/prompts/style-antipatterns.test.ts` | ✅ | GOOD |
| `apps/worker/.../ai.service.ts` | ✅ | OK |
| `apps/worker/.../outbox.service.ts` | ✅ | GOOD |
| `apps/worker/.../queue.module.ts` | ✅ | OK |
| `apps/worker/.../survey.module.ts` | ✅ | GOOD |
| `apps/worker/.../survey-evidence.processor.ts` | ✅ | P3 |
| `apps/worker/.../group-state.repository.ts` | ✅ | P2 |
| `apps/worker/.../survey.repository.ts` | ✅ | OK |
| `apps/worker/.../group-confirmation.processor.ts` | ✅ deleted | GOOD |
| `apps/dashboard/.../pulse/page.tsx` | ✅ | **P0** |
| `apps/dashboard/.../DevControls.tsx` | ✅ | **P0** |
| `apps/dashboard/.../actions.ts` | ✅ | **P0** |
| `apps/dashboard/.../pulse/[userId]/page.tsx` | ✅ | P1 |
| `apps/dashboard/.../types.ts` | ✅ | P2 |
| `apps/dashboard/.../TeamTable.tsx` | ✅ | P2 |

**Verdict:** Do not treat this branch as merge-ready until **P0 dev/security gates** are fixed. Confirmation product direction is sound; structure and safety ordering need the cleanup plan (Tasks 1–2) plus prompt P2s before calling the confirmation UX done.
