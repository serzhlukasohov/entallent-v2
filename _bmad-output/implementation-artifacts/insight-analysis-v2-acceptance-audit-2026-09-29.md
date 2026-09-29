# PR #7 acceptance audit

Source: `_bmad-output/specs/spec-insight-analysis-v2/SPEC.md` section 8. Current local branch: `codex/insight-analysis-v2-spec`; implementation remains uncommitted. The last deterministic full gate passed in `runs/harness/receipt-1790712953598-ff5952da.json` with isolated PostgreSQL/Redis and `V2_CONVERSATION_QUEUE_TEST=1`. Model evals are excluded from that receipt.

The table distinguishes local contract proof from deployed acceptance. A passing test does not establish a real Slack exchange or approved production rubric calibration.

| AC | Required behavior | Current local evidence | Status and remaining proof |
| --- | --- | --- | --- |
| 1 | Three question meanings, one natural Bundle | `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` across all four Indices; `packages/application/src/utils/question-bundle-composition.test.ts` | Local proof; real channel delivery pending |
| 2 | One agreement confirms represented meanings | V2 BullMQ/PostgreSQL `agree` cases and verdict unit tests | Local proof; real employee reply pending |
| 3 | Partial acceptance keeps two and clarifies one | V2 queue `partial` case and `question-bundle-verdict.test.ts` | Local proof; real reply pending |
| 4 | Clarifying answer confirms without a second Bundle | V2 queue `partial` and clarification repository/application tests | Local proof; real reply pending |
| 5 | Silence stays pending; explicit refusal declines | V2 queue `partial_unrelated` and `decline` cases plus cutoff tests | Local proof; real delay pending |
| 6 | Cutoff yields `no_data`, no score | `question-cutoff.processor.test.ts`, repository cutoff integration, V2 queue cutoff cases | Local proof; deployed queue delay pending |
| 7 | Partial Index has no synthetic score | `select-question-insight-inputs.use-case.test.ts` and migrated PostgreSQL selector cases | Local input-contract proof; Index formula is deferred |
| 8 | V2 avoids V1 polarity/sentiment formula | `finalize-question-insight.use-case.test.ts`, V2 score adapter and V1/V2 quarantine tests | Local proof with synthetic rubrics; production anchors deferred |
| 9 | Score uses confirmed meaning before de-identification | Finalizer order tests and migrated PostgreSQL finalization fixture | Local proof; approved rubric model acceptance pending |
| 10 | Score range and policy provenance | `survey-scoring-policy.integration.test.ts`, finalizer and migrated PostgreSQL score persistence tests | Local proof with synthetic policy; calibration deferred |
| 11 | Policy immutable within company cycle | `survey-scoring-policy.integration.test.ts` and policy activation integration test | Migrated PostgreSQL proof; production policy activation deferred |
| 12 | Rejected privacy text never persists | `finalize-question-insight.use-case.test.ts` and `question-deidentification-policy.test.ts` | Local proof; broader live identifier evaluation pending |
| 13 | Final row has safe text, no reconstructable private copy | Migrated PostgreSQL `question-insight.repository` finalization cases and finalizer tests | Local database proof; production data audit pending |
| 14 | Completion purges private analytical derivatives | Migrated PostgreSQL finalization and V2 queue cleanup assertions | Local database proof; production timing pending |
| 15 | Declined, reset, superseded, expired data purged | V2 queue `decline`/`reject`/cutoff cases and repository cutoff tests | Local proof; deployed lifecycle pending |
| 16 | Original messages survive analytical purge | Migrated PostgreSQL finalization and V2 queue assertions | Local proof; deployed retention boundary pending |
| 17 | Organizational roles cannot read private employee data | `company-admin-session.integration.test.ts`, admin private-route tests, API role matrix | Mounted API proof; deployed route audit pending |
| 18 | Intermediate requires 3/3; final accepts 1/3 or 2/3 | `select-question-insight-inputs.use-case.test.ts` and migrated PostgreSQL selector cases | Local selector proof; report consumer is outside this SPEC |

## Compatibility and outstanding acceptance

- V1 report input remains available before a V2 policy binds and is quarantined after binding. The repository fixture, report processor, recovery fixture, V1 aggregate API fixture, and 250 application report/conversation tests passed on 2026-09-29.
- The dashboard production build passed. Private admin routes removed by IA-040–IA-041 are intentional contract changes; the remaining aggregate views need deployed verification.
- The one-run model gate at `packages/conversation-sim/runs/gates/2026-09-29T19-54-50-951Z-8e7dd71/summary.md` is failed: Annna's hard correction assertion and memory recall's judge verdict remain open. Neither produced a technical adapter crash after the simulation repair. The pre-PR gate at `packages/conversation-sim/runs/gates/2026-09-08T14-58-58-853Z-01c3812/summary.md` also failed Annna and memory recall, so the current failures alone do not establish a V2 regression. Four safety/privacy scenarios require manual review by gate policy.
- Exact numeric anchors for twelve rubrics, a complete employee Index formula, numeric Engagement, and report composition are explicitly out of scope in this SPEC. IA-043 implementation is deferred by the user while there are no real employees; unsafe legacy shared-key routes remain unmounted.

No criterion is marked fully accepted here until its remaining runtime proof is available. Do not infer production readiness from the local gate alone.
