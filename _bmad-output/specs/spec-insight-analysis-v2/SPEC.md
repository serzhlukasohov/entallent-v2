---
title: Insight Analysis V2 for Open-Ended Pulse Indices
status: approved-product-contract
language: English
created: 2026-09-28
baseline_branch: origin/main
baseline_commit: 9065ef4
source_materials:
  - Flow 1 - Hidden Employee-Level Analytics + Scoring.md
  - Index Scoring Approach (MVP).md
  - Insight Analysis Pipeline.md
related_specs:
  - _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
  - _bmad-output/specs/spec-insight-analysis-v2/SCORING-POLICY.md
---

# Insight Analysis V2 for Open-Ended Pulse Indices

## 1. Purpose

Define the V2 product contract for converting private employee conversations into confirmed, scored, de-identified question insights that can safely feed later reporting functionality.

This specification replaces the V1 open-ended scoring approach for the scope defined below. V1 materials remain discovery inputs, not implementation authority.

## 2. Scope

### In scope

- the twelve open-ended MVP questions grouped into four Pulse Indices;
- temporary question-level insight capture outside the model context window;
- one natural confirmation interaction at Pulse Index level;
- question-level partial confirmation, correction, decline, and cutoff handling;
- continuous question scoring from confirmed semantic meaning;
- company-stable, versioned Scoring Policy;
- post-scoring de-identification and privacy validation;
- immediate deletion of non-anonymous analytical derivatives;
- persistent de-identified question insight records;
- strict separation between Employee Conversation Storage and analytics/reporting storage;
- the minimum downstream eligibility contract needed by later intermediate and final reporting work.

### Out of scope

- report layout, narrative, delivery, audience, cadence, and channel;
- Team, Unit, Manager, HR, HRBP, and Leadership aggregation rules;
- intermediate-report participation thresholds;
- final-report privacy thresholds and inference-attack controls;
- recommendation content and recommendation delivery;
- the numeric Engagement Index contract;
- long-term retention and deletion policy for original employee conversation messages;
- customer-facing dashboards;
- historical score backfill and scoring-policy migration tooling.

## 3. Approved MVP Question Model

The open-ended MVP backlog contains twelve questions:

| Pulse Index | Question count |
| --- | ---: |
| Autonomy | 3 |
| Growth | 3 |
| Purpose | 3 |
| Belonging | 3 |

Each question has a stable identity within a versioned survey definition. `Growth` is the approved term for V2; the V1 term `Mastery` is not used for these records.

The canonical meanings, all twelve scoring rubrics, approval metadata, and approved calibration examples are defined in [Scoring Policy 1.0.0](SCORING-POLICY.md), approved on 2026-10-01. This topic catalog supersedes the older seeded topic set; changed meanings require versioned question definitions and must not silently inherit historical answers. Supplemental examples explicitly marked Draft are not approved numerical targets.

Engagement is not part of this twelve-question open-ended scoring contract. Its separate numeric contract must be retained or changed through a dedicated decision.

## 4. Core Concepts

### Employee Conversation Storage

The private source-of-truth conversation history between one employee and the agent. Original inbound and outbound messages remain available to the employee experience and authorized conversation runtime so the agent does not lose continuity.

No customer organizational role, Company Admin, reporting process, analytics process, or customer-facing dashboard may read this store.

### Temporary Question Insight

A non-reportable working interpretation of what the employee has communicated about one question. It may contain concrete or identifying details and therefore belongs only in restricted temporary analytical storage.

### Confirmation Bundle

One natural-language confirmation message for a Pulse Index. It combines the meanings of up to three question-level temporary insights without revealing the questionnaire structure to the employee.

### Confirmed Semantic Question Summary

The question-level meaning authorized by the employee, either through agreement with the Confirmation Bundle or through a later clarifying answer. It is the scoring source and may still contain identifying details.

### De-identified Question Insight

The persistent, privacy-validated summary for one employee, Pulse Cycle, and question. It is the only textual analytical representation eligible for downstream aggregation.

The content is de-identified. The restricted processing layer may retain the tenant/person/cycle/question keys required for deduplication, lifecycle enforcement, withdrawal, and cohort eligibility, but must never expose those links to report consumers.

### Scoring Policy

A company-scoped, versioned contract containing question-specific evaluation instructions and anchors for a continuous `0–100` score.

