---
title: 'Dashboard QA aids: signal author, status legend, full person map, data freshness'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: 'NO_VCS' # uncommitted tree; pre-change copies in session scratchpad spec5-before/
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard is an internal testing tool (not shown to the customer). Testers cannot quickly:
- tell whose conversation produced a Team Signal, to compare the raw chat with its de-identified result;
- decode what each status, colour and number means;
- see one participant's whole journey across all 12 topics;
- know how fresh the data is while chatting with the bot.

**Approach:**
- Show every Team Signal's author through a separate, explicitly QA-only endpoint (`GET /admin/v2-pilot/qa/team-signals`) that returns the same signals with `author {userId, displayName}` resolved in the same query. The de-identified `/admin/v2-pilot/team-signals` contract stays clean, with no join key (human decision 2026-10-15 after review found `insightId` re-identified signals).
- Add a "Как читать" legend.
- Turn `/pulse/[userId]` into a full 12-topic map.
- Show the check time, a refresh link, and each person's last inbound message time.

## Boundaries & Constraints

**Always:**
- QA-only, behind the existing QA flag + pilot-tenant gate. UI copy in Russian.
- `/admin/v2-pilot/team-signals` is unchanged from spec 2: no user id, name, insight id, or other join key.
- The new QA endpoint uses the same cohort resolution, population, and order as team-signals, plus `author`. It is documented as QA-only and protected by the same guards as `/admin/v2-pilot/people`. The dashboard calls it only under the QA flag and the pilot-tenant gate.
- `/admin/v2-pilot/people`: each person gains `lastInboundAt`, the latest inbound message inside the cycle period, or null. No per-question insight id.
- When the QA signals fetch fails, signals show as unavailable; nothing is guessed from other data.
- Refresh is a plain link to the same URL. No client polling.

**Ask First:** Any migration, worker change, or exposing these fields outside the QA view.

**Never:**
- No author join by summary text or topic.
- No auto-refresh timers.
- Do not change counts or existing gates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signal with author | QA endpoint row | Signal card shows "Автор: Анна С." linking to `/pulse/[userId]` | N/A |
| QA signals unavailable | QA fetch null | Signals side shows the existing unavailable state; no author text | null-safe |
| Person map | `/pulse/[userId]` | 12 topics grouped by group; each shows a status badge, then either the draft text, or the de-identified final with score/outcome, or "Нет данных" | N/A |
| Freshness | Any pulse page | "Проверено в HH:MM (Варшава) · Обновить"; people show "последнее сообщение: DD.MM HH:MM" or "сообщений нет" | null-safe |
| Legend | `/pulse` and `/pulse/[userId]` | Collapsed "Как читать" (details): stage flow, badge colours, score 0–100, what "обезличено" means | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/admin/v2-pilot.read-model.ts` -- people SQL (insight lateral at ~L107, inbound lateral at ~L87) and team-signals SQL (~L147); the projections
- `apps/api/src/admin/v2-pilot.read-model.test.ts` -- projection tests to extend
- `packages/contracts/src/admin-v2-pilot-people.ts`, `admin-v2-pilot-team-signals.ts` -- add the fields
- `apps/dashboard/src/app/v2-pilot-progress.ts` (+ test) -- `buildTopicRows` and the helpers; add the author join and freshness formatters
- `apps/dashboard/src/app/pulse/page.tsx`, `pulse/[userId]/page.tsx`, `components/ui.tsx` -- UI

## Tasks & Acceptance

**Execution:**
- [x] Contracts -- `AdminV2PilotTeamSignal.insightId: string`, `AdminV2PilotPersonQuestion.insightId: string | null`, `AdminV2PilotPerson.lastInboundAt: string | null`.
- [x] `v2-pilot.read-model.ts` -- select `i.id` in both insight laterals and `max(m.occurred_at)` in the inbound lateral; project them as ISO strings or null. Tests cover the projection of the new fields and that team-signals still carries no user id.
- [x] `v2-pilot-progress.ts` -- add `author` (`{userId, name}` or null) to signals in `buildTopicRows` via an `insightId → person` map; add `warsawTime()` and `lastMessageLabel()`. Tests cover a match, no match, people null, and both freshness labels.
- [x] `components/ui.tsx` -- `Legend` (native details) and `Freshness` (check time + refresh link).
- [x] `pulse/page.tsx` -- author line on signal cards, Freshness, Legend, last message time in the participants line.
- [x] `pulse/[userId]/page.tsx` -- 12-topic map grid per the matrix, last message time, Freshness, Legend.

**Review loop 1 (author via QA endpoint + review patches):**
- [x] Contracts -- remove `insightId` from `AdminV2PilotTeamSignal` and `AdminV2PilotPersonQuestion`; add `AdminV2PilotQaTeamSignal` (= signal + `author: {userId, displayName}`) and `AdminV2PilotQaTeamSignalsResponse`, documented as QA-only.
- [x] API -- revert the `i.id` selections; add `getQaTeamSignals` sharing the team-signals query/projection and joining the author (roster member + linked Slack display name, the same as people); add `GET admin/v2-pilot/qa/team-signals` with the same guards. Tests: team-signals has no insightId/author; QA rows carry author; injected private fields are dropped.
- [x] Dashboard -- fetch QA signals (pinned to `people.cohortId`) instead of team-signals; `buildTopicRows` takes the author from the row (no id join); author links `encodeURIComponent`.
- [x] Review patches -- Freshness shows date and time and uses the later of both `checkedAt`; the label reads "последнее сообщение в цикле … / в этом цикле сообщений нет"; date formatting via `formatToParts` with an invalid-date guard (no throw); refresh keeps all current search params; the legend lists declined/reset/no_data and distinguishes Подтверждено vs Итог оценён; the person map fallback reads "Текста на этом этапе нет" and avoids duplicate outcome badges ("Оценка —" when scored without a number).

**Acceptance Criteria:**
- Given the local fixture, when a tester opens "Текущий цикл", then every Team Signal shows its author's short name linking to their page, and the team-signals API response contains no user id.
- Given a person page, when opened, then all 12 topics are visible at once, each with a status and either a draft, a final summary with score, or "Нет данных".

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts build` -- expected: success
- `pnpm --filter @entalent/api exec vitest run src/admin/v2-pilot.read-model.test.ts` -- expected: all pass
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api lint` -- expected: success
- `pnpm exec tsx apps/dashboard/src/app/v2-pilot-progress.test.ts` -- expected: all pass
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint` -- expected: success; the build runs with the dev server stopped

