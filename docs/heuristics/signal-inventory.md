# Heuristic Signal Inventory

**Owner ADR:** [ADR-013](../adr/ADR-013-understanding-policy-rails.md)
**Snapshot:** 2026-10-13, branch `codex/insight-analysis-v2-spec`. Line numbers are from this snapshot; prefer the symbol name when they drift.
**Scope:** the active TypeScript runtime only. Archived MAF code (`maf-primary-agent-runtime.ts`, `apps/api/src/internal-maf-context`) is listed under "Out of scope" and is not migrated.

## Classes

| Class | Meaning | ADR-013 target |
|---|---|---|
| **S** | Semantic decision made lexically (regex or keyword list) | Turn Understanding field (D1), verified by rails (D2) |
| **K** | Threshold on uncalibrated LLM confidence | Calibrated threshold in the policy registry (D5) |
| **M** | Lexical similarity or dedup | Embeddings plus reconciliation (D6), or a Unicode-safe key |
| **P** | Product policy constant | Named policy plus registry entry (D4). It stays deterministic. |
| **G** | Safety gating | Independent safety assessment (D3) |
| **A** | Analytics or disclosure rule | Disclosure control: k on distinct people, null instead of 0 (D9) |
| **R** | Structural validation of model output | Keep as a rail (D2/D8), aligned with the schema |
| **I** | Infrastructure timing or retry | Infrastructure primitive plus registry entry (D10) |

Status values: `migrate` (replace), `keep` (allowed under D2, centralize only), `fix-now` (a live defect to patch before its wave).

## 1. Turn understanding (class S)

