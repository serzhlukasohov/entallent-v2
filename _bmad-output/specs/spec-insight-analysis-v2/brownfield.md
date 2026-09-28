# Insight Analysis V2 — Brownfield Reconciliation

## 1. Audit Baseline

- Branch baseline: `origin/main`
- Baseline commit: `9065ef4`
- Active runtime: TypeScript only
- Audit date: 2026-09-28

The repository CodeGraph index exists but neither the CodeGraph CLI nor MCP tool is available in this checkout. This reconciliation therefore uses targeted static source inspection.

## 2. Current V2 Shape

The current implementation already provides useful foundations:

- question definitions and question-level evidence in `survey_questions` and `survey_evidence`;
- question-level assessments in `survey_assessments`;
- one index-level `survey_group_states` record per employee/window/question group;
- one natural index-level confirmation prompt;
- reporting disclosure proof;
- typed de-identification policy;
- hierarchy-derived known identifiers supplied to that de-identification policy;
- confirmed/withdrawn group-state lifecycle;
- frozen Team/cycle reporting cohorts;
- immutable report snapshots and report delivery controls;
- persisted original messages for conversation continuity;
- cycle-close expiry for unresolved group states.

The approved product contract changes the ownership and ordering of several of these concepts.

## 3. Requirement-to-Code Map

| Area | Approved V2 requirement | Current implementation | Reconciliation |
| --- | --- | --- | --- |
| Question grain | Final analytical record per question | `survey_group_states` is unique by window/user/`questionGroup`; `aiSummary` and `employeeScore` are index-level | Add or repurpose a question-level confirmed insight entity; do not overload one group row with three meanings |
| Temporary grain | Separate temporary meaning per question | `survey_evidence` is question-level and stores `evidenceSummary`, polarity, source message IDs | Treat current evidence as private working state only; add explicit lifecycle and immediate purge/redaction |
| Confirmation UX | One natural message per index | `group-confirmation.ts` generates one group summary | Preserve this UX |
| Confirmation representation | One bundle mapped to three question meanings | Prompt returns one `summary`; mapping is not persisted as three versioned components | Change confirmation output contract to contain display text plus structured question components |
| Partial confirmation | Accepted questions may confirm while one enters clarification | Group state transitions as one unit; correction sends the entire group back to `in_progress` | Add question-level confirmation outcomes and bundle-level orchestration |
| Clarification silence | `pending_clarification` until cutoff | No question-level clarification status | Add explicit status and cutoff transition |
| Explicit decline | Question becomes `declined` and is not re-asked | Existing withdrawal acts at group level | Add question-level decline; do not conflate decline with report withdrawal |
| Full rejection | Reset all three temporary meanings and reopen backlog | Correction currently resets the group summary but retains question evidence | Add explicit full-reset operation and temporary-content purge |
| `no_data` | Set only at cutoff for unresolved clarification | Current close marks unresolved group states `expired` | Add question outcome `no_data`; keep it distinct from group expiry |
| Scoring source | Confirmed semantic question summary before de-identification | `computeGroupScore` reads latest `survey_evidence` before confirmation completion | Move scoring after question confirmation and pass the confirmed semantic version explicitly |
| Scoring formula | One question-specific rubric, continuous `0–100` | `group-scoring.ts` uses `0.7` polarity plus `0.3` sentiment | Replace the open-ended branch; remove sentiment double-scoring from active flow |
| Score grain | One score per confirmed question | `survey_assessments` has question scores, but report path uses one `survey_group_states.employeeScore` | Define one authoritative question-score record and derive complete Index scores separately |
| Partial Index | No employee-level Index unless `3/3` | `computeGroupScore` averages any non-empty list of question scores | Require exactly three valid question scores before computing a complete employee Index |
| Scoring Policy | Company-stable and versioned | Question has `scoringConfiguration`; assessment has `evaluatorVersion`; no company policy identity is enforced | Add tenant/company Scoring Policy version and bind cycle/question scoring to it |
| Trend policy | Any non-zero same-policy delta is directional | Group report passes `trend: null`; admin trends use separate current logic | Defer presentation, but persist compatible policy/version metadata now |
| De-identification order | Score confirmed private meaning, then de-identify | Current confirmation summary must pass de-identification before delivery and DB confirmation checks require accepted de-identification | Reverse the analytical sequence while retaining a privacy gate before final analytical persistence |
| Fidelity | No separate semantic Fidelity Gate in MVP | No explicit fidelity gate exists | No new runtime evaluator required |
| Privacy gate | Persistent analytical text must be accepted | `deidentification-policy.ts` and DB checks provide a useful typed policy foundation | Reuse and extend it for post-confirmation question summaries |
| Safe fallback | Retry then controlled structured fallback | Rejected de-identification currently blocks confirmation/reportability | Add bounded retry and controlled safe fallback |
| Immediate purge | Delete non-anonymous derivatives after durable completion | Evidence persists; unresolved group content expires only at cycle close | Add an idempotent finalize-and-purge workflow |
| Original messages | Retain for private conversation continuity | `messages.text` persists and worker conversation repository reads history | Preserve, but isolate access |
| Analytics/source link | No traversable link from analytics to messages | `survey_evidence.sourceMessageIds`, confirmation message IDs, and group-report provenance create direct joins | Final reportable insight entity must not expose resolvable source-message IDs; lifecycle proof must stay in a stricter boundary |
| Employee privacy | No organizational or human debug access to private messages/working insights | Internal admin user-insights endpoint exposes evidence summary, polarity, score, and root cause behind an internal flag and shared API key | Remove private content from internal dashboards or introduce a separately approved, audited exceptional-access policy |
| Customer roles | No role sees employee-level private analytics | Customer-facing hierarchy access is not yet implemented | Preserve fail-closed behavior when hierarchy roles are added |
| Reporting bridge | Intermediate `3/3`; final may consume partial question insights | Report use case consumes one confirmed group state per employee/index | Reporting input contract must change before partial final inputs can work |
| Engagement | Separate numeric contract | Active code includes Engagement in group scoring and final reports; score is an average on `1–10` while report rendering labels scores `/100` | Treat as a blocking separate decision before report-score unification |

