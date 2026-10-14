# ADR-013: Replace Lexical Heuristics with Turn Understanding, Policy Engine, and Rails

**Status:** Accepted (open questions resolved 2026-10-13; see "Resolved decisions")
**Date:** 2026-10-13
**Related:** ADR-003 (pgvector), ADR-005 (LLM cannot mutate state), ADR-007 (survey state machine), ADR-008 (privacy analytics), ADR-009 (prompt/model versioning), ADR-012 (TypeScript runtime spine)
**Inventory:** [`docs/heuristics/signal-inventory.md`](../heuristics/signal-inventory.md)

## Context

A 2026-10-13 audit of the active TypeScript runtime found that semantic decisions are nominally made by the LLM (ADR-005), but a large layer of hand-written heuristics sits around the model and frequently overrides it:

- **Lexical overrides of model understanding.** About 15 EN/RU/UK regexes in `packages/ai-openai/src/openai-provider.ts` rewrite the classifier's `primaryIntent`, `surveyAllowed`, `dialogueAct`, and `pulseCaptureScope` through an order-dependent chain of five normalizers. Language, "be brief" requests, pulse-capture scope, explicit 0–10 ratings, reminder times, and private identifiers are also decided by regex in `packages/application`.
- **Thresholds on uncalibrated self-reported confidence.** Values such as 0.35, 0.5, 0.6, and 0.75 gate memory, follow-ups, and survey evidence. One opposite-polarity item with confidence ≥ 0.75 erases all prior evidence.
- **Lexical similarity instead of semantics.** `contentSimilarity` uses English stopwords (including `not`) and English suffix stripping. Follow-up dedup keys strip every non-ASCII character, so Russian and Ukrainian topics collide. ADR-003 promised embedding retrieval, but no embeddings exist in the schema or code.
- **Safety gated by a classifier flag.** `detectRisk` runs only when the intent classifier sets `requiresSafetyCheck`. Otherwise `safeDefault()` fabricates `severity: none, confidence: 0.99`.
- **Scattered policy constants.** Cohort minimum, risk TTL, quiet hours, cadence, and slug rules are duplicated with drift. For example, quiet hours end at 8 in the application and at 9 in the domain. `minimumEvidenceCount` is stored but never enforced. Several aggregates count evidence rows instead of distinct people.

The heuristics exist because model errors were patched case by case without a way to measure signal quality. Removing them without adding measurement would bring the same failures back.

## Decision

Adopt a four-stage pipeline with a strict rule about where deterministic logic may live:

```
inbound turn
  │
  ├─ ① Turn Understanding (TU) — one structured LLM call, versioned schema
  ├─ ① Safety Assessment       — independent, always on, parallel to TU
  │
  ▼
  ② Policy Engine — pure TypeScript domain rules over typed signals
  │
  ▼
  ③ Structured Generation — reply schema encodes constraints
  │
  ▼
  ④ Rails — deterministic validators + at most one repair, then fail closed
```

### D1. Turn Understanding owns every semantic signal