| ID | Signal / decision | Current mechanism | Location | Known defects | Target | Wave |
|---|---|---|---|---|---|---|
| S1 | Reporting-explanation intent | `EXPLICIT_REPORTING_EXPLANATION_REQUEST` regex; `normalizeReportingExplanation` demotes or strips the model intent | `packages/ai-openai/src/openai-provider.ts:559,764` | Anchored literal sentences look fitted to tests; overrides the model in both directions | TU `intent` | 2 |
| S2 | Data-use question | `EXPLICIT_DATA_USE_REQUEST` (+ localized), `normalizeDataUseExplanation`; quote characters mark the turn as a "control request" | `openai-provider.ts:571,684` | Quoting text can strip safety-adjacent intents | TU `dataUseQuestion` | 2 |
| S3 | Correction request | `EXPLICIT_CORRECTION_REQUEST_PREFIX`, `normalizeExplicitCorrectionRequest` | `openai-provider.ts:555,857` | `^no\b` marks any "no…" reply as a correction | TU `correction` | 2 |
| S4 | Closing turn | `EXPLICIT_CLOSING`, `normalizeExplicitClosing` | `openai-provider.ts:557,827` | Phrase list; drives memory and follow-up drop (`memory-extraction.use-case.ts`) | TU `closing` | 2 |
| S5 | Pulse-capture explanation and scope | `PULSE_CAPTURE_QUESTION_FRAGMENT` (safety-turn tripwire only), `normalizePulseCaptureExplanation`; `resolvePulseCaptureScope` (English-only, quote ≥24 chars, exact match). **Partially closed 2026-10-15 (GC round 3 CAP-5):** `EXPLICIT_PULSE_CAPTURE_REQUEST` and the canned `PULSE_CAPTURE_TEXT` reply are removed; the intent comes only from the classifier and the orchestrator passes capture state to the reply model as grounded `captureFacts`. | `openai-provider.ts` (`PULSE_CAPTURE_QUESTION_FRAGMENT`, `normalizePulseCaptureExplanation`); `conversation-orchestrator.ts` (`resolvePulseCaptureScope`) | English-only scope phrases remain | TU `pulseCaptureScope{messageId}` plus span rail | 2 |
| S6 | Mixed-action request, "help me understand" | `MIXED_ACTION_REQUEST`, `HELP_UNDERSTAND_PREFIX` | `openai-provider.ts:581,585` | English only | TU `secondaryIntents` | 2 |
| S7 | Normalizer chain order | Five nested normalizers; a later step can undo an earlier one | `openai-provider.ts:249-253` | Order-dependent semantics | Removed when S1–S6 migrate | 2 |
| S8 | Reminder request and time | `EXPLICIT_REMINDER_REQUEST`; prompt default of 09:00 next morning; a past time is moved to now + 1 min | `openai-provider.ts:583`; `prompts/classify.ts`; `conversation-orchestrator.ts` (reminder resolution) | Timezone handling implicit | TU `reminder{instant, tz}` plus parser rail | 3 |
| S9 | Response language | **Removed 2026-10-13.** Product decision: customers are English-speaking, so replies are always English (`resolveLanguagePolicy()` returns a constant). No lexical inference remains. | `packages/application/src/utils/language-policy.ts` | Russian/Ukrainian test teams get English replies by design | If non-English customers arrive: model `responseLanguage` + validation + eval, parked on local branch `codex/parked-model-language` | — |
| S10 | "Be brief" request | `isDirectConciseRequest` en/ru/uk regex; mode persists for a `SESSION_GAP_HOURS=5` session | `conversation-orchestrator.ts:1750`; `utils/session.ts:1` | Brittle to paraphrase | TU `verbosityRequest`; session rule becomes a P entry | 3 |
| S11 | Explicit 0–10 rating | `parseExplicitZeroToTen`: "N/10", "N out of 10", or any lone number 0–10 | `survey-evidence.use-case.ts:503` | "3 meetings today" can parse as a rating; number words are ignored | TU `explicitRating{value, span}` plus span rail | 3 |
| S12 | Private identifiers in insights | `extractPrivateIdentifiersFromSource`: capitalized-word regex and an opener allowlist | `finalize-question-insight.use-case.ts:236` | Over-redacts brand names and "I'm"; misses lowercase names | TU or insight `entities` with spans (R2); Presidio only if eval recall misses target | 4 |
| S13 | De-identification checks | `evaluateDeidentification` (v1, English months), `evaluateQuestionDeidentification` (v2, Unicode, ru/uk months) | `utils/deidentification-policy.ts:30`; `utils/question-deidentification-policy.ts:9` | Substring match on known identifiers gives false positives | Split: format-defined PII stays a rail (`keep`); named entities move to S12 | 4 |
| S14 | Enum coercion and silent repair | Invalid `primaryIntent` becomes `casual_conversation`; `pulseCaptureScope.catch({type:'unresolved'})`; `dialogueAct` defaults to `new_substance` | `openai-provider.ts:241-247`; `packages/contracts/src/ai.ts:108` | Model errors disappear without telemetry | Strict TU schema; repair counted as a rail failure | 2 |
| S15 | Proactive forbidden phrases | `forbiddenPatterns: ['checking in', 'just wanted to check', 'reminder']` | `proactive-check-in.use-case.ts:137`; `follow-up-execution.use-case.ts` | English only | Style eval (D7); keep only as a multilingual rail if eval shows need | 3 |
| S16 | Opener antipatterns | `OPENER_ANTIPATTERNS` (7 anchored English regexes) | `packages/ai-openai/src/prompts/style-antipatterns.ts:8` | English only | Eval judge criterion; remove as a hard rule | 3 |

## 2. Safety (class G)

