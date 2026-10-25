---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: intent gap — Story 12.4 (P-Suite Atomic Tests and Smoke Journeys) cannot be resolved without human input.

## Unresolved questions

1. **Verbatim source texts.** The AC requires the evaluated turns, seeded user messages and every `passCondition` to equal the Confluence P-suite v1 text. The repository holds only summaries (`_bmad-output/specs/spec-conversation-eval-regression/case-mapping.md` section 1); the verbatim page is not checked in. Who exports the Confluence page (or confirms the agent may read it through the Atlassian connector) as the source of truth?
2. **QA approval of seeds.** The AC requires every seeded coach text to be marked QA-approved in the `case-mapping.md` section 5 table. An unattended run cannot grant that approval; who reviews the seeds?
3. **Journeys pending QA.** The P-09 and P-10 smoke journeys are "proposed, pending QA" (SPEC Open Questions). Are they agreed?
4. **Open items that shape criteria:** P-06 working hours vs product quiet hours (Confluence open item 2), P-05 opening content (open item 4), P-09 progress content (open item 7) — confirm the NOT TESTABLE reasons and the known-red handling.

## Evidence gathered

- `epics.md` Story 12.4 AC (lines 256-282) and `case-mapping.md` sections 1, 4, 5.
- `packages/conversation-sim/src/suite/cases/p-v1/` holds only the empty `index.ts` and `sources.ts`.
- Rules needed by the cases now exist (12.3a, 12.3b); deferred items for case authors are in `deferred-work.md` (upper bounds on `invariant` criteria, params `query`/`at` equal to `stateQuery`).

## Suggested next step

Planning only (`Halt after planning.`) once the texts are available: bmad-build can draft the decomposition table with seeds marked "pending QA", then QA approves before implementation.