## 5. Canonical Processing Flow

```text
Private employee conversation
  -> temporary question insights
  -> all three question meanings available for one Pulse Index
  -> one natural Index-level Confirmation Bundle
  -> per-question confirmation outcomes
  -> score confirmed semantic question summaries
  -> de-identify confirmed question summaries
  -> privacy validation and safe fallback if required
  -> atomically persist de-identified question insights and scores
  -> immediately purge non-anonymous analytical derivatives
```

Original conversation messages are not purged by this workflow. They remain isolated in Employee Conversation Storage under a separate retention policy.

## 6. Requirements

### 6.1 Temporary capture

#### IA-001 — Question-level working grain

The system shall maintain a separate Temporary Question Insight for each question rather than one undifferentiated working insight for the whole Pulse Index.

#### IA-002 — Durable working state

Temporary Question Insights shall be persisted outside the model context window so a long-running conversation does not lose already collected meaning.

#### IA-003 — Non-reportable temporary state

Temporary Question Insights shall never feed scoring, aggregation, recommendations, or reports.

#### IA-004 — Restricted temporary content

Temporary Question Insights may contain non-de-identified details but shall be readable only by the employee conversation and insight-processing runtime required to complete the current workflow.

#### IA-005 — Original-message separation

Temporary analytical storage shall be separate from Employee Conversation Storage. Purging a Temporary Question Insight shall not delete the original conversation message.

### 6.2 Index-level confirmation experience

#### IA-006 — One natural confirmation interaction

When sufficient meaning has been collected for the three questions of one Pulse Index, the agent shall present one coherent Confirmation Bundle rather than asking the employee to confirm each survey question separately.

#### IA-007 — Hidden questionnaire structure

The confirmation message shall not label question numbers or expose that the agent is completing a survey form.

#### IA-008 — Traceable composition

The system shall retain a machine-readable mapping from each statement in the Confirmation Bundle to its underlying Temporary Question Insight while confirmation is unresolved.

#### IA-009 — Bundle agreement

An unqualified employee agreement shall confirm all question meanings represented in the displayed Confirmation Bundle.

#### IA-010 — Partial agreement

When an employee explicitly accepts some meanings and rejects another, the accepted Question Insights shall become confirmed independently and the rejected Question Insight shall enter `pending_clarification`.

#### IA-011 — Clarification

The agent shall ask natural follow-up questions for the disputed meaning. A substantive employee clarification authorizes the corrected Question Insight without requiring the agent to display and reconfirm another complete bundle.

This MVP rule intentionally accepts the risk that the employee does not see the agent's final rewritten question summary.

#### IA-012 — Silence after clarification

Silence shall not be interpreted as refusal or negative evidence. The Question Insight shall remain `pending_clarification` until the employee replies or the Pulse Cycle reaches cutoff.

#### IA-013 — Explicit decline

An explicit request to skip, exclude, or stop discussing a question shall set the question outcome to `declined`. The agent shall not initiate the question again in the same Pulse Cycle unless the employee voluntarily reopens it.

#### IA-014 — Full rejection

If the employee rejects the complete Confirmation Bundle, all three temporary meanings shall be invalidated and the Pulse Index questions shall return to the backlog when time remains in the current cycle.

#### IA-015 — Cutoff conversion

At Pulse Cycle cutoff, each unresolved `pending_clarification` question shall become `no_data`. It shall not receive a summary or score.

### 6.3 Question and index lifecycle

#### IA-016 — Question outcomes

The analytical lifecycle shall distinguish at minimum:

- `collecting`;
- `pending_confirmation`;
- `pending_clarification`;
- `confirmed`;
- `declined`;
- `no_data`;
- `reset` or an equivalent auditable transition back to `collecting`.

#### IA-017 — No negative inference from absence

`declined`, `no_data`, silence, missing evidence, and an incomplete question shall never be converted to score `0`, a negative category, or negative report content.

#### IA-018 — Partial index completion

A Pulse Index may close with one or two confirmed Question Insights and the remaining questions marked `declined` or `no_data`.

#### IA-019 — Full employee-level Index eligibility

An employee-level Pulse Index score shall exist only when all three required questions have confirmed valid scores.

#### IA-020 — No synthetic partial Index score

The system shall not average one or two available question scores into an employee-level Pulse Index score.