| ID | Signal / decision | Current mechanism | Location | Known defects | Target | Wave |
|---|---|---|---|---|---|---|
| G1 | Whether risk is assessed | `detectRisk` runs only if `classification.requiresSafetyCheck`; `SAFETY_INTENTS` force the flag | `conversation-orchestrator.ts:334,1866` | A classifier miss skips safety | Always-on parallel assessment (D3) | 1 |
| G2 | Unassessed result | `safeDefault()` returns `severity:'none', confidence:0.99` | `conversation-orchestrator.ts:1695` | Fabricated confidence | `assessed:false`, no confidence | 1 (`fix-now`) |
| G3 | Escalation | Only `critical` or `immediateResponseRequired` | `conversation-orchestrator.ts:531` | `high` never escalates | `MustEscalate` policy; threshold decided with the reviewer after G8 (R5) | 1 |
| G8 | Escalation delivery | `EscalationStubService` writes an audit entry and a warning log only | `apps/worker/src/safety/escalation-stub.service.ts` | **No human is notified, even for `critical`** | Real channel to a safety/HR reviewer (not the manager), with acknowledgment and audit (R5) | 1 (`fix-now`) |
| G9 | Risk call determinism | `detectRisk` uses the default temperature 0.3 and runs after classification | `packages/ai-openai/src/openai-provider.ts:264` | Non-deterministic safety output; adds a sequential step | Temperature 0, parallel with TU (R1) | 1 |
| G4 | Reply mode by severity | `buildReplyStrategy`: critical → crisis, high → sensitive; medium/low ignored | `conversation-orchestrator.ts:1868` | Fixed intent→mode table | Policy entry | 1 |
| G5 | Risk TTL | `computeRiskExpiry`: 90/30/7 days | `conversation-orchestrator.ts:1687` (duplicate in archived MAF runtime) | Duplicated | Registry entry | 1 |
| G6 | Follow-up postpone on risk | Active high/critical risk postpones by 4 h | `follow-up-execution.use-case.ts:102-104` | — | `CanSendProactive` policy | 3 |
| G7 | Safety context window | Risk prompt sees `slice(-15)` turns | `packages/ai-openai/src/prompts/risk.ts` | Older context drops out | Safety assessment receives the active risk state plus a window | 1 |

## 3. Confidence thresholds (class K)

| ID | Decision | Constant | Location | Known defects | Target | Wave |
|---|---|---|---|---|---|---|
| K1 | Keep survey evidence | `MIN_EVIDENCE_STRENGTH = 0.35` | `survey-evidence.use-case.ts:13` | Uncalibrated | Calibrated registry entry | 4 |
| K2 | Opinion reversal wipes history | `OPINION_REVERSAL_CONFIDENCE_THRESHOLD = 0.75` | `survey-evidence.use-case.ts:22` | One misclassified turn erases all evidence | `SUPERSEDE` via reconciliation (D6) | 4 |
| K3 | Schedule a follow-up | `MIN_CONFIDENCE = 0.6` | `follow-up-scheduler.use-case.ts:16` | Uncalibrated | Calibrated registry entry | 3 |
| K4 | Question scored | `confidenceThreshold`/`completenessThreshold` per question, or the model's `thresholdReached` | `utils/survey-scoring.ts:8` | The model flag bypasses thresholds | Policy decides; `thresholdReached` becomes advisory | 4 |
| K5 | Partially covered | completeness ≥ 0.4 | `utils/survey-scoring.ts:14` | Uncalibrated | Registry entry | 4 |
| K6 | Minimum evidence count | `minimumEvidenceCount` stored (seed: 1–2) | `packages/database/src/schema/survey.ts:52` | **Never enforced** | Enforce in the scoring policy | 4 (`fix-now`) |
| K7 | Style adaptation | `EMA_ALPHA=0.3`, weight step 0.075, cap 0.4, `STYLE_CONFIDENCE_FLOOR=0.15` | `utils/style-adaptation.ts:3,12` | Intentional gradual mirroring (product spec) | `keep` as policy; add eval | — |

## 4. Similarity and dedup (class M)

| ID | Decision | Mechanism | Location | Known defects | Target | Wave |
|---|---|---|---|---|---|---|
| M1 | Text similarity | `contentSimilarity`: overlap coefficient, English stopwords including `not`, English suffix stripping | `utils/text-similarity.ts:7,20` | Negation ignored; Cyrillic unsupported; a subset of a longer text scores 1.0 | Embeddings via `VectorRepositoryPort` | 4 |
| M2 | Memory dedup | `DUPLICATE_SIMILARITY_THRESHOLD = 0.6` on M1 | `memory-extraction.use-case.ts:10` | Inherits M1 | Retrieve top-k, then reconcile | 4 |
| M3 | Evidence dedup | `EVIDENCE_SIMILARITY_THRESHOLD = 0.5` on M1 | `survey-evidence.use-case.ts:15` | Inherits M1 | Retrieve top-k, then reconcile | 4 |
| M4 | Follow-up idempotency key | `toLowerCase().replace(/[^a-z0-9]/g,'_').slice(0,32)` | `conversation-orchestrator.ts:1684`; `follow-up-scheduler.use-case.ts:80`; `apps/worker/src/followup/repositories/scheduled-action.repository.ts:101` | Cyrillic topics collapse and collide | Unicode NFKC plus hash key; a compatible rollout for existing keys | 1 (`fix-now`) |
| M5 | Backfill windows | `WINDOW_SIZE = 15`, `STEP = 10` | `survey-evidence.use-case.ts:172` | Overlap double-counts unless dedup catches it | Reconciliation handles overlap | 4 |
| M6 | Goal selection | Exact normalized match of topic anchor to goal title | `conversation-orchestrator.ts` (goal resolution) | Rarely matches | TU `goalRef` resolved over goal ids | 3 |

