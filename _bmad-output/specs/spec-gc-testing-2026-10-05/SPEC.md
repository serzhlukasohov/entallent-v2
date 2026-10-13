---
id: SPEC-gc-testing-2026-10-05
companions:
  - bug-catalog.md
  - ../spec-generic-conversation-bug-backlog/SPEC.md
sources: []
---

> **Canonical contract.** Derived from `.memlog.md`. Confluence page 189366273 is provenance only; `bug-catalog.md` holds the transcribed evidence (R1–R10, X0).

# Generic Conversation Bug Backlog — Round 2 (2026-10-05–11)

## Why

Ten tester reports from the October GC round show the Ukrainian-speaking employee experience breaking in four ways: the bot goes silent, switches to Russian, loses or misreads conversational context, and talks in a reflective, covert style that hides what the pulse check wants. The September fixes are in `main` (squash merge `abb314f`), so these are new or residual defects; production deploys during the round were manual and not traceable to a commit.

## Capabilities

- **CAP-1 — No silent turns**
  - **intent:** Every admitted inbound gets a reply or an explicit localized fallback; the failure cause is persisted; one user's failures cannot silence other users.
  - **success:** Forced provider/content-filter, parse, validation, and stale-state failures each yield one user-visible message and a stored cause; the R3 venting sequence gets replies.

- **CAP-2 — Conversation language continuity** (resolved by product decision 2026-10-13)
  - **intent:** Customers are English-speaking teams, so the mentor always replies in English; no language is inferred from message text.
  - **success:** Ukrainian and Russian conversations, and non-English profiles, all receive English replies; `resolveLanguagePolicy()` is a constant.

- **CAP-3 — Elapsed-time awareness**
  - **intent:** The model knows how much time passed between turns; after a multi-day gap a greeting is treated as a greeting and stale tasks are not resumed unless the user resumes them.
  - **success:** R1 fixture (Oct 3 drafting task, then "ало" three days later) yields no reference to the draft.

- **CAP-4 — Time-bound memory stays in its time**
  - **intent:** Schedule-like memory is never forced into an unrelated reply, and expired items are not presented as current.
  - **success:** R2 fixture (emotional turn about quitting plus a stored schedule item) produces no required grounding on the schedule item.

- **CAP-5 — Corrections end, the topic returns**
  - **intent:** A correction is acknowledged once, then the reply returns to the user's substantive topic; Ukrainian and Russian corrections are detected deterministically; the same-day topic stays recoverable.
  - **success:** Cyrillic correction prefixes normalize; in the R6 sequence at most one assistant turn apologizes and the next turn references the original topic.

- **CAP-6 — No default summary opener**
  - **intent:** Replies do not open with a restatement or a "not X but Y" reframe by default, in any supported language.
  - **success:** Over a multi-turn uk/ru/en sim, at most one assistant turn matches the opener antipatterns and no two consecutive turns share an opener.

- **CAP-7 — Transparent pulse flow**
  - **intent:** During an active pulse check the user can ask for the questions, see progress, and hear when it is done; reply text does not leak report mechanics outside a reporting explanation.
  - **success:** "дай вже питання" yields a direct question; "скільки ще?" / "я на все відповів?" yields a truthful count or completion; R9's "в отчёт можно ставить" class does not recur.

- **CAP-8 — Humour is not risk**
  - **intent:** Jokes, emoticons, and idioms are not escalated as risk and are not turned into literal metaphor advice.
  - **success:** "або через вікно =)))" in the R5 context yields no risk signal and no window/door/evacuation advice; real self-harm phrasing still escalates.

- **CAP-9 — Translate means translate**
  - **intent:** An explicit translate request translates the referenced content instead of triggering a canned explanation.
  - **success:** R4 fixture (English onboarding intro, then "переклади") returns the intro in Ukrainian.

- **CAP-10 — Production deploys are traceable**
  - **intent:** Every production deploy is traceable to a commit on `main`, so tested behaviour maps to known code.
  - **success:** Railway deployment metadata names a commit whose tree contains the round-2 fixes (verify by tree/content, not commit ancestry, because `main` uses squash merges).

## Constraints

- TypeScript-only; retired MAF/`agent-service` untouched.
- One root-cause slice at a time, RED before GREEN, smallest focused regression first.
- Fix from current `main`; it already contains the September fixes (squash `abb314f`). Release-lineage checks must compare trees/content, not commit ancestry.
- No production data mutation, Slack payloads, commits, pushes, or deploys without per-slice user approval; production reads are diagnostic only and need approval.
- Pulse privacy rules (CC-TRUST-103, cohort safety, confirmation semantics) stay authoritative; CAP-7 transparency must not expose individual evidence.
- Language and correction detection must not rely on ASCII `\b` for Cyrillic.

## Non-goals

- Rewriting the conversation runtime or the reply prompt wholesale.
- Making the pulse survey a fixed questionnaire; CAP-7 is about transparency on request.
- Re-enabling MAF or adding a second LLM judge.
- Editing the Confluence page.

## Success signal

Each capability has a focused regression that fails on the reported behaviour and passes after the fix; affected package tests and `pnpm harness:check` pass; production-sensitive slices (CAP-1, CAP-7) also have an approved Slack read-back on a deploy traceable to `main`.

## Assumptions

- R2's schedule facts came from time-bound memory items, not calendar data (no calendar data reaches the reply prompt on any audited branch).
- R3's silence came from the provider failing on the slur message, possibly amplified by the shared circuit breaker.
- R10's silence came from deterministic confirmation-summary or bundle validation failure at the end of the pulse flow.

## Open Questions

- Is read-only production diagnosis approved (messages, `llm_runs`, BullMQ `failedReason`, tester memory items) to confirm R2, R3, and R10?