**Manual checks:**
- Browser pass on the local fixture: `/pulse` authors and freshness, and `/pulse/[userId]` for Анна (drafts plus a final) and Вера (finals plus insufficient evidence).

## Spec Change Log

- 2026-10-15, loop 1. Trigger: both reviewers found that `insightId` in the de-identified team-signals contract re-identifies every signal with one join against `/people`. Amended (with human approval): the author moves to a QA-only endpoint; team-signals and people carry no insight id. Known-bad state avoided: a "de-identified" contract that any admin-key holder can reverse. KEEP: legend, 12-topic person map, `lastInboundAt`, Freshness, and all spec 4 UI.

## Suggested Review Order

**QA author endpoint (entry point)**

- One query builder; author columns only in the QA variant, the clean variant has no join key
  [`v2-pilot.read-model.ts:441`](../../apps/api/src/admin/v2-pilot.read-model.ts#L441)

- QA read shares cohort resolution and order with Team Signals
  [`v2-pilot.read-model.ts:145`](../../apps/api/src/admin/v2-pilot.read-model.ts#L145)

- Route with the same guards as people
  [`v2-pilot.controller.ts:51`](../../apps/api/src/admin/v2-pilot.controller.ts#L51)

- QA-only contract, documented as never for manager views
  [`admin-v2-pilot-team-signals.ts:30`](../../packages/contracts/src/admin-v2-pilot-team-signals.ts#L30)

**Dashboard**

- Current cycle: author on signals, freshness, legend, last messages
  [`pulse/page.tsx:87`](../../apps/dashboard/src/app/pulse/page.tsx#L87)

- Person map: all 12 topics at once
  [`[userId]/page.tsx:35`](../../apps/dashboard/src/app/pulse/%5BuserId%5D/page.tsx#L35)

- Legend built from the same badge helpers as the pages
  [`ui.tsx:80`](../../apps/dashboard/src/app/components/ui.tsx#L80)
