---
title: 'RPT-06: Four-variant report assembly and Slack presentation'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-06-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Native safe datasets do not yet become the four approved audience/phase reports with supported narrative and accessible Slack presentation.

**Approach:** Assemble one coherent allowed input set into validated role-specific meaning, then a complete deterministic multipart Slack package. Follow the required design.

## Boundaries & Constraints

**Always:** Preserve RPT-01–05 mathematics, proofs, rights and pilot defaults. Explicit audience; one shared frontier; company language, English default. Intermediate explanation uses only its Index and complete 3/3 contributors; final permits allowed partial/unscored topics. Use current safe evidence, retain differing experiences, and allow zero-to-three supported actions. No supported problem means no invented focus/remedy.

**Ask First:** External model/Slack calls, production, language-policy/storage changes, public access, snapshot/delivery activation or historical proof imports.

**Never:** Private/working text, individual identities/scores or source IDs in model/recipient input; score-derived causes; generic filler; numeric TL intermediate Index; diagnostic numeric final Indices; clipped teams/actions. No scheduler/send/snapshot/history-completion producer, MAF or RPT-LANG implementation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Four variants | Eligible TL/Manager intermediate/final | Approved metric visibility, dynamics, explanation and actions | Explicit scope/kind mismatch blocks |
| Manager coverage | Overall eligible; every team insufficient | Overall plus every frozen team label/notice | Failed team reads are not insufficiency |
| Focus | Opposed causes; healthy/generalized-only evidence | Supported synthesis; concrete focus or none-supported; 0/1/3 actions | Unsupported draft gets one repair, then blocked |
| Baseline | Prior final differs from preliminary; raw rounded equality | Same-metric final comparison, raw direction and caveat | Incompatible latest gives Baseline established |
| Language | German company, Ukrainian chat, mixed safe sources | Entire report/notice German; stable machine keys | Never silently fall back to English |
| Long/malicious | Many teams, long labels, mentions/markup, Unicode | Complete ordered native parts and equivalent fallback | Capacity/validation failure, never clipping |
| Race | Withdrawal/expiry during model work | Recheck candidates and discard invalid output | No new cutoff or false insufficient notice |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/prepare-pulse-report-inputs.use-case.ts` — safe preparation; intermediate baseline seam.
- `apps/worker/src/survey/repositories/pulse-report-input.repository.ts` — permanent inputs; transactional coherent batch seam.
- `packages/ai-openai/src/openai-provider.ts`, `packages/channel-slack/src/slack.adapter.ts` — legacy patterns to preserve; use dedicated native adapters.

## Tasks & Acceptance

Implement the full [required design](../planning-artifacts/pulse-check-reports/RPT-06-DESIGN.md) ownership map and matrix.

**Execution:**
- [x] `packages/contracts/src/pulse-report-presentation.ts`, exports/tests — strict audience, evidence, narrative, locale, artifact and failure contracts.
- [x] Application `ports/pulse-report-{presentation.repository,narrative}.port.ts`, input port — read/batch/revalidation and bounded AI boundaries.
- [x] Database `pulse-report-input-state.ts`, worker input/presentation repositories — shared DB-authored frontier, frozen hierarchy/locale and current candidate validation; preserve existing locks and single-scope APIs.
- [x] Application `prepare-pulse-report-inputs.use-case.ts`, tests — completed-final baselines for both phases; retain compatibility rules.
- [x] Application `build-pulse-report.use-case.ts`, `pulse-report-narrative-policy.ts`, tests — gates, safe projection, role-specific artifact, zero-to-three supported actions and post-generation checks.
- [x] AI `pulse-report-narrative.adapter.ts`, `prompts/pulse-report-narrative.ts`, tests — dedicated generation/review/label operations with explicit SDK/fallback/repair bounds.
- [x] Slack `pulse-report-renderer.ts`, tests/exports — literal native leaves, full fallback, current limits and deterministic complete part manifest; no transport call.
- [x] `packages/database/src/__tests__/pulse-report-presentation.integration.test.ts`, mapped offline narrative/render fixtures — actual batch/privacy/rights races and all variant/edge cases; preserve prior stories and applied migrations.

**Acceptance Criteria:**
- Given a Manager hierarchy, when assembly prepares sections, then every included scope shares the same cycle/frontier/generation and numeric/qualitative gates remain independent.
- Given safe evidence, when generation/review fails or a technical stage is pending, then no unsupported or falsely insufficient publishable package is returned.
- Given any variant, when rendering all public surfaces, then metrics, preliminary qualifications, company language and accessible meaning obey its audience contract without identity/count leakage.
- Given oversized or malicious content, when packaging, then every required team/action survives ordered validated parts or assembly fails explicitly; no provider send occurs.

## Spec Change Log

## Design Notes

The design fixes existing intermediate baseline, frozen-metadata and cross-scope frontier seams. Backend provenance stays separate from model and recipient DTOs. Semantic reference checks do not prove factual/role/language correctness; the dedicated reviewer and separately authorized evaluation remain distinct evidence layers. RPT-07 owns immutable persistence, per-part authorization/receipts and ambiguous partial delivery.

## Verification

Sequential affected contracts/application/AI/Slack/worker tests, migrated DB fixtures, typecheck/lint/builds, two independent BMad implementation reviews and `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. Preflight task-owned DB/Redis before connector fixtures. No external model/Slack call or retired MAF execution.

