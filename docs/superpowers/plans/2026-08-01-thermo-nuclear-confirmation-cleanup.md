# Thermo-Nuclear Cleanup — Confirmation Orchestrator + Follow-ups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Source:** [Thermo-nuclear code quality review](chat) on `feature/conversation-quality-evals` vs `origin/main` (2026-08-01). Verdict: **REQUEST CHANGES**.

**Goal:** Keep in-conversation group confirmation (product decision is correct), but remove structural debt: extract confirmation out of `ConversationOrchestrator`, replace boolean soup with a typed turn model, make awaiting transition atomic, dedupe evidence loading, and tighten dev/prod boundaries.

**Architecture:** Introduce a `GroupConfirmationService` (or `ConfirmationTurnResolver`) in `@entalent/application` that owns Phase A/B, scoring, and evidence collection. Orchestrator only calls `resolveIncoming` / `maybeSurface` and maps the resulting discriminated union into strategy + `ResponseContext`. Shared `loadLatestGroupEvidence` helper becomes the canonical path for confirmation, scoring, and group-summary evidence.

**Tech Stack:** TypeScript, Vitest, existing NestJS worker wiring for application use-cases.

**Out of scope for this plan (keep as-is):** deleting the standalone confirmation queue/processor; `backfill()` / `processMessageWindow` shape; `ConfirmationResponse` + `confirm-interpret` prompts; Dockerfile `pnpm deploy` changes; conversation-quality evals / few-shot examples (except honesty about “runtime gate”).

## Global Constraints

- Package manager: `pnpm` with workspace filters. Tests: `pnpm --filter @entalent/application test` (and sibling packages as needed).
- Preserve current product behavior: agree → score/confirm/report; correct → reopen `in_progress`; unclear → stay awaiting, no second Phase A surface; confirm-only reply has no survey probe.
- Do **not** reintroduce `enqueueGroupConfirmation` / standalone processor.
- Prefer deleting flags over renaming them. Prefer one discriminated union over `string | false`.
- Exhaustive `switch` with `never` default for new unions/enums (workspace rule).

---

## Quick checklist (tracking)

### Blockers
- [ ] Extract confirmation domain into collaborator + typed `ConfirmationTurn`
- [ ] Remove `confirmedGroup: string | false` / misnamed `confirmationHandled`
- [ ] Gate probes from the same turn model (no probe while `still_awaiting`)
- [ ] Atomic awaiting transition (no second `findPendingConfirmationGroups` after send)

