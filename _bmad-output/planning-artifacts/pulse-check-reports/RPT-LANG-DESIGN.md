# RPT-LANG — Company language and independent personal conversation

Date: 2026-10-29. Status: completed locally after approval, independent review and the official harness. See the [execution specification](../../implementation-artifacts/spec-rpt-lang-company-and-personal-language.md).

## 1. Scope and authority

Implement PR-021, FR-028/029 and cross-product AC-28 from this package. RPT-06 already renders reports in the captured company locale; RPT-07 already freezes their content and delivery identity. This dependency makes the associated analytical records, active administrative UI and personal conversation obey explicit, separate language contracts. It is one cross-layer language boundary, not a reporting arithmetic rewrite or a new dashboard design.

Continue in `/private/tmp/entalent-pulse-check-reports`, branch `codex/pulse-check-reports`, base `237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. Preserve all 299 implementation-start changed/untracked files except the explicitly declared RPT-LANG delta. Original checkout remains untouched. Prior local RPT-07 evidence remains valid for its frozen source; later RPT-LANG changes require their own consumer regressions and harness receipt.

This design records the approved local implementation and deterministic acceptance. It grants no model egress, real Slack message, production/configuration mutation, commit, push, PR, activation or historical bulk rewrite. RPT-08 and live semantic/multilingual acceptance remain separate.

## 2. Verified current source

The worktree has no `.codegraph/`; its current source, including prior local changes, was inspected directly. Three independent read-only audits covered analytical storage, personal chat and administrative UI. Indexed original-checkout navigation cannot establish current worktree behavior.

| Concern | Verified worktree source | Current behavior |
| --- | --- | --- |
| Locale authority | `packages/contracts/src/pulse-report-calendar.ts:50`, `packages/database/src/pulse-report-configuration.ts:64` | Canonical ICU-supported BCP47 locale; only genuinely absent locale defaults to English |
| Configuration write | `apps/api/src/report-configuration/report-configuration.service.ts:124` | Authorized, revision-checked tenant transaction; changes authoritative tenant locale |
| Analytical output | `packages/application/src/use-cases/finalize-question-insight.use-case.ts:139`, `:162`, `:248` | Scores exact confirmed meaning, then two deidentification attempts and English generalized fallback |
| Prose provenance | `packages/ai-openai/src/openai-provider.ts:459`, `packages/database/src/schema/survey-insight-v2.ts:196` | Existing model/prompt columns describe scoring; no analytical locale/prose provenance |
| Analytical persistence | `apps/worker/src/survey/repositories/question-insight.repository.ts:1918` | Admission and revision CAS under subject lock; final insert and private derivative purge are atomic |
| Personal selection | `packages/application/src/utils/language-policy.ts:4` | Deliberate constant-English policy, despite existing profile locale/preferences |
| Conversation forms | `packages/ai-openai/src/prompts/respond.ts:90`, `packages/contracts/src/pulse-engagement.ts:23` | Numeric probes use exact English forms; arbitrary generation cannot replace them |
| Setup UI | `apps/api/src/hierarchy/company-setup-ui.controller.ts:4`, `:83`, `:479` | English public bootstrap, static HTML and dynamic copy; tenant data requires authenticated snapshot |
| Actual dashboard data | `apps/dashboard/src/app/lib.ts:59`, `apps/api/src/admin/v2-pilot.read-model.ts:78` | Current Pulse pages use V2 pilot people/signals, not legacy user-insights |
| Legacy admin boundary | `apps/api/src/admin/user-insights.controller.ts:19` | Existing guarded endpoint ignores tenant argument during initial user/window selection; fix isolation before adding locale/projections |
| Dashboard text | `apps/dashboard/src/app/layout.tsx:9`, `components/Nav.tsx:3`, `v2-pilot-progress.ts:50` | Russian root/shell/status/date copy shared by five active page routes |

Relevant open harness failures were retrieved separately for analytical, AI, personal-language, setup and dashboard paths. Copies and the starting manifest are under `runs/rpt-lang/`. The initial config-resolver invocation omitted `--project-root`; the corrected invocation succeeded. Use the exact commands in section 11 and record this recurrence in the existing tooling failure.

## 3. Common locale and copy contracts

Keep `tenants.locale` and RPT-04 configuration revisions as the sole company authority. Do not create a second writable company-language setting. Validate with the existing BCP47/ICU policy; invalid explicit input is an error, not English. Do not silently reduce accepted configuration to an en/de/uk allowlist. Browser locale and employee preferences never select report/admin language.

Introduce typed versioned language resources in `packages/contracts/src/pulse-language.ts` and application ports for their preparation/read/installation. Resource kinds distinguish ordinary UI labels, personal operational copy, legal/privacy disclosures, canonical safe-signal fallback text, definition labels and exact numeric forms. A resource records canonical locale, source-contract/copy version, exact key inventory, text/hash, generation/review provenance and accepted state. No user content belongs in global generic catalogs. Tenant custom definitions stay tenant-scoped, with their own source hashes.

English reviewed source resources are built in. Other locales use complete accepted resources; preparation is a callable operation outside HTTP reads, subject/config locks and ordinary conversation processing. A dedicated provider adapter may generate and independently review a bounded candidate (maximum two candidates, each one generation plus one review; SDK retries disabled). Installing requires complete strict keys, stable interpolation slots, plain escaped text, bounded lengths and explicit semantic pass. Model-generated resources are proposals validated by TypeScript, not model-owned writes. Preparation tests use fakes; no live preparation is performed by this task. Do not automatically treat ICU formatting support as translation-quality evidence.

Missing or invalid resources produce typed `language_unavailable` with the exact requested locale and missing resource version. They must not persist English under another locale or silently remove a requested language. Keep locale configuration valid; readiness can remain blocked until resources exist. Never invoke a model during dashboard GET, startup, filtered/failure recovery or a configuration lock. A personal switch without required safe operational resources remains pending/unavailable, preserving the last accepted language and a truthful notice in that language; it cannot silently install an unreviewed form. Critical safety policy still takes precedence, using the last accepted safe operational resource, with explicit selected/requested locale metadata.

Localize labels, human explanations, plural/date formatting and accessibility copy. Machine enum values, keys, IDs, stableKey/question/rubric identities, CSV headers and API error codes stay stable. Proper names and exact employee-confirmed private statements are not generic UI labels.

## 4. Canonical analytical generation

Extend finalization context with a durable, revision-bound company language capture and separate prose provenance. Capture authoritative locale/configuration revision once for the exact pending analytical revision, outside model execution; retries retain that capture. A later company-language change affects new captures, not a pending revision's score or already stored canonical text. Current-language admin display uses the projection below. Do not hold a database lock during generation.

Score the exact employee-confirmed meaning using the existing rubric, policy and receipt. Locale does not change score input, outcome, numeric value, direction, severity or root-cause keys. Generate the deidentified summary directly in the captured company language through the existing bounded deidentification operation. Return/persist prose model/prompt/language-policy/resource provenance separately from existing scoring provenance. Revalidate source admission, permission, retention and working revision before commit; unchanged atomic final-insert/private-derivative-purge semantics remain mandatory.

Both deidentification attempts still pass privacy checks. A generalized fallback comes only from an accepted locale resource, retains `summarySupport=generalized_signal` and cannot acquire an invented employee cause. Missing language resources leave typed retryable technical work; they do not finalize an English summary, produce insufficient participation or purge an unfinalized working record. Persist/reuse scoring results for the exact admitted working revision where language-only retry would otherwise rescore; they remain restricted temporary state with the same privacy/lifetime boundary, not reportable analytical inputs.

Existing capitalized-word identifier guesses overflag German nouns, while date/role/project patterns underdetect German identifiers. Replace no privacy protection with a mere locale hint. Add language-aware source-identifier handling plus strict independent deidentification review where heuristics cannot establish safe faithful output. Share the bounded attempt budget; no uncounted repair calls. Genuine source identities, newly introduced names, German project/customer labels, dates and transliterations remain rejected. When privacy or language cannot be established, keep the current safe generalized-support path or technical block, never employee-supported prose by default.

Forward schema additions start after migration 0094. Existing historical metadata is nullable/`legacy_unverified`; do not label old mixed-language records as English or claim known generation provenance. Preserve all prior migration bytes, journal prefix and original analytical IDs/text/numbers. No bulk translation or schema reset.

## 5. Historical/current-language display projection

Administrative UI language cannot honestly be met by translating headings over old English/Ukrainian prose. Add an independently stored, tenant-scoped safe-display rendition for finalized deidentified text whose captured language differs from current company language or is unknown. It is a derivative, not a replacement analytical record or report source.

Key by tenant, exact immutable analytical ID plus source content/provenance hash, destination locale, language-policy/prompt version. Generate only from permitted permanent deidentified summary and its support tier; never load source messages or private working summaries. Validate source permission/expiry, translation meaning and privacy before installation and again before serving. Unknown historical language remains unknown in source metadata; destination-language acceptance must be independently established. Preserve generalized versus employee-supported support, negation, severity/uncertainty and minority meaning. Never score or alter a report candidate because its UI rendition changed.

Rendering uses accepted same-language canonical text or a matching ready rendition. Missing rendition shows localized `translation_pending`/`language_unavailable` rather than falsely marking original prose as localized. Authorized inspection can separately show the original safe record with its truthful language status. This is an operational pending state, not completion of cross-product acceptance for that record. Never generate synchronously from GET. A callable bounded preparation service owns safe projections, with synthetic tests and separately authorized live population later.

Renditions are restricted copies: expiration never exceeds the source's effective retention; direct or adapter source deletion, full/partial withdrawal and tenant/subject erasure close over all copies before provenance disappears. Follow established subject-lock ordering, invalidate stale source hashes, and cover hard delete/cascade as well as normal retention. Keep content-free allowed terminal metadata only. API/model logs and structured receipts contain no text. Report-input readers do not query this table or derive new source authority from it. Working drafts and exact shown statements remain verbatim with source-language provenance, not translated in place.

## 6. Personal language and durable ordering

Replace the current constant-English rule explicitly. Reuse the existing `SituationClassificationSchema` call with optional nullable `{locale, kind: explicit|inferred}` proposal; no extra detector call and no keyword-driven conversation routing. TypeScript validates the proposed tag and selects:

1. Explicit request in this inbound.
2. Previously saved explicit preference.
3. Unambiguous substantive language proposed for this inbound.
4. Previously saved inferred preference.
5. Validated `users.locale`.
6. Product English default.

An explicit preference survives inference until another explicit switch. Numbers, agreement, backchannels, quotes/code, uncertain/mixed text carry no inference. Classifier schema/prompt/regressions must encode this; deterministic tests are not proof that a live classifier handles all languages correctly.

Store content-free selection/source/version in existing `communication_preferences`, preserving unrelated keys and never overwriting `users.locale` or tenant locale. CAS is tenant/user scoped and ordered by actual trusted `messages.received_at` plus inbound UUID (`receipt_trust=db-receipt-v1` in current schema). Replayed/older proposals cannot replace newer selection. A durable proposal for a pending unsupported resource must not falsely become accepted response locale. Legacy/unverified clocks cannot advance durable preference; they may use a validated current-turn hint without changing history. Never accept model timestamps, restamp messages or alter numeric evidence clocks. Committed outbound replay uses its original bytes regardless of current preference.

Pass the same selected language through ordinary replies, native confirmation/clarification, follow-ups, proactive openings, onboarding copy, disclosures and operational/filter/processing-failure text. Failure paths use already accepted local resources/preferences without a model call. Translate conversational instructions around an already shown statement without rewriting the statement employee is confirming. Preserve successful-confirmation zero-question acknowledgement and risk/receipt/admission sequencing. Legacy group-confirmation adapters must accept the resolved language when still reachable; do not revive archived runtime paths or pilot report generation.

## 7. Exact Engagement forms and disclosures

The current `ENGAGEMENT_QUESTIONS.title` is an exact English form. Introduce immutable accepted locale forms bound to existing stableKey, answer-contract/question semantics, locale, form version and text hash. A reviewed translation retains the exact 1–10 integer scale and endpoint meanings. Do not freely translate probes with the reply model or replace their text after delivery.

Probe provenance and capture verify the registry/version/actual delivered hash. Extend strict metadata compatibly; legacy English receipts stay valid under their original proof. A reply after a personal-language switch still binds the actual previously delivered form. Missing resources mean no numeric probe, never a zero answer, guessed rating, changed unlock/cutoff or English probe mislabeled in another language. Keep literal numeric value/source inbound ID, receipt clocks, acknowledgement and direct-explicit-answer semantics intact. Locale forms need semantic/privacy acceptance before activation, even when fake fixtures pass.

Disclosures have the same exact-version/hash obligation. Preserve the actual shown rights meaning and its receipt. A resource change does not fabricate a prior disclosure or grant new reporting access. No translation of employee-confirmed meaning before scoring is introduced.

## 8. Administrative UI and security

Company setup includes its entire existing static and dynamic authorized shell: forms, confirmation/error text, readiness/rollout tables and accessible labels. Before authentication no tenant language authority exists; an English bootstrap is allowed. After the verified tenant snapshot, switch copy and document `lang` to company locale using accepted resources. Preserve CSP, escaping, CSRF, cookie/session checks, DOM identifiers, payload keys and actions. UI verification must not execute rollout/onboarding actions.

Dashboard scope includes all five active page routes: root, `pulse`, `pulse/[userId]`, `cycles`, `cycles/[cohortId]`; shared `Nav.tsx`, `ui.tsx`, `v2-pilot-progress.ts`, root layout and locale/date/plural helpers. Local technical `DevControls` are explicitly excluded, remain gated, and are never triggered in verification. This changes copy and metadata only, not product layout or report access rules.

Add pure tenant-scoped locale/resource metadata to existing protected reads. Do not use `ReportConfigurationService.current()` for ambient UI localization: it can write a configuration revision. Current Pulse pages consume `admin/v2-pilot.read-model.ts` and `admin-v2-pilot*.ts` contracts; extend actual consumers, not only the legacy endpoint. Keep ADMIN_API_KEY server-side, internal-dashboard and QA/private gates, approved pilot tenant/population restrictions and aggregate/identifiable separation. Each request has its own locale context; no global mutable server locale.

Before extending `admin/user-insights.controller.ts`, validate tenant and bind its initial user/window lookup and downstream records to that tenant; a caller's locale query cannot authorize another tenant's data. Definition labels may use accepted stable-key/source-version resources; custom/unknown definitions require exact scoped resource or explicit unavailable state, never a fabricated translated canonicalMeaning. Stored definitions/rubrics remain unchanged.

## 9. Implementation ownership and dependency order

New file ownership (existing paths are mapped in sections 2–8):

| Layer | Exact new files and responsibility |
| --- | --- |
| Contracts | `packages/contracts/src/pulse-language.ts`, `pulse-language.test.ts`: locale/resource/prose/form/rendition schemas; existing `ai.ts` gains proposal field |
| Application ports | `packages/application/src/ports/pulse-language.port.ts`: preparation and accepted-resource read/install; `analytical-rendition.port.ts`: authorized derivative persistence/read |
| Application use cases | `packages/application/src/use-cases/prepare-pulse-language.use-case.ts`, `prepare-analytical-rendition.use-case.ts` and colocated tests: bounded proposal/review/install orchestration |
| Storage | `packages/database/src/schema/pulse-language.ts`: generic resources, tenant-scoped renditions/forms and dependency guards; add exact revision/locale/scoring staging fields to `survey-insight-v2.ts`; generated forward SQL/meta after0094 |
| Worker adapters | `apps/worker/src/survey/repositories/pulse-language.repository.ts`, `analytical-rendition.repository.ts`: transactional reads/install, source revalidation and erasure/expiry integration; wire in existing `survey.module.ts` |
| AI adapter | `packages/ai-openai/src/pulse-language.adapter.ts`, `prompts/pulse-language.ts` and colocated adapter tests: strict generation/review requests, retry0 and bounded output |
| Pure admin metadata | `apps/api/src/admin/company-language-read.service.ts` and colocated tests: authenticated tenant-bound pure locale/resource reads; extend existing admin module/controllers without new ambient public tenant lookup |
| Dashboard | `apps/dashboard/src/app/company-language.ts`, `company-language.test.tsx`: request-local accepted resources, typed errors, safe interpolation and deterministic render fixtures; existing lib/layout/pages/components consume it |
| Database fixtures | `packages/database/src/__tests__/pulse-language.integration.test.ts`: metadata/capture/preference order, immutable forms, pure read and copy lifetime/erasure proofs |
| Diagnostics | `docs/pulse-report-language-operations.md`: resource/projection preparation/readiness and honest local/live boundary; no automatic job, backfill or activation command |

1. Add shared locale/resource/classifier and read-model contracts; application language/resource ports; forward schema/metadata with nullable legacy fields and immutable form/projection dependencies. Keep exports synchronized. Resolve all new names in the execution spec against this design before editing.
2. Implement resource preparation/read/installation and safe-rendering adapters. Only fakes run locally. Reuse existing provider configuration/retry conventions; add no dependency unless necessary. Direct HTTP reads only fetch accepted state.
3. Extend finalization language capture, prose/scoring provenance and safe-summary/projection lifecycle; current analytical source/receipt/CAS/purge semantics remain unchanged.
4. Implement personal selection/classifier proposal, preference CAS, per-turn propagation, exact numeric/disclosure forms and operational/onboarding copy across active TS paths.
5. Wire authenticated setup/admin metadata, fix touched legacy tenant binding and localize five dashboard routes/shared shell.
6. Add source/locale/provider/queue-independent regressions, migrated lifetime/order tests and deterministic UI fixtures; run independent BMad review and the official final harness on final source.

## 10. Acceptance and evidence

| Scenario | Required evidence |
| --- | --- |
| German company, Ukrainian employee | German canonical safe record, full admin UI and report; Ukrainian dialogue, disclosures and reviewed exact numeric form; unchanged score/keys and source message bytes |
| Company locale switch during/reafter finalization | Durable first language capture is stable; current display uses separately versioned projection; no score rerun for language-only work or historical overwrite |
| Personal explicit/inferred switch | Exact precedence, short/numeric/quoted/mixed input stability; stale/replayed proposal CAS; no report/admin locale mutation |
| Resource missing or malformed | Typed unavailable/pending; no silent English fallback, unreviewed form or fabricated localization provenance |
| History | Null legacy provenance preserved; localized rendition never becomes report/source authority or extends retention |
| Privacy/lifetime | German noun false positives and genuine labels/dates/transliteration, unknown identities; source/recipient/tenant isolation; withdrawal/expiry/direct deletion erase all derivative text |
| Numeric/disclosure receipts | Original/form-version hash validated; old delivered English form accepted after switch; exact source clocks and 1–10 integer capture unchanged |
| Admin | All five routes/setup shell/aria/lang/date/plural copy; stable payload keys; pure reads; cross-tenant user UUID rejected; client contains no admin key |
| Deterministic boundary | Provider mocks/fixtures prove plumbing and rejection paths only; multilingual fidelity, privacy and semantic quality need separately authorized evaluations |

Meaningful suites: `contracts/ai.test.ts`, locale/resource contracts, `language-policy.test.ts`, orchestrator/proactive/follow-up and finalization tests; provider/classification/respond/deidentification tests; receipt/form and preference/projection DB integration; worker native recovery plus RPT-03/05/06/07 affected consumers; API configuration/setup/V2 read/legacy cross-tenant tests; dashboard en/de/uk fixtures and all-page render checks. Preserve no-source-message-query assertions for report/projection readers and active-TS-disconnected-from-MAF regression.

## 11. Tooling and verification sequence

Resolve config without changing output authority:

```sh
python3 _bmad/scripts/resolve_config.py --project-root /private/tmp/entalent-pulse-check-reports
python3 _bmad/scripts/resolve_customization.py --skill /Users/serzh/Documents/enTalentNew/.agents/skills/bmad-quick-dev --key workflow
```

Before implementation, refresh per-area reflection and preserve the starting manifest and all 0094-and-earlier migration/journal hashes. Existing dependencies are installed; do not run a new install merely for planning/token counting. Rebuild modified workspace packages before consumer tests. Run focused RED/GREEN suites, package tests and affected API/worker tests; dashboard typecheck/build; global typecheck/lint. For new schema run generation/review, then migrate only a newly named isolated local database after identifying it; no reset of existing data. Use named task Redis if tests require it. Run `pnpm harness:preflight` before any connector payload; no external payload is authorized here.

Finish implementation with `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`, full captured diagnostics and structured receipt; configure the deterministic TS-only test chain without retired MAF scripts. No live `sim`/model evaluation until separately authorized. Record task/failure closure and exact skipped acceptance boundaries. Local completion requires all tasks/ACs, independent review, preservation and deterministic harness; it is not production/localization-model acceptance or permission to activate reports.


## 12. Local acceptance — 2026-10-29

The linked execution specification is done locally after both independent final rechecks, all R1–R9 corrections and official fresh-chain receipt `runs/harness/receipt-1793288712151-c9399e5e.json`. Actual0000–0098 ledger hashes/clocks match all99 migration files; full database243 cases pass without skips. Pending explicit language, exact composed/delivered forms, actual substantive onboarding transitions, native dependency-loss/expiry, positive immutable legacy opening, executable setup recovery and all five dashboard routes have deterministic coverage. Final source and editorial preservation are recorded separately under `runs/rpt-lang/`.

Remaining:0% for this local design/implementation boundary. RPT-08 and real multilingual semantic/model/Slack/production acceptance remain separate; no historical source rewrite or activation was performed.