The formula for a complete three-question employee-level Index remains a separate approved-design input; an equal-weight mean is not implicitly approved by this specification.

### 6.4 Continuous question scoring

#### IA-021 — Scoring source

The system shall calculate each question score from the Confirmed Semantic Question Summary before de-identification.

It shall not calculate the final question score directly from raw conversation messages, unconfirmed evidence, or the post-anonymization summary.

#### IA-022 — One rubric-based assessment

The V1 formula `0.7 × structured polarity + 0.3 × sentiment` is prohibited for open-ended V2 questions.

Each question shall receive one evaluation against its question-specific rubric.

The approved rubric catalog is [Scoring Policy 1.0.0](SCORING-POLICY.md). Each rubric has version `1.0.0` and approval date `2026-10-01`.

#### IA-023 — Continuous range

A valid confirmed question score shall be a continuous value in the inclusive range `0–100`.

For MVP, persisted question scores are integers, with every value from `0` through `100` permitted. Anchors `0`, `25`, `50`, `75`, and `100` guide assessment rather than restricting the allowed values. Intermediate scores use confirmed frequency, scope, and impact; confidence does not discount the score. Unknown causes do not prevent scoring a clear condition.

New confirmed information supplements the existing insight, preserving earlier de-identified experience and change history. The current score reflects the latest confirmed condition, not an average of earlier and later conditions. Record employee-attributed causes and link a relevant recommendation when known; temporal coincidence alone does not establish causation. Pending supplements do not change the confirmed score.

#### IA-024 — No score for unavailable meaning

`insufficient_evidence`, `declined`, `no_data`, and unresolved states shall have no score rather than a neutral or zero score.

#### IA-025 — Scoring metadata

Each persisted score shall include:

- Scoring Policy version;
- question-rubric version;
- model identifier;
- prompt version;
- confidence;
- calculation timestamp.

No private reasoning transcript or non-de-identified source text shall be persisted with the final score.

#### IA-026 — Company-stable policy

One Scoring Policy shall apply consistently across the company. It shall not change within a Pulse Cycle and should remain stable across cycles to preserve comparability.

#### IA-027 — Version boundary

Scores produced by different Scoring Policy versions shall not be used for an official trend unless the compared historical summaries have been rescored using the same policy.

If historical rescoring has not occurred, the first cycle under the new policy establishes a new baseline.

#### IA-028 — MVP trend sensitivity

Within one Scoring Policy version, every persisted non-zero score delta is meaningful for MVP trend direction:

- `delta > 0`: improving;
- `delta < 0`: declining;
- `delta = 0`: stable.

This is an experiment assumption and shall be reviewed after real-cycle calibration.

### 6.5 De-identification

#### IA-029 — Scoring precedes de-identification

The score shall be committed from the Confirmed Semantic Question Summary before the text is de-identified.

#### IA-030 — Mandatory privacy gate

No persistent Question Insight text may be written to analytics storage until a versioned De-identification Policy accepts it.

At minimum, the policy shall reject known person, manager, teammate, team, project, customer, and account identifiers; Slack handles; email addresses; phone numbers; URLs; exact dates or times; and source-message identifiers.

#### IA-031 — No MVP fidelity gate

MVP shall not run a separate semantic Fidelity Gate comparing the private and de-identified summaries.

The accepted MVP tradeoff is that de-identification may soften free-text wording while the pre-de-identification score retains the assessed criticality.

#### IA-032 — Safe retry and fallback

When a candidate fails the privacy gate, the system shall retry de-identification. After bounded retries, it shall use a controlled safe fallback that preserves a generalized direction, severity, and root-cause category without retaining identifying text.

The insight shall not be discarded solely because free-form de-identification failed.

#### IA-033 — Reportable text only

Persistent analytical text shall contain only the privacy-accepted de-identified Question Insight.

### 6.6 Persistence and immediate purge

#### IA-034 — Persistent question grain

The final analytical record shall be unique for one tenant, employee, Pulse Cycle, survey definition, and question version.

#### IA-035 — Persistent payload

The final record shall contain only the data required for controlled downstream use, including:

- de-identified Question Insight;
- question score when the confirmed condition is evaluable, otherwise `insufficient_evidence` with no numeric score;
- scoring and privacy policy versions;
- confidence and technical version metadata;
- confirmation and processing timestamps;
- lifecycle and withdrawal state;
- restricted tenant/person/cycle/question keys.