## 4. Blocking Contradictions

### BC-01 — Persistence grain

`survey_group_states` cannot represent three separately confirmed, scored, de-identified question insights. Adding statuses or JSON blobs to the existing index-level row would weaken uniqueness, lifecycle, and query safety.

Recommended boundary:

```text
survey_index_states
  - one employee/cycle/index orchestration row

survey_question_insights
  - one employee/cycle/question analytical row
```

Exact table names remain an architecture decision.

### BC-02 — Confirmation and de-identification order

Current database checks prove that the exact de-identified text was displayed before confirmation. The new product decision instead confirms semantic meaning, scores it, and only then creates reportable de-identified text.

The following current constraints and repository predicates cannot remain authoritative without redesign:

- `confirmedDisplayedSummaryProof`;
- `confirmedDeidentificationProof`;
- exact equality between message `confirmationSummary` and persisted `aiSummary`;
- accepted de-identification required before confirmation delivery.

Do not weaken these checks in place. Add a forward migration and replacement proof model that distinguishes:

- private confirmation bundle proof;
- per-question confirmation/correction proof;
- final privacy-accepted analytical insight proof.

### BC-03 — Scoring authority

The active path scores latest evidence through two model-derived signals. This is incompatible with the approved source and rubric.

Required replacement:

```text
confirmed semantic question summary
  -> versioned company/question rubric
  -> continuous score + confidence
```

`computeOpenEndedQuestionScore` must leave the active open-ended flow after the replacement is verified.

### BC-04 — Immediate purge

Current `survey_evidence` retains non-anonymous summaries and source-message IDs, while cycle close only nulls unresolved group-state fields. There is no immediate post-finalization purge for question evidence or analytical prompt artifacts.

The implementation needs an idempotent state machine, not a best-effort delete after independent writes.

### BC-05 — Private-storage access

Messages are plaintext database text and several shared-admin/internal surfaces can query employee-specific content. An internal-dashboard flag is not equivalent to the approved employee-only product boundary.

Before release, access paths must be enumerated and reduced to the employee-facing runtime and employee rights workflows, with explicit audit for any approved exceptional access.

## 5. Recommended Target Boundaries

### Private conversation boundary

Owns:

- original messages;
- private memory;
- employee-facing continuity;
- employee export/deletion rights.

Must not be queried by report generation.

### Temporary insight boundary

