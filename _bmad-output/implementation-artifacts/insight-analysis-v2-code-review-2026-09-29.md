# Insight Analysis V2 code review — 2026-09-29

Scope: the local PR #7 implementation against `origin/main` and IA-001–IA-047 in `spec-insight-analysis-v2/SPEC.md`. Review layers: Blind Hunter, Edge Case Hunter, and Acceptance Auditor. All layers completed. The approved SPEC is not a story file and has no Tasks/Subtasks section, so no story or sprint status was changed.

## Triage

| ID | Source | Severity | Route | Finding and disposition |
| --- | --- | --- | --- | --- |
| 1 | blind + edge | high | patch | `QuestionInsightRepository.captureMeaning` accepted a historically in-window source after wall-clock cutoff, allowing a delayed job to recreate private working text after the cutoff sweep. Added the current-time guard and a PostgreSQL delayed-capture regression. |
| 2 | auditor | high | patch | `ConversationOrchestrator` required a queued inbound among the latest 20 messages. After 20 newer messages, a valid delayed turn failed before V2 confirmation or evidence enqueue. It now uses the repository's source-bound history path where available, with a delayed-turn regression. |
| 3 | edge, validated on follow-up | high | patch | The privacy finalizer could accept a candidate containing a person's name from the confirmed meaning when the source used no role label and hierarchy data did not include that person. Failing `Sarah`, `Łukasz`, and `Олена` fixtures established both internal and sentence-initial paths. Likely source names now join the known-identifier gate, so the candidate is retried or replaced by safe fallback. |

Two candidates were dismissed after checking surrounding code and scope: the V2 report consumer is deferred by the SPEC, and the window-binding migration prevents the proposed V1 downgrade. Broader recognition of unlabeled names remains a privacy-evaluation risk; this patch covers likely capitalized names within and at the start of a sentence but does not claim complete named-entity detection.

## Verification

- Application orchestrator tests: 226 passed.
- Migrated PostgreSQL capture tests: 2 passed.
- Application and worker typechecks: passed.
- Privacy finalizer and policy tests: 37 passed; migrated PostgreSQL finalization fixture: 1 passed.
- Full local PostgreSQL/Redis harness after all three patches: `runs/harness/receipt-1790672280667-af17d0c2.json`, passed; model evals skipped.
- `git diff --check`: passed.

Review actions: 0 decisions needed, 3 patches applied, 0 deferred findings, 2 dismissed candidates. Deployed and model-backed acceptance remain open in the requirement tracker.