### High
- [ ] Shared `loadLatestGroupEvidence` helper (orchestrator ×2 + survey-evidence)
- [ ] Gate `DevControls` behind dashboard env / omit in production builds
- [ ] Revisit `ENABLE_DEV_ENDPOINTS` + destructive ops UX (don't show dead buttons)

### Medium
- [ ] Typed group status union (incl. `awaiting_confirmation`) on records/ports
- [ ] Shared insights DTO (contracts) — stop duplicating API ↔ dashboard
- [ ] Enforce or drop ignored `tenantId` on user-insights
- [ ] Honest opener antipatterns story (wire runtime gate **or** drop claim)
- [ ] Explicit `canCompleteGroup(status)` for reopen / completion policy
- [ ] Localize or unify RU/EN labels on pulse insights page (optional polish)

### Explicitly good — do not undo
- In-conversation confirmation (no separate Slack inject job)
- Dead outbox removed from `SurveyEvidenceExtractionUseCase`
- `processMessageWindow` + `backfill()` reuse
- Phase A/B tests for “don’t surface second confirmation while awaiting” (extend for probe policy)

---

## Target model

```ts
/** Discriminated turn produced before strategy/reply generation. */
export type ConfirmationTurn =
  | { kind: 'idle' }
  | { kind: 'still_awaiting'; group: string } // unclear; suppress Phase A + probe
  | { kind: 'reopened'; group: string }       // correct; suppress Phase A; policy: probe OK or not (pick one, document)
  | { kind: 'confirmed'; group: string; employeeScore?: number }
  | {
      kind: 'surface';
      group: SurveyGroupStateRecord; // cached — used for awaiting flip, no re-fetch
      evidence: Array<{ stableKey: string; evidenceSummary: string; polarity: string }>;
    };

export type SurveyGroupStatus =
  | 'in_progress'
  | 'pending_confirmation'
  | 'awaiting_confirmation'
  | 'confirmed';
  // …any other existing statuses kept explicitly
```

**Probe / Phase A policy (lock this in code + tests):**

| Turn kind | Phase A surface | Survey probe | Reply hints |
|-----------|-----------------|--------------|-------------|
| `idle` | allowed if pending | normal rules | — |
| `still_awaiting` | no | **no** | optional re-ask; no `topicConfirmed` |
| `reopened` | no | yes (default) | — |
| `confirmed` | no | no | `topicConfirmed` |
| `surface` | (this is the surface) | no | `confirmation` mode + `confirmationRequest` |

---

## File structure (intended end state)

| File | Responsibility |
|------|----------------|
| `packages/application/src/services/group-confirmation.service.ts` | **NEW** — `resolveIncoming`, `maybeSurface`, mark awaiting, score/confirm/report |
| `packages/application/src/utils/group-evidence.ts` (or survey repo method) | **NEW** — `loadLatestGroupEvidence` |
| `packages/application/src/use-cases/conversation-orchestrator.ts` | Thin: call service, map turn → strategy/`ResponseContext`, send |
| `packages/application/src/use-cases/survey-evidence.use-case.ts` | Use shared evidence helper; `canCompleteGroup` |
| `packages/application/src/types/records.ts` (or ports) | Typed `SurveyGroupStatus` |
| `packages/contracts/...` | Shared `QuestionInsight` / `UserInsightsResponse` if moved |
| `apps/dashboard/src/app/pulse/page.tsx` + `DevControls.tsx` | Env-gated dev UI |
| `apps/api/src/admin/user-insights.controller.ts` | Tenant scope or drop param; import shared DTO |

---

### Task 1: Typed `ConfirmationTurn` + extract `GroupConfirmationService`

**Files:**
- Create: `packages/application/src/services/group-confirmation.service.ts`
- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts`
- Modify: `packages/application/src/index.ts` (export if needed by worker wiring)
- Test: `packages/application/src/use-cases/conversation-orchestrator.test.ts` (+ unit tests for the service if easier)

**Interfaces:**
- Consumes: `SurveyRepositoryPort`, `AiProviderPort`, `OutboxPort` (group report only)
- Produces:
  - `resolveIncoming(userId, tenantId, turns, traceId?): Promise<ConfirmationTurn>`
  - `maybeSurface(userId): Promise<Extract<ConfirmationTurn, { kind: 'surface' }> | { kind: 'idle' }>`
  - `markAwaiting(group: SurveyGroupStateRecord): Promise<void>` — uses cached record, no re-list

- [ ] **Step 1:** Add failing tests for probe suppression on `still_awaiting` (and for Phase A still suppressed).
- [ ] **Step 2:** Move `handleAwaitingConfirmation`, `computeGroupScore`, `collectGroupEvidence` into the service; return `ConfirmationTurn` instead of `{ confirmedGroup: string | false; awaitingPresent: boolean }`.
- [ ] **Step 3:** Orchestrator flow:
  1. `const incoming = await confirmation.resolveIncoming(...)`
  2. classify / risk / speculative probe as today
  3. `const surface = incoming.kind === 'idle' ? await confirmation.maybeSurface(userId) : { kind: 'idle' }`
  4. `const turn = surface.kind === 'surface' ? surface : incoming`
  5. Pure mapper: turn → `{ strategy, responseContext extras, allowProbe }`
  6. After successful generate (or before — see Task 2): if `turn.kind === 'surface'`, `await confirmation.markAwaiting(turn.group)`
- [ ] **Step 4:** Delete `confirmationHandled`, `confirmedGroup`, Phase A/B comment soup.
- [ ] **Step 5:** Run `pnpm --filter @entalent/application test` — all green.
- [ ] **Step 6:** Commit: `refactor(application): extract GroupConfirmationService + ConfirmationTurn`

---

### Task 2: Atomic awaiting transition

**Files:**
- Modify: `packages/application/src/services/group-confirmation.service.ts`
- Modify: `packages/application/src/use-cases/conversation-orchestrator.ts`
- Test: orchestrator / service tests for crash-between-send-and-upsert scenario (behavioral: mark awaiting **before** enqueue send, or upsert with cached record immediately after generate using `turn.group` — never `findPendingConfirmationGroups` again)

- [ ] **Step 1:** Prefer transition `pending_confirmation → awaiting_confirmation` **before** `enqueueMessageSend`, using the cached `SurveyGroupStateRecord` from `maybeSurface`.
- [ ] **Step 2:** Remove the post-reply second fetch block (~lines 251–263 in current orchestrator).
- [ ] **Step 3:** Add/adjust test: surface path upserts awaiting with the same window/group ids returned by the first pending lookup (mock assert: `findPendingConfirmationGroups` called once per turn, not twice).
- [ ] **Step 4:** Commit: `fix(survey): mark awaiting_confirmation atomically with confirmation surface`

---

### Task 3: Shared `loadLatestGroupEvidence`

**Files:**
- Create: `packages/application/src/utils/group-evidence.ts` (or method on survey port + repo impl)
- Modify: confirmation service scoring/surface paths
- Modify: `packages/application/src/use-cases/survey-evidence.use-case.ts` (`checkGroupCompletion` summaries)
- Test: small unit test for “latest by createdAt per question”

- [ ] **Step 1:** Implement `loadLatestGroupEvidence(surveyRepo, userId, windowId, questionGroup)` with `Promise.all` per question.
- [ ] **Step 2:** Replace the three copy-pasted loops.
- [ ] **Step 3:** Commit: `refactor(survey): shared loadLatestGroupEvidence helper`

---

### Task 4: DevControls + ENABLE_DEV_ENDPOINTS boundary

**Files:**
- Modify: `apps/dashboard/src/app/pulse/page.tsx`
- Modify: `apps/dashboard/src/app/pulse/DevControls.tsx` (optional: early-return null)
- Optionally: document env in dashboard README / `.env.example`

- [ ] **Step 1:** Render `DevControls` only when `process.env.ENABLE_DEV_CONTROLS === 'true'` (or mirror API's `ENABLE_DEV_ENDPOINTS` via `NEXT_PUBLIC_` / server-only check in the RSC page).
- [ ] **Step 2:** Default off in production; no buttons that always fail.
- [ ] **Step 3:** Commit: `fix(dashboard): gate DevControls behind env flag`

---

### Task 5: Types, insights DTO, tenant scope, opener honesty

**Files:**
- Modify: `packages/application` group state record / port status typing
- Modify: `apps/api/src/admin/user-insights.controller.ts`
- Modify: `apps/dashboard/src/app/types.ts` (import shared or delete dup)
- Modify: `packages/ai-openai/src/prompts/style-antipatterns.ts` comments **or** wire post-generate check
- Modify: `packages/application/src/use-cases/survey-evidence.use-case.ts` — `canCompleteGroup`

- [ ] **Step 1:** `SurveyGroupStatus` union + update upsert/find signatures; exhaustive handling in `canCompleteGroup`.
- [ ] **Step 2:** Either filter insights queries by `tenantId` (required) or remove the unused query param.
- [ ] **Step 3:** Move `QuestionInsight` / `UserInsightsResponse` to a shared package **or** keep dashboard types as re-exports from one place — no divergent copies.
- [ ] **Step 4:** Opener antipatterns: change comment to “eval/shared detector only” **or** add a real post-generate reject/retry — pick one.
- [ ] **Step 5:** Commit: `chore: tighten survey status types, insights contract, opener docs`

---

## Verification (before considering the review bar met)

- [ ] `pnpm --filter @entalent/application test`
- [ ] `pnpm --filter @entalent/ai-openai test`
- [ ] Worker still builds: `pnpm --filter @entalent/worker build`
- [ ] Manual/scenario: unclear while awaiting → no second confirmation + no probe
- [ ] Manual/scenario: surface → status `awaiting_confirmation` even if send enqueue fails after mark (document chosen ordering)
- [ ] Dashboard production build: no DevControls when flag unset

## Approval bar (from original review)

| Criterion | Done when |
|-----------|-----------|
| No confirmation domain in orchestrator guts | Task 1 |
| No boolean soup / probe hole | Task 1 |
| Atomic awaiting | Task 2 |
| No triple evidence loops | Task 3 |
| Dev UI not always-on | Task 4 |
| Types / DTO / tenant / opener honesty | Task 5 |

---

## Suggested execution order

1 → 2 → 3 (core structural / blockers), then 4 (safety), then 5 (types & contracts). Tasks 4 and 5 can run in parallel after 1–3.
`}