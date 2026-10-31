# Decisions, Traceability, and Integration Notes

## Decision provenance

The user supplied V1 `Team Lead reports.md` and `Manager's report.md` and completed an incremental Russian-language requirements interview in October 2026. This package consolidates the final decisions rather than treating every earlier proposal as current. The most recent approval includes native Slack presentation with restrained semantic emoji. The interview's “18 questions” was an initial topic plan; supplemental decisions F1–F12 and P1 are part of the final authority.

| Interview decision | Approved outcome | Product requirements |
| --- | --- | --- |
| Q1 | Equal topic and person weights; complete 3/3 only for numeric open-ended employee Index | PR-013, PR-020 |
| Q2 + clarifications | Intermediate 80%/5; preserve confirmed departed/transfer data through source cycle; full withdrawal adjusts denominator | PR-013, PR-016, PR-017 |
| Q3 | Automatic first-threshold, once-per-Index intermediate | PR-013 |
| Q4 | TL intermediate category thresholds; no visible numeric score | PR-007, PR-020 |
| Q5–Q6 | Previous valid final baseline, unrounded direction, composition caveat | PR-020 |
| Q7 | Concise concrete causes and zero to three feasible actions; score is not a diagnosis | PR-004, PR-006 |
| Root-cause clarification + R1 | Cause required before confirmation except explicit refusal; no invented cause | PR-003 |
| Q8 | Group by meaningful causes and preserve differing experiences | PR-004 |
| Q9 | Quantitative Engagement 1–10, all 3 answers, floor 5, equal weighting, one decimal | PR-014, PR-020 |
| Q10 + F6 | Final may use finalized partial topics and useful unscored finalized insights qualitatively | PR-018 |
| Q11 subsequently replaced by F3/F3a | Main Focus is a concrete current problem, possibly cross-Index, prioritized by impact/severity; not lowest-score selection | PR-005 |
| Q12 | Final actions prioritize actual problems and latest confirmed conditions, no fixed Index allocation | PR-006, PR-008 |
| Q13–Q14 | Manager overall includes small teams plus TLs, each person once/equal weight | PR-009 |
| Q15–Q16 | Overall Manager 80%/5 trigger, independent of per-team availability; preliminary qualification for results AND recommendations | PR-011, PR-013 |
| Q17–Q18 | Team section excludes own TL, five complete subordinate contributors, no extra 80% | PR-010, PR-019 |
| F1/F1a/F10 | Last working day final, separate cutoff, finish timely processing; do not silently drop delayed jobs | PR-014, PR-015 |
| F2–F5 | Manager intermediate/final two sections, final Engagement metric, up to three bullet actions per overall/team section; insufficient-data team row | PR-010–PR-012, PR-019 |
| F7 | New cross-report overlap/subtraction inference machinery deferred | PR-023 |
| F8 | Partial withdrawal excludes specified data, keeps denominator, can break complete Index | PR-017 |
| F9 | Comparable previous final metric, raw delta direction, one-decimal visible values | PR-020 |
| F11 | Scheduled insufficient overall final notice; eligible overall not blocked by unavailable team breakdown | PR-022 |
| F12 | Reports use company language, not recipient chat language; English default; multilingual chat is separate | PR-021 |
| P1 | Native Slack hierarchy, semantic symbols, bold labels, separate action bullets, stacked team sections | PR-021 |

## Supersession rules developers must apply

- **Main Focus:** do not implement the superseded lowest-Index → worst-delta → tie algorithm. Severity/impact from supported insights chooses a real problem. Numeric diagnostic data may inform context, not substitute for it.
- **Final time:** replace “after immutable periodEnd” as the report trigger with last-working-day formation and separate report-data cutoff. Keep the cycle interval immutable for other lifecycle needs.
- **Departures:** do not use current `active` status alone to discard an otherwise permitted confirmed source-cycle insight. Do not weaken actual withdrawal, expiry, or deletion checks.
- **Denominator:** a fully withdrawn person is removed from future unpublished intermediate denominator; partial withdrawal and ordinary departure do not remove them.
- **Manager scope:** Team Leads are employee-like overall participants; their own insights cannot grade their own team section. Small-team roll-up is now in scope for overall, while per-team floors still apply.
- **Recommendations:** zero to three supported actions; neither exactly three nor a fixed generic action.
- **Language:** company-language reports override personal conversation-language rendering. Canonical human-readable app records/admin UI are a related language dependency; do not rewrite original employee messages or localize technical identifiers.
- **Pilot overlap:** the pilot's five-changed-contributor requirement is not an additional product final gate. The user explicitly deferred new overlap/subtraction machinery while retaining established input privacy, audience floors, and delivery safety.

## Current code baseline: implemented foundations and remaining work

Static inspection at `6646764`; no production configuration or current database state was verified for this documentation PR.

| Surface | Baseline behavior | Required follow-up |
| --- | --- | --- |
| `packages/application/src/use-cases/finalize-question-insight.use-case.ts` | Receipt-backed rubric scoring before anonymization; privacy-accepted permanent records; private analytical purge; unscored outcomes/fallback | Retain isolation and order; canonical-language storage integration must preserve meaning |
| `packages/application/src/utils/question-readiness.ts` | Sufficient meaning plus captured/refused driver | Matches approved exception; maintain refusal-versus-silence distinction |
| `packages/application/src/use-cases/select-question-insight-inputs.use-case.ts` | Complete intermediate and partial/unscored final selection; employee question trends | Reuse allowed input boundary; do not confuse question trends with team report trends |
| `packages/application/src/use-cases/select-v2-cohort-report-inputs.use-case.ts` | Frozen roster, 80%/5 intermediate, 3/3; final floor | Add audience-aware Manager scope, adjusted denominator, and new report-data cutoff rules |
| `apps/worker/src/survey/repositories/v2-cohort-report-input.repository.ts` | Finalized current unwithdrawn inputs; current active-user filter | Preserve confirmed departed source-cycle data without weakening withdrawal/deletion/retention |
| `packages/application/src/use-cases/build-v2-index-report.ts` | Limited pilot equal-weight numeric Index/question text and generic action | Add four audience-specific target builders, qualitative signals, problem-based focus, actual role-specific actions, report language |
| `apps/worker/src/survey/v2-report.processor.ts` | Pilot gates/snapshots, pre-send target/input checks, all-four-group final and overlap blocking | New final Engagement eligibility, no all-four mandatory gate, correct recipient scope, no implicit five-changed-person gate, retain delivery safeguards |
| `scripts/enqueue-v2-reports.ts` / legacy cycle close | Tenant-scoped manual V2 enqueue; legacy close excludes V2 | Implement automatic intermediate and business-calendar final scheduling/settlement |
| Company hierarchy / calendar / onboarding / language | Supporting models and services exist; English-default behavior has evolved | Select the authoritative calendar/timezone/role/locale contracts; do not infer support from model ability alone |
| Slack adapter / report formatting | Existing messages/pilot are not the approved four presentation templates | Native Block Kit serializer, validation, accessible fallback, mobile/long-report QA |

## Engineering design obligations before implementation acceptance

These are technical design responsibilities, not additional unapproved product requirements or reasons to re-interview settled choices:

1. **Scope and affiliation keys.** Persist the authoritative Manager scope snapshot and explicit TL membership. Avoid duplicate nested membership; do not average team means. Define an unambiguous history identity when hierarchy boundaries change; use Baseline established if the previous scope is not comparable.
2. **Calendar and cutoff.** Resolve end-of-working-day from configured work calendar/timezone, DST and holidays; persist the separate cutoff. Define observable behavior for missing/invalid calendar configuration and a cycle with no working day, without silently choosing a different timezone or date. The interview did not approve an arbitrary fixed hour such as 17:00.
3. **Settlement.** Establish a durable barrier for all pre-cutoff input/confirmation events, and process retries with that immutable cutoff. Define how ongoing collection behaves after the reporting cutoff; do not assume later weekend input is backfilled into a published final or auto-migrated into the next cycle.
4. **Withdrawal and retention.** Apply current withdrawals before send, recompute relevant unpublished denominator/inputs, and preserve withdrawal state without private source retrieval. Translate full reporting withdrawal versus partial exclusions into explicit typed contracts. Actual erasure is governed by its separate rights contract.
5. **Narrative validation.** Decide bounded validation and safe fallback for invalid generated text. Never substitute a cause with a fabricated template or treat `rootCauseCategory` as detailed supporting evidence. Anonymization failure fallback may leave a usable number without enough text for a concrete action.
6. **Business-day delivery under failure.** On-time final is the normal requirement. Record operational failure/delay rather than fake insufficient data or silently change scope/cutoff. Define recovery alerts/status using existing operational patterns; no new manager product notification flow is invented here.
7. **Long Slack output.** Respect current Block Kit limits. Choose a reviewed strategy for oversized reports preserving all required eligible team content, one logical report identity, per-send receipts, and duplicate/ambiguous-delivery safety. No silent clipping or undocumented interactive dashboard is permitted.
8. **Language integration.** Generated canonical analytical/report text and UI use company language while personal chat remains multilingual. Preserve original conversation isolation. Document original versus canonical translated text boundaries, model evaluation, configuration validation, and snapshot language; do not claim guaranteed equal model quality on all languages.
9. **Pilot cutover.** Keep tenant/role authorization and feature/approval controls explicit. Requirements merge does not turn gates on, mutate existing snapshots, or authorize rollout. Make contradictory old defaults discoverable through this package's scope authority rather than rewriting archive artifacts.

## Out of scope

HR/HRBP/Leadership report design; a new survey/scoring rubric catalog; customer dashboards/PDF/email exports; production deployment or data migration execution; retrospective editing of delivered reports; a new cross-report inference detector; a statistical-significance model for trends; full private-conversation export/deletion rights implementation.

## Documentation verification

Check every product requirement has functional coverage; every functional rule has acceptance coverage; local Markdown links resolve; no superseded rule appears as current. Check samples against audience-specific number visibility, company language, preliminary qualifications, 0–3 actions, two-part Manager structure, and insufficient-data handling. `git diff --check` and the repository's docs-only harness are the execution checks for this PR. Runtime scenarios in ACCEPTANCE-SCENARIOS.md are implementation requirements, not claimed executed tests.
