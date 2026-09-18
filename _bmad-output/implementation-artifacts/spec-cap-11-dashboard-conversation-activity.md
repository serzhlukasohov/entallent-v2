---
title: 'CAP-11 Dashboard Conversation Activity State'
type: 'bugfix'
created: '2026-09-18'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0b20fd3'
context:
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manager dashboard already receives employee conversation activity as `lastActiveAt`, independently from pulse insights, but an expanded row with no current or previous insight claims `No insights — no conversations yet.` This falsely reports missing conversations after Reset followed by a real inbound message.

**Approach:** Reuse the existing `lastActiveAt` and `previousWindow` fields at the dashboard rendering boundary to distinguish recorded conversation activity, absent pulse insights, and previous-window insights. Keep the API contract, queries, Reset behavior, and privacy boundary unchanged.

## Boundaries & Constraints

**Always:** Treat conversation activity and pulse insight availability as separate states; preserve current and previous evidence cards; keep the existing tenant-scoped, non-deleted inbound definition of `lastActiveAt`; use neutral wording when no retained activity exists.

**Ask First:** Any API/contract/schema/query change, Reset retention change, automatic polling or refresh behavior, production Slack payload, commit, push, or deployment.

**Never:** Expose raw messages, snippets, message counts, IDs, or individual evidence beyond the existing manager surface; fabricate insights from activity; infer that a conversation never existed after destructive retention; modify or invoke retired MAF or `agent-service` paths.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Activity without insights | `lastActiveAt` is non-null; no current evidence; no previous window | Show `Conversation activity recorded; no pulse insights yet.` | Do not invent evidence or expose conversation content |
| No retained activity | `lastActiveAt` is null; no current evidence; no previous window | Show `No pulse insights or recorded conversation activity.` | Do not claim the employee never conversed |
| Previous insights only | No current evidence; `previousWindow` exists | Keep `No insights in the current window.` and render previous coverage/evidence separately | Missing previous evidence remains `No saved insights.` |
| Current evidence | Current signal has `evidenceSummary` | Render current evidence cards and no empty-state text | Existing rendering remains authoritative |
| Assessment without evidence | Current signals exist but have no `evidenceSummary` | Show the activity-aware empty state and retain `Not yet covered` | Assessment status does not become evidence |

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/components/TeamTable.tsx` -- owns the incorrect expanded-row empty-state decision; `lastActiveAt` and `previousWindow` are already available here.
- `apps/dashboard/src/app/components/TeamTable.test.tsx` -- focused four-case empty-state regression using Node's built-in test runner, the existing `tsx` runtime, and React server rendering.
- `apps/api/src/admin/manager-dashboard.read-model.ts` -- existing source of tenant-scoped, non-deleted inbound `lastActiveAt`; context only, no change planned.
- `apps/api/src/admin/manager-team.aggregate.test.ts` -- existing proof that activity, empty current insights, and previous insights are independent; regression control only.

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard/src/app/components/TeamTable.tsx` -- centralize the three truthful empty-state labels and use them only when current evidence cards are absent.
- [x] `apps/dashboard/src/app/components/TeamTable.test.tsx` -- cover activity without insights, assessment without evidence, no retained activity, previous-window priority, and current evidence; assert competing empty-state labels are absent.
- [x] `_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md` and `docs/agent-task-log.md` -- record local verification while leaving production closure pending an authorized deployment/read-back.

**Acceptance Criteria:**
- Given a post-Reset employee has a new non-deleted inbound but no pulse evidence, when their row is expanded, then the dashboard acknowledges recorded activity and separately says pulse insights are unavailable.
- Given current evidence exists, when the row is expanded, then current evidence cards render unchanged and no empty-state label appears.
- Given previous-window insights exist but the current window is empty, when the row is expanded, then the current-window label and previous evidence remain separate.
- Given the fix is built, when contracts and API code are compared, then their wire shape and query behavior are unchanged.

## Spec Change Log

- 2026-09-18: Recorded that commit `78b175c` satisfied CAP-11's original historical-insight requirement, while the post-deployment Reset replay exposed this residual false empty-state claim; retained the existing API semantics and added only the dashboard rendering correction.

## Verification

**Commands:**
- `pnpm exec tsx --test apps/dashboard/src/app/components/TeamTable.test.tsx` -- focused empty-state regression passes without adding a dependency.
- `pnpm --filter @entalent/api exec vitest run src/admin/manager-team.aggregate.test.ts` -- existing activity/insight separation remains green.
- `pnpm --filter @entalent/dashboard typecheck` -- dashboard types pass.
- `pnpm --filter @entalent/dashboard lint` -- dashboard lint passes.
- `pnpm --filter @entalent/dashboard build` -- production rendering builds.
- `pnpm harness:check -- --base 0b20fd3` -- final structured receipt passes.

**Manual checks:**
- After explicit authorization, run `pnpm harness:preflight`; send no connector payload unless both named PostgreSQL and Redis targets pass.
- Select an employee whose read-back has no current evidence and no previous window without resetting production state; create one real Slack inbound through the connector, then prove `lastActiveAt` is non-null while current evidence and `previousWindow` remain absent.
- Confirm the production API/UI show the activity-aware copy without the obsolete no-conversation claim or any raw transcript exposure.

**Results:**
- RED: the focused component regression failed `2/3` cases against the old activity/no-activity copy.
- GREEN: component regression `4/4`, API aggregate regression `9/9`, dashboard typecheck/lint/build, `git diff --check`, and pre-commit harness receipt `runs/harness/receipt-1789739490322-dba03389.json` passed.
- PRODUCTION: scoped Reset for `Serhii Lukashov` removed prior conversation/Pulse state while preserving the active window; preflight `runs/harness/receipt-1789740580221-03ffbf6c.json` passed; Slack inbound `1789740591.309129` received exactly one reply `1789740602.219129`.
- FINAL READ-BACK: API reported `lastActiveAt=2026-09-18T14:09:51.309Z`, zero current evidence/signals, `previousWindow=null`, and no raw inbound exposure; the expanded production dashboard row rendered `Conversation activity recorded; no pulse insights yet.` with no transcript content.

## Suggested Review Order

**Dashboard state semantics**

- Keep insight availability and recorded activity distinct at the rendering boundary.
  [`TeamTable.tsx:102`](../../apps/dashboard/src/app/components/TeamTable.tsx#L102)

- Apply the approved previous-window, activity, then neutral priority.
  [`TeamTable.tsx:111`](../../apps/dashboard/src/app/components/TeamTable.tsx#L111)

**Regression coverage**

- Prove activity without evidence, including an assessment lacking a summary.
  [`TeamTable.test.tsx:45`](../../apps/dashboard/src/app/components/TeamTable.test.tsx#L45)

- Preserve previous and current evidence rendering without contradictory labels.
  [`TeamTable.test.tsx:69`](../../apps/dashboard/src/app/components/TeamTable.test.tsx#L69)

**Status and follow-up**

- Keep production closure pending an authorized inbound and API/UI read-back.
  [`bug-catalog.md:28`](../specs/spec-generic-conversation-bug-backlog/bug-catalog.md#L28)

- Track the pre-existing synthetic-inbound semantic mismatch separately.
  [`deferred-work.md:199`](deferred-work.md#L199)