Owns:

- question working summary;
- source references required during collection;
- confirmation-bundle component versions;
- clarification state.

Content is deleted or irreversibly redacted after confirmation finalization, decline, reset, supersession, or cutoff.

### Persistent analytical boundary

Owns:

- de-identified question summary;
- continuous question score;
- scoring/privacy versions;
- confidence;
- lifecycle timestamps and withdrawal state;
- restricted identity scope for policy enforcement.

It owns no raw text or resolvable source-message link.

### Index orchestration boundary

Owns:

- the three question identities for one Pulse Index;
- bundle readiness;
- one natural confirmation interaction;
- complete/partial/reset state;
- eligibility for a complete employee-level Index.

### Reporting boundary

Consumes immutable projections from the persistent analytical boundary. It shall not derive missing question scores or read temporary/private storage.

## 6. Safe Migration Sequence

1. Define the question-level insight and Scoring Policy contracts without changing the active report path.
2. Add forward schema migrations for question-level lifecycle, score provenance, and post-confirmation de-identification proof.
3. Add a new TypeScript application use case for finalize-score-deidentify-persist-purge.
4. Produce structured question components alongside the existing index-level confirmation message.
5. Implement partial confirmation, clarification, decline, reset, and cutoff state transitions.
6. Shadow-calculate new question scores without feeding reports; compare stability and cost.
7. Introduce immediate purge only after durable finalization and recovery tests pass.
8. Remove private evidence from internal dashboards and prevent reporting joins to message content.
9. Switch intermediate-report input to complete `3/3` question insights.
10. Defer final partial aggregation until its reporting contract is approved.
11. Retire the active `70/30` scorer and legacy group-level analytical authority only after backfill/quarantine decisions are complete.

## 7. Required Verification

### Domain and application tests

- bundle agreement confirms three question meanings;
- partial agreement confirms only accepted meanings;
- clarification confirms only the corrected question;
- silence stays pending until cutoff;
- explicit decline is not re-asked;
- full rejection resets all three;
- no missing state produces a score;
- scoring receives the confirmed semantic version only;
- a partial index never produces an employee Index score;
- Scoring Policy version cannot change mid-cycle.

### Database integration tests

- question insight uniqueness and tenant scope;
- atomic persistent-write and temporary-purge behavior;
- retry/idempotency after crash between scoring, de-identification, and persistence;
- no final analytical record contains raw text or source message IDs;
- cutoff transitions pending clarification to `no_data` and purges temporary content;
- original messages remain after analytical purge.

### Privacy and authorization tests

- Team Lead, Manager, HR, HRBP, Leadership, and Company Admin cannot read private employee content;
- internal dashboard routes cannot return raw evidence or working summaries;
- report generation cannot join to messages or temporary insights;
- de-identification rejects every configured identifier class;
- safe fallback produces accepted text without dropping the score.

### Scoring evaluation

- rubric fixtures for all twelve questions;
- repeat-run stability on identical confirmed summaries;
- monotonic fixtures from clearly adverse to clearly favorable states;
- correction fixtures proving the employee's clarification changes only the intended question;
- cost and latency measurement per confirmed question;
- same-policy cross-cycle trend fixtures.

## 8. Current Assets to Reuse

- stable survey question IDs and versioned definitions;
- question-specific canonical meaning and indicator fields;
- tenant/cycle scope;
- original-message persistence for continuity;
- typed de-identification policy and rejection reasons;
- reporting disclosure receipts;
- frozen cohort and immutable report infrastructure, after input-contract changes;
- TypeScript application and repository boundaries.

## 9. Do Not Reuse as Product Authority

- index-level `survey_group_states.employeeScore` for the new question-level model;
- `computeOpenEndedQuestionScore` and its `70/30` weights;
- evidence polarity plus sentiment as independent signals;
- internal admin evidence visibility;
- group-level correction as a substitute for per-question partial confirmation;
- cycle-close cleanup as a substitute for immediate analytical purge;
- MAF or `agent-service` runtime surfaces.

## 10. Implementation Readiness

The collection, confirmation, question-scoring, de-identification, purge, and storage contract is ready for architecture and story decomposition.

Full reporting implementation is not ready from this document alone. The deferred decisions in `SPEC.md` require a separate Reporting Grill and contract.