It shall not contain private summary text, raw conversation text, reconstructable prompt payloads, or resolvable source-message links.

#### IA-036 — Atomic completion boundary

The system shall durably persist the privacy-accepted Question Insight and its valid score, or explicit `insufficient_evidence` outcome with no score, before deleting the corresponding non-anonymous analytical derivatives.

Persistence and purge shall form an idempotent workflow that cannot leave a reportable record without its required score or explicit unscored outcome, or delete the only usable source before successful completion. Confirmed unscored insights are eligible for qualitative analysis but not numeric aggregation or complete scored-index eligibility.

#### IA-037 — Immediate analytical purge

Immediately after successful completion, the system shall delete or irreversibly redact:

- the Temporary Question Insight content;
- the Confirmed Semantic Question Summary content;
- intermediate analytical prompt payloads;
- intermediate analytical model outputs containing identifying details;
- any analytical copy of conversation excerpts.

#### IA-038 — Non-confirmed cleanup

Temporary analytical content shall also be purged when it is declined, reset, superseded, or converted to `no_data` at cutoff.

#### IA-039 — Conversation preservation

Original employee conversation messages shall remain in Employee Conversation Storage after analytical derivatives are purged.

### 6.7 Isolation and access

#### IA-040 — No organizational-role access

Team Lead, Manager, HR, HRBP, Leadership, and Company Admin shall not receive access to original employee messages, Temporary Question Insights, Confirmed Semantic Question Summaries, or identifiable employee-level analytical records.

#### IA-041 — Runtime-only private access

Only the employee-facing conversation runtime may read original messages for employee continuity, subject to tenant and employee scope. Human internal tooling shall not treat shared administrative credentials as authorization to browse private conversations or temporary insights.

#### IA-042 — Analytics isolation

Analytics and reporting processes shall consume only de-identified Question Insights, scores, safe metadata, and the restricted identity keys needed for policy enforcement.

They shall not traverse from an analytical record to original conversation content.

#### IA-043 — Employee rights boundary

Employee export, deletion, and future self-review rights for private conversation data remain governed by a separate privacy and retention contract. This specification does not remove those rights.

### 6.8 Downstream reporting bridge

#### IA-044 — Intermediate input eligibility

An employee may contribute a complete employee-level Pulse Index to an intermediate report only when all three question insights for that index are confirmed and scored.

#### IA-045 — Final input eligibility

At final-cycle cutoff, every confirmed Question Insight may be supplied to the final-report analysis even when the employee has only one or two confirmed questions in the Pulse Index.

#### IA-046 — Partial final input

For a partial employee response, downstream processing receives the available question-level scores and de-identified summaries but no synthetic employee-level Pulse Index score.

#### IA-047 — Zero-information employee

An employee with no confirmed Question Insights contributes no analytical content. Their absence must not lower a score or create negative evidence.

Reporting thresholds, aggregation formulas, anonymity floors, and recommendation-generation rules are deferred to the Reporting specification.

## 7. State Examples

### Complete index

```text
Q1 confirmed + score
Q2 confirmed + score
Q3 confirmed + score
=> Index eligible for complete employee-level calculation
=> Eligible as an intermediate-report input, subject to later cohort rules
```

### Partial index at cutoff

```text
Q1 confirmed + score
Q2 confirmed + score
Q3 pending_clarification -> no_data
=> No employee-level Index score
=> Q1 and Q2 remain eligible final-report inputs
```

### Explicit decline

```text
Q1 confirmed + score
Q2 declined
Q3 confirmed + score
=> No employee-level Index score
=> Q2 creates no negative or neutral signal
```

### Full rejection

```text
Index Confirmation Bundle rejected
=> invalidate three temporary meanings
=> purge their analytical content
=> reopen three questions when the cycle still permits
```

## 8. Acceptance Criteria