## 5. Product policy (class P) — stays deterministic, moves to the registry

| ID | Policy | Value | Location | Issue |
|---|---|---|---|---|
| P1 | Quiet hours | 22–8 in the app, 22:00–09:00 in the domain | `utils/quiet-hours.ts:7`; `packages/domain/src/tenant/tenant.ts:54-55` | **Conflicting defaults** |
| P2 | Proactive daily cap and gaps | `DAILY_PROACTIVE_LIMIT=1` (postpone 12 h), `MIN_INBOUND_GAP_MS=2h` (postpone 1 h); domain says max 2/day, 5/week | `follow-up-execution.use-case.ts:23,25`; `tenant.ts` | App and domain disagree |
| P3 | Check-in cadence | silence 3 d, gap 3 d, batch 50, scan 60 min | `packages/config/src/env.ts:57-61`; `proactive-scheduler.use-case.ts` | Env-only |
| P4 | Survey probe pacing | ≥ 3 user turns, no probe in the last 2 outbound | `conversation-orchestrator.ts:320` | — |
| P5 | Session boundary | `SESSION_GAP_HOURS = 5` | `utils/session.ts:1` | — |
| P6 | Reply plan rules | max 1 question, memory anchors top 3, grounding priority, forbidden moves | `utils/reply-plan.ts` | — |
| P7 | Pulse backlog ordering | group order, ignored after 48 h, engagement unlock 14 d | `services/pulse-backlog.service.ts`; `ports/pulse-backlog.repository.port.ts:33` | Inclusive vs exclusive window inconsistency |
| P8 | Retention | messages 365 d, memory 730 d, audit 2555 d, risk 90 d | `packages/domain/src/tenant/tenant.ts:44-47` | — |
| P9 | Context windows | classifier 15 turns, memory 20, survey 20, follow-up 8, check-in 10; turn truncation 2000 chars | `packages/contracts/src/ai.ts:53`; `prompts/*.ts`; `prompts/sanitize.ts:1` | Scattered |
| P10 | Feature rollout bucket | md5(userId) first 8 hex mod 100 | `apps/worker/src/feature-flags/feature-flag.repository.ts:43` | Fine; centralize |

## 6. Analytics and disclosure (class A)

| ID | Rule | Location | Known defects | Target | Wave |
|---|---|---|---|---|---|
| A1 | Cohort minimum 5 | `MIN_COHORT_SIZE` duplicated in `apps/api/src/admin/analytics.controller.ts:7`, `manager-dashboard.read-model.ts:32`, `survey-coverage.controller.ts:7` | Triplicated | One registry entry (not tenant-configurable per ADR-008) | 5 |
| A2 | Team score | `group-report.use-case.ts:48-65`: k checked on reportable states, mean over non-null scores, `0` if none | Mean can come from fewer than 5 people; 0 is ambiguous | k on actual scores; `null` when empty | 5 (`fix-now`) |
| A3 | Risk distribution | `riskByLevel` from `count(*)` of signals | `analytics.controller.ts:98-114,166` | Counts signals, not people | Distinct people per bucket | 5 |
| A4 | Question sentiment `net` | `(positive − negative) / total` over evidence rows | `manager-trends.aggregate.ts:136-139` | Talkative employees dominate | Per-person aggregation | 5 |
| A5 | Snapshot differencing | Next intermediate snapshot needs ≥ 5 changed inputs | `apps/worker/src/survey/group-report.processor.ts:14` | Partial protection only | Explicit differencing rule plus coarsening; no DP (D9, R3) | 5 |
| A6 | Index scoring | Equal-weight mean, `0.7·polarity + 0.3·sentiment` (v1) | `utils/group-scoring.ts:1-2`; `build-v2-index-report.ts` | Weights not documented as a methodology | Versioned methodology in the registry | 5 |