Synthetic fixtures cover all four variants, 0/1/3 actions, safe coarse/healthy cases, cross-Index/opposed causes, intermediate completeness, previous-final dynamics, all-teams-insufficient, German/long/malicious/Unicode output, provider bounds and rights races. Actual semantic/multilingual model and native Slack acceptance are separately approved later checks. Local deterministic acceptance is complete: all thirty required cases passed, both independent v4 correction reviews are clear, and the official pinned-baseline harness passed. Source inventory contains thirty-four exact hashes. Five reviewed implementation defects and two legacy fixture defects were corrected without changing frozen intent, legacy runtime, or applied migrations. Four legacy guarded worker cases outside RPT-06 remain skipped; their unchanged guards are recorded separately. Actual model/multilingual quality, native Slack acceptance and optional browser visual inspection remain unverified.

Final evidence: [Official harness](../../runs/harness/receipt-1793182108438-a2963c20.json), [Thirty-case evidence](../../runs/rpt-06/acceptance-evidence.json), [Independent blind recheck](../../runs/rpt-06/review/blind-correction-recheck.md), [Independent edge recheck](../../runs/rpt-06/review/edge-correction-recheck.md), [Preservation audit](../../runs/rpt-06/final-preservation-audit.json).

## Suggested Review Order

**Read-only assembly**

- Start at the callable assembly seam and post-render authorization check.
  [pulse-report-slack-assembly.service.ts:13](../../apps/worker/src/survey/pulse-report-slack-assembly.service.ts#L13)

- Follow audience gates, child-first narrative acceptance, and frozen artifact construction.
  [build-pulse-report.use-case.ts:35](../../packages/application/src/use-cases/build-pulse-report.use-case.ts#L35)

**Coherence and rights**

- Prepare every frozen scope within one database-authored evaluation frame.
  [pulse-report-input.repository.ts:46](../../apps/worker/src/survey/repositories/pulse-report-input.repository.ts#L46)

- Revalidate current and historical inventories under globally ordered subject locks.
  [pulse-report-presentation.repository.ts:127](../../apps/worker/src/survey/repositories/pulse-report-presentation.repository.ts#L127)

- Bind authorization to the complete closed source inventory.
  [pulse-report-input-state.ts:181](../../packages/database/src/pulse-report-input-state.ts#L181)

**Narrative safety**

- Project complete intermediate contributors and permitted final evidence without source identities.
  [pulse-report-narrative-policy.ts:25](../../packages/application/src/use-cases/pulse-report-narrative-policy.ts#L25)

- Enforce bounded dedicated generation and semantic-review requests without SDK retries.
  [pulse-report-narrative.adapter.ts:109](../../packages/ai-openai/src/pulse-report-narrative.adapter.ts#L109)

**Presentation integrity**

- Validate audience, metric visibility, unique identities, and action ownership.
  [pulse-report-presentation.ts:357](../../packages/contracts/src/pulse-report-presentation.ts#L357)

- Serialize literal text with complete fallback, bounded packing, and immutable manifest.
  [pulse-report-renderer.ts:103](../../packages/channel-slack/src/pulse-report-renderer.ts#L103)

**Regression evidence**

- Exercise real native sources through all four assembled Slack variants.
  [pulse-report-presentation.integration.test.ts:384](../../packages/database/src/__tests__/pulse-report-presentation.integration.test.ts#L384)

- Inspect malicious text, Unicode, multipart coverage, and artifact identity fixtures.
  [pulse-report-renderer.test.ts:86](../../packages/channel-slack/src/pulse-report-renderer.test.ts#L86)

- Keep legacy rollback evidence aligned with mandatory risk assessment.
  [conversation-group-report-transaction.integration.test.ts:104](../../apps/worker/src/conversation/conversation-group-report-transaction.integration.test.ts#L104)

- Match synthetic cutoff tables to the existing delivery-proof schema.
  [survey.repository.cutoff.integration.test.ts:55](../../apps/worker/src/survey/repositories/survey.repository.cutoff.integration.test.ts#L55)

- Keep offline evaluation explicitly separate from actual model acceptance.
  [pulse-report-narrative.eval.test.ts:1](../../packages/conversation-sim/src/harness/pulse-report-narrative.eval.test.ts#L1)