A single `TurnUnderstanding` contract in `packages/contracts` replaces the classifier output and the regex normalizers. Its fields include `intent`, `secondaryIntents`, `dialogueAct`, `responseLanguage` (BCP-47), `verbosityRequest`, `reminder` (ISO-8601 instant plus IANA zone, resolved against the user's profile timezone), `explicitRating` (value plus quoted source span), `pulseCaptureScope` (referenced message id), `closing`, `correction`, `dataUseQuestion`, and `entities` (private identifiers with spans).

- Signals that need source evidence, such as a rating or a quoted message, must return a span. The Policy Engine verifies that the span occurs verbatim in the turn. That check is structural validation, not interpretation.
- The schema is versioned per ADR-009, and every field has an eval set (D7).

### D2. Lexical rules may validate structure but never override semantics

After migration, a regex or keyword list is allowed only in these cases:

1. **Format-defined data** with a canonical grammar, such as email, URL, UUID, or phone numbers parsed with `libphonenumber-js`.
2. **Structural validation of model output**, such as span verification, schema shape, or length.
3. **Monotonic safety escalation.** A lexical safety tripwire may *raise* severity or force a safety assessment. It may never lower severity, suppress safety handling, or rewrite an intent.

Any other lexical rule is a defect tracked in the inventory.

### D3. Safety assessment is independent and never fabricated

- Risk assessment (`detectRisk`, temperature 0) runs on every inbound turn, in parallel with TU, and does not depend on the intent classifier. Where the provider exposes a moderation signal, it is added as a monotonic tripwire per D2 (R1 below).
- `RiskDetection` gains an explicit `assessed: boolean`. Unassessed results carry no confidence value, and consumers must treat them as unknown, not as safe.
- Escalation and expiry rules move to the Policy Engine, with a single definition.

### D4. Policy Engine: named, versioned, tested rules

- Deterministic product rules live in `packages/domain` or `packages/application` as named specifications, for example `CanProbeSurvey`, `MustEscalate`, `InQuietHours`, `CanSendProactive`, and `IsCohortReportable`.
- They read thresholds from one **policy registry**, which replaces the scattered constants.
- Each registry entry records owner, rationale, version, and whether it is tenant-configurable. Per ADR-008, the cohort minimum is not tenant-configurable.
- Policy decisions are audited with the policy version that produced them.

### D5. No raw thresholds on self-reported confidence

- LLM-reported confidence may not gate a decision until it is calibrated per signal against a labeled set, for example with isotonic or Platt scaling, or replaced by token log-probabilities.
- The calibration version is stored next to the threshold in the registry.
- Until a signal is calibrated, its threshold is marked `uncalibrated` in the inventory and cannot be tightened or loosened without eval evidence.

### D6. Semantic similarity uses embeddings plus model reconciliation

- Memory and survey-evidence deduplication follow the retrieve-then-reconcile pattern used by Mem0 and LangMem.
- First, retrieve the top-k candidates through pgvector, which finally implements ADR-003 behind `VectorRepositoryPort`.
- Then the model chooses `ADD | UPDATE | SUPERSEDE | NOOP` against those candidates.
- The application validates and persists the result (ADR-005).
- Opinion reversal becomes a `SUPERSEDE` of specific records, not a wipe of all history.
- Follow-up idempotency keys use a Unicode-normalized hash of `(userId, type, normalizedTopic)`, not ASCII slugs.

### D7. Every migrated signal has an eval set and a CI gate

- Each TU field, the safety assessment, and reconciliation get a labeled EN/RU/UK dataset under `packages/conversation-sim`.
- Each one gets per-signal precision and recall gates in `pnpm sim:gate`.
- Safety recall is gated separately and must not regress.
- Grader heuristics, such as question counting and opener antipatterns, read the same structured fields as runtime rails, so the grader and runtime cannot disagree.

### D8. Structured generation encodes reply constraints

- The response schema separates `replyText` from `question: string | null` and any probe payload.
- "At most one question" and numeric-probe format become schema properties.
- Rails still check that `replyText` contains no additional question and respects the length budget. On failure they allow one repair and then fail closed, as today.

### D9. Analytics use statistical disclosure control

- Every published aggregate is gated on **distinct contributing people**, not rows.
- Averages require at least k actual scores, not k reportable states.
- An empty result is `null`, never `0`.
- Snapshot sequences are checked for differencing, meaning consecutive snapshots that differ by fewer than k contributors are not both published.
- Published values are coarsened (integers or bands) so that a mean and n do not reveal an exact sum.
- No differential-privacy noise for team reports (R3 below).

### D10. Infrastructure timing uses infrastructure primitives

- Rapid-message coalescing moves from hand-written timestamp comparison to BullMQ job deduplication in debounce mode (`deduplication: { id, ttl, extend, replace }`, available in the installed bullmq 5.80). The key is per conversation and user.
- The window becomes a policy registry entry.

### D11. Migration is per signal and strangler-style

For each signal:

1. Add the TU or registry field.
2. Run it in shadow next to the heuristic and record disagreements in existing shadow diagnostics.
3. Measure against the eval set.
4. Switch the read path.
5. Delete the heuristic and its tests.

Wave order is given in the inventory. Archived MAF code (`maf-primary-agent-runtime.ts`, `internal-maf-context`) is out of scope and is not migrated (ADR-012, AGENTS.md).

## Alternatives considered

1. **Keep the heuristics, centralize them, and add Cyrillic support.** This is cheap and fixes concrete bugs, but regexes still overrule the model and every new phrasing needs another rule. It is acceptable only as a stopgap for production bugs found before their wave.
2. **Fine-tuned small classifier per signal.** This gives lower latency and cost per call, but it needs a labeled corpus the project does not yet have. It can be reconsidered once D7 datasets exist, behind the same contract.
3. **Adopt a framework wholesale, such as Rasa CALM or NeMo Guardrails.** These frameworks validate the pattern: model output becomes commands, deterministic flows execute them, and rails check output. However, both are Python-first, and ADR-012 fixes the runtime to TypeScript. We adopt the pattern, not the framework.
4. **Separate LLM call per signal.** This makes each signal simpler to evaluate, but it multiplies latency and cost. One TU call with a structured schema plus one parallel safety call was chosen. A signal is split out only if eval shows interference.

## Consequences

**Good:**

- Each behavior has exactly one owner: TU for meaning, the Policy Engine for decisions, Rails for structure.
- Language coverage stops depending on hand-written word lists.
- Safety handling no longer depends on intent classification and never reports a fabricated "no risk".
- Thresholds become auditable artifacts with evidence instead of magic numbers.
- Analytics privacy guarantees match ADR-008's intent, counting people rather than rows.

**Bad:**

- Building the eval datasets is the largest cost and is a prerequisite for every wave.
- An always-on safety call adds cost per turn. Latency impact must be measured, because the call runs in parallel.
- An embedding pipeline adds a dependency on an embedding model, a backfill job for existing memory and evidence, and a migration with a vector column and index.
- During migration, both paths run in shadow, which temporarily increases code and diagnostics volume.
- Behavior becomes less predictable for hand-written test phrases. Tests that assert exact regex-driven outcomes must be rewritten as eval cases.

## Resolved decisions (2026-10-13)

Findings that shaped these decisions:

- `EscalationStubService` (`apps/worker/src/safety/escalation-stub.service.ts`) only appends an audit log entry and logs a warning. No human receives escalations today, including `critical`.
- `detectRisk` currently runs after classification (classify → risk ‖ probe → generate) at the default temperature 0.3. On Azure, analysis and generation share one deployment.

Decisions:

- **R1 (was Q1): safety assessment.** Run `detectRisk` on every turn, in parallel with TU, at temperature 0. Dedicated moderation classifiers (OpenAI moderation, Azure Content Safety, Llama Guard) do not cover workplace burnout or harassment, so they cannot replace it. Where the provider exposes a moderation signal (OpenAI moderation endpoint, Azure content-filter annotations), use it only as a monotonic tripwire that can raise severity or force safety handling. Safety recall on the eval set is a hard gate.
- **R2 (was Q2): private identifiers.** Add a TU or insight `entities` field with source spans, and validate format-defined PII with canonical libraries such as `libphonenumber-js`. A Presidio sidecar is reconsidered only if the eval shows name recall below the target set in Wave 0.
- **R3 (was Q3): analytics privacy.** No differential privacy for team reports. With n = 5 on a 0–100 scale and ε = 1, Laplace noise has scale ≈ 20 points, which makes reports useless. Apply D9 instead: k on distinct people, differencing protection, coarsening, and `null` for empty results. Differential privacy may be revisited for organization-wide aggregates with large n.
- **R4 (was Q4): latency budget.** p95 end-to-end turn latency must not exceed the pre-migration baseline by more than 10%. Wave 0 measures the baseline from `llm_runs.latency_ms` and turn timestamps before any change. Running safety in parallel is expected to remove one sequential step on risk turns.
- **R5 (was Q5): escalation.** First, build a real escalation channel to a designated safety or HR reviewer. It must not go to the employee's manager (ADR-008), and it needs delivery, acknowledgment, and audit. The severity threshold (`critical` only, or also `high`) is decided together with that reviewer once the channel exists and has eval data on false positives. Until then the current `critical` / `immediateResponseRequired` rule stays.