## 7. Structural rails (class R) — keep, align with schema

| ID | Rail | Location | Note |
|---|---|---|---|
| R1 | Reply length caps 140–980 chars | `openai-provider.ts:147` (`maxReplyChars`) | Disagrees with prompt word budgets in `prompts/respond.ts`; unify in one budget |
| R2 | Question count | `countQuestionGroups` (`openai-provider.ts:160`), `askedQuestion` (`conversation-orchestrator.ts:1782`), grader `extractQuestions` (ASCII `?` only, `packages/conversation-sim/src/harness/assertions.ts:153`) | Three implementations; the grader disagrees with runtime. Replace with the schema field `question` (D8). |
| R3 | Numeric probe format | `openai-provider.ts:176` | Becomes a schema property |
| R4 | Question bundle and clarification text | `utils/question-bundle-composition.ts:3` (`QUESTIONNAIRE_LABELS`), `utils/question-clarification.ts` | Multilingual; `keep` |
| R5 | Truncation guard | `finish_reason=length` throws | `keep` |
| R6 | Infra-failure classifier in the sim gate | `packages/conversation-sim/src/gate/failure-classifier.ts:14` | Transcript text such as "rate limit" can mask a product failure; match only harness errors |

## 8. Infrastructure timing (class I)

| ID | Rule | Location | Target |
|---|---|---|---|
| I1 | Rapid-message coalescing | `CONVERSATION_DELAY_MS=2000` (`apps/api/src/channel/slack-ingest.service.ts:11`) plus `RAPID_MESSAGE_COALESCING_WINDOW_MS=2000` (`apps/worker/src/conversation/conversation.processor.ts:34`) plus timestamp ordering in `conversation.repository.ts` | BullMQ deduplication debounce (D10) |
| I2 | Proactive counts over the last 100 messages | `apps/worker/src/followup/repositories/follow-up-context.repository.ts:55` | Count with a time-bounded query |
| I3 | Retries and backoff, recovery scans | `queue.module.ts`, `question-cutoff.processor.ts`, `conversation.repository.ts` | `keep`; centralize constants |
| I4 | LLM run cost attribution | `conversation.processor.ts:179` hardcodes `model: 'gpt-4o'` | Record the actual model (ADR-009) |

## Out of scope (archived, not migrated)

- `packages/application/src/use-cases/maf-primary-agent-runtime.ts`: duplicate risk TTL, English reminder regex with UTC times, slug key.
- `apps/api/src/internal-maf-context/`: secret-word redaction and test-marker regexes.

## Waves

| Wave | Content | Prerequisite |
|---|---|---|
| 0 | Eval datasets (EN/RU/UK) for safety, language, intents, rating, reminder, private names; policy registry skeleton; p95 latency baseline (R4) | — |
| 1 | Safety: G1–G5, G7–G9; Unicode-safe key M4 (S9 removed: English-only) | Wave 0 safety and language sets |
| 2 | TU contract v1: S1–S7, S14 behind shadow | Wave 0 intent set |
| 3 | TU fields S8, S10, S11, S15, S16, M6; structured reply R1–R3; P-registry migration; G6 | Wave 2 |
| 4 | Embeddings plus reconciliation M1–M3, M5, K1–K6; private identifiers S12–S13 | ADR-003 implementation; R2 name-recall target from Wave 0 |
| 5 | Disclosure control A1–A6 | R3 (no DP) |

Items marked `fix-now` (G2, G8, K6, M4, A2) are live defects. They may be patched ahead of their wave under ADR-013's "stopgap" alternative, as long as the patch does not add new lexical rules.
