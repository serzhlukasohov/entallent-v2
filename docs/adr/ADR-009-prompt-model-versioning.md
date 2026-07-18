# ADR-009: Prompt and Model Versioning

**Status:** Accepted  
**Date:** 2025-01

## Context

AI behavior is determined jointly by the prompt and the model. When either changes:
- Existing assessments (survey evidence, memory items, risk signals) may no longer be comparable to new ones
- Regressions are hard to detect without reproducible baselines
- A/B testing between prompt versions requires knowing which version produced each output

The system needs a way to version AI outputs so that:
1. Each LLM output is attributed to its prompt version and model
2. Changed behavior is detectable via regression tests (Promptfoo)
3. Historical data is not retroactively invalidated by prompt changes

## Decision

### Version tracking

Each AI output is tagged with the version of the prompt template that produced it:

- `SurveyEvidenceRecord.evaluatorVersion` — which survey evaluator prompt was used
- `MemoryItemRecord.extractorVersion` — which memory extractor prompt was used
- `LlmRunRecord.taskType` + `model` — full model + task attribution

Versions are semver strings defined as constants in the prompt modules, e.g.:
```typescript
export const SURVEY_EVALUATOR_VERSION = '1.0.0';
export const MEMORY_EXTRACTOR_VERSION = '1.0.0';
```

### Prompt storage

Prompts are stored **in source code** (not in the database) for the MVP. Rationale:
- Prompts change with code deployments — version control is the right tool
- Database-stored prompts add operational complexity without clear benefit at this scale
- A/B prompt testing is handled via feature flags on the prompt version constant

### Re-scoring

When a prompt version changes significantly:
1. The old `evaluatorVersion` is preserved on historical records
2. A re-scoring background job can re-run the new evaluator against historical conversations
3. New assessments immediately use the new version

### Model routing

Per-task model routing (analysis tasks use `gpt-4o-mini`, generation uses `gpt-4o`) is configured at the infrastructure level via `ModelConfig`. The choice is recorded in `llm_runs` for cost tracking.

See `ModelConfig` in `packages/ai-openai/src/openai-provider.ts`.

### Admin visibility

`GET /admin/prompt-versions` returns `CURRENT_PROMPT_VERSIONS` from source code plus the version distribution from `llm_runs` in the last 30 days, allowing operators to verify a deployment took effect.

## Consequences

**Positive:**
- Every AI output is attributable to a specific prompt + model combination
- Regression tests (Promptfoo) can pin to a specific prompt version
- Survey evidence from different versions can be segregated for fair comparison

**Negative:**
- In-database prompts would allow hot-swapping without deployment — not supported in MVP
- Re-scoring jobs are expensive; must be scheduled carefully
- Version constants must be manually bumped when prompts change

## Related decisions

- ADR-005 — AI cannot mutate domain state directly (all outputs are proposals)
- ADR-007 — Survey evidence tracks evaluatorVersion for reproducibility
- EVALS.md — Promptfoo evaluation framework
