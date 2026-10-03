---
status: draft
source: PR #7, IA-037 and IA-042; durable turn-effect story
date: 2026-09-29
---

# Legacy group confirmation and report intent

## Goal

A V1 group confirmation, its employee response, and its group-report dispatch identity commit together. A failed answer must not leave a confirmed group or queue a report. Retrying the same inbound must not reinterpret a committed confirmation or enqueue a second report.

## Boundary

`ConversationOrchestrator.handleAwaitingConfirmation` currently changes the group state and queues a report before the response transaction. Migration `0040` already accepts a `group_report` intent only for a confirmed, scoped group-state ID and reporting cohort. The active TypeScript worker owns both the state transition and queue side effect.

## Acceptance criteria

- A response or database failure before the committed turn leaves the group state awaiting confirmation and no report job.
- Agreement, correction, exclusion, and reset apply their state transition inside the same PostgreSQL transaction as the outbound response.
- A confirmed report is represented by one identifier-only `group_report` intent targeting the scoped group-state ID; queueing occurs after commit with a stable job ID.
- A committed turn with an old unqueued report intent is recovered through its persisted admission without another model interpretation.
- No private conversation or group summary is written into the intent or Redis payload.

## Verification

Use application branch tests, a migrated PostgreSQL/BullMQ rollback and retry fixture, worker and application typechecks, and `pnpm harness:check -- --base origin/main`. Preserve retired MAF boundaries and unrelated worktree changes.

## Implementation evidence (2026-09-29)

The orchestrator now prepares V1 agreement, correction, exclusion, and reset decisions without changing group state. It applies the chosen transition in the outbound turn transaction. Agreement records a `group_report` intent targeting the confirmed group-state ID and dispatches a stable Redis job after commit. A migrated PostgreSQL/Redis test forces failure after confirmation but before turn-effect persistence and observes rollback of group status and outbound. On retry it commits the scoped intent; a simulated Redis enqueue failure leaves the intent pending, and `resumeCommittedTurn` queues one content-free report without reinterpreting the answer. Application branch tests also cover pre-response failures for correction, exclusion, and reset. Already-queued Redis job loss and deployed acceptance remain open.