1. The system can store separate temporary meanings for all three questions of an index while presenting one natural confirmation message.
2. One agreement can confirm all represented question meanings.
3. A partial correction preserves accepted meanings and opens clarification only for the disputed question.
4. A clarifying employee answer can confirm the corrected question without another displayed confirmation bundle.
5. Silence remains pending until cutoff; explicit refusal becomes `declined`.
6. Cutoff converts unresolved clarification to `no_data` without creating a score.
7. A partial index never receives a synthetic employee-level Index score.
8. Open-ended question scoring does not call the V1 polarity/sentiment formula.
9. A score is created only from confirmed pre-de-identification semantic meaning.
10. Every persisted score is `0–100` and carries Scoring Policy provenance.
11. A Scoring Policy cannot change mid-cycle.
12. A privacy-rejected summary never enters analytical storage.
13. The final analytical record contains de-identified question text and no reconstructable private analytical text.
14. Non-anonymous analytical derivatives are purged immediately after durable completion.
15. Declined, reset, superseded, and cutoff-expired temporary content is purged.
16. Original conversation messages remain available to the employee-facing runtime after analytical purge.
17. Customer organizational roles cannot access employee-level private or identifiable analytical content.
18. Intermediate-input selection requires `3/3`; final-input selection may include `1/3` or `2/3` without treating missing questions as negative.

## 9. Deferred Decisions Required Before Full Reporting Implementation

- approval of supplemental draft calibration fixtures and automated calibration acceptance criteria (the twelve rubrics and reviewed examples are approved in Scoring Policy 1.0.0);
- aggregation precision and display rounding (question-level integer precision is approved);
- complete three-question employee-level Index formula;
- numeric Engagement Index scale and its relationship to `0–100` reports;
- intermediate participation threshold;
- final aggregation formula for partial question coverage;
- team and Unit aggregation boundaries under the new hierarchy;
- trend presentation when team composition changes;
- recommendation generation and evaluation;
- report anonymity and overlap protections;
- employee correction or withdrawal after a persistent de-identified insight has been created;
- long-term Employee Conversation Storage retention and human support-access policy.

## 10. Explicitly Rejected V1 Assumptions

- per-question confirmation messages;
- `70% structured polarity + 30% sentiment` scoring;
- three-state `positive / neutral / negative` as the final scoring scale;
- scoring from unconfirmed evidence;
- calculating a partial employee-level Index by ignoring missing questions;
- treating silence, decline, or missing data as neutral or negative;
- persisting non-anonymous analytical summaries for later debugging;
- using the post-anonymization text as the MVP scoring source;
- a five-point threshold before any positive or negative trend can be recognized.

## 11. Implementation Boundary

Implementation must remain in the active TypeScript domain/application/API/worker/database/dashboard paths. Retired MAF and `agent-service` surfaces are not part of this feature.

No existing applied migration may be rewritten. The implementation requires forward migrations and an explicit migration/quarantine plan for existing group-level states, evidence, assessments, and report snapshots.

## 12. Grill Decision Traceability

| Grill decision | Approved outcome | Requirements |
| --- | --- | --- |
| 1 | Store separate question summaries; present one Index-level confirmation | IA-001, IA-006–IA-009 |
| 2 | Support partial confirmation and clarification rather than all-or-nothing confirmation | IA-010–IA-011 |
| 3 | Clarifying answer confirms the corrected meaning without redisplay | IA-011 |
| 4 | Silence remains pending until cycle cutoff | IA-012, IA-015 |
| 5 | Explicit refusal is `declined`, not `no_data` | IA-013, IA-017 |
| 6 | Partial question data is retained, but no partial employee Index is calculated | IA-018–IA-020, IA-045–IA-047 |
| 7 | Reject the V1 polarity/sentiment weighted formula | IA-022 |
| 8 | Use continuous question scoring from `0–100` | IA-023–IA-025 |
| 9 | Treat every non-zero same-policy delta as directional for MVP | IA-028 |
| 10 | Score confirmed semantic meaning before de-identification | IA-021, IA-029 |
| 11 | Preserve privacy validation, but do not make semantic fidelity a discard condition | IA-030–IA-032 |
| 12 | Use controlled safe fallback instead of dropping an insight after de-identification failures | IA-032 |
| 13 | Use a company-stable, versioned Scoring Policy | IA-025–IA-027 |
| 14 | Do not add a separate runtime Fidelity Gate in MVP | IA-031 |
| 15 | Purge non-anonymous analytical derivatives immediately after durable completion | IA-034–IA-038 |
| 16 | Keep analytical derivatives separate from original conversation messages | IA-005, IA-039 |
| 17 | Preserve original private conversation for employee-agent continuity | IA-039–IA-043 |
