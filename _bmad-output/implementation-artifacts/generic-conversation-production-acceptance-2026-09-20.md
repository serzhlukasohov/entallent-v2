---
title: 'Generic Conversation production acceptance — 2026-09-20'
type: 'acceptance-report'
created: '2026-09-20'
status: 'in-progress'
source: '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
production_worker_commit: 'd4d088d'
candidate_commit: 'fa1cd08'
---

# Generic Conversation production acceptance — 2026-09-20

## Scope and evidence boundary

This report covers a fresh, user-scoped production Slack replay after a scoped reset. It does not replace earlier per-capability receipts in the bug catalog. `fa1cd08` is pushed to `codex/grill-session-docs` but is not deployed; production worker deployment `19075ec6-5449-4e9d-a485-3aaf3e338b6a` runs `d4d088d`.

- Slack DM: `D0BJDC2MPE2`
- Tenant: `7d1e0163-6d53-4713-bd24-254690cc5090`
- Product user: `5d2f17fd-a125-4239-8f43-31adbbd8ff42`
- Preflight: `runs/harness/receipt-1789902290157-320f127b.json`
- Scoped reset: one conversation and only this user's dependent conversation, memory, pulse, backlog, and LLM-run rows were removed.
- Receipt rule: a current PASS requires the Slack turn plus persisted database read-back. A local-only fix is not a production PASS.

## Result matrix

| Capability | Current verdict | Production evidence | Follow-up |
| --- | --- | --- | --- |
| CAP-1 source-bounded interpretation | **FAIL** | Neutral onboarding message [`1789901488.517929`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901488517929) received “the rest of the mess”, an unsupported negative frame. Correction [`1789901045.392779`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901045392779) persisted but produced no outbound; trace `d2566d86-53c5-4982-a1d0-9ae479be1cef` failed three Azure-filtered attempts. | Fix unsupported inference and the all-retries-filtered no-reply path; rerun both turns. |
| CAP-2 concise session style | **PARTIAL** | Fresh-session reply was “Good afternoon.” Correction/brief request [`1789901259.781529`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901259781529) was concise but still asked another question after “Please just acknowledge that briefly.” | Revalidate together with CAP-1 correction fidelity. |
| CAP-3 confirmation access | **PASS** | [`1789901546.482379`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901546482379) correctly stated that confirmation does not grant manager/HR access to individual messages, answers, personal state, or identity. | None. |
| CAP-4 unconfirmed reportability | **PASS** | [`1789901600.258969`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901600258969) correctly excluded unconfirmed material from scoring, aggregation, themes, recommendations, and reports. | None. |
| CAP-5 product data use | **PASS** | [`1789901643.642299`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901643642299) identified the bot as AI and covered replies, optional private memory/actions, pulse, safety, retention, and audited internal access. | None. |
| CAP-6 resolved-detail planning | **PASS** | [`1789901304.962589`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901304962589) followed by [`1789901437.218839`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901437218839) preserved “rebuild the flow, stopping point already clear”; the second reply did not re-ask the resolved distinction. | None. |
| CAP-7 disclosure relevance | **PASS** | Onboarding turn [`1789901488.517929`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901488517929) received no pulse-reporting disclosure. | CAP-1 wording failure in the same reply remains separate. |
| CAP-8 exact-message pulse capture | **FAIL on production** | Exact request [`1789901688.478929`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901688478929) correctly answered “No”; follow-up [`1789901741.401099`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901741401099) widened to conversation-wide evidence and listed unrelated interpretations. | Candidate fix exists in `fa1cd08`, has local tests/review, but needs approved PR-based deployment and a two-turn production replay. |
| CAP-9 rapid-message coalescing | **FRESH RUN BLOCKED** | Historical production receipt remains valid: `1789732390.253939` and `1789732391.307619` were 1.053680s apart and produced one tail reply. Current connector pairs landed 3.7755s, 4.15828s, and 12.12306s apart; each validly produced separate replies. One parallel sender was rejected by Slack. | A fresh verdict requires a connector path that can place two messages less than two seconds apart. Do not infer failure from the slower pairs. |
| CAP-10 language correction | **PASS** | [`1789901791.167529`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1789901791167529) received an entirely English acknowledgement and treated the Ukrainian text as a keyboard slip. | None. |
| CAP-11 dashboard conversation activity | **BACKEND PASS / UI NOT FRESHLY CAPTURED** | Immediately after reset and the first Slack turn, manager API returned non-null `lastActiveAt`, zero current evidence/signals, and `previousWindow=null`. | Capture the rendered empty-activity state only if a new scoped reset is approved after preserving this report. |

## Additional production failure: filtered turn produced no reply

The inbound correction `1789901045.392779` is durable, but no outbound row exists for its trace. Worker job `802` exhausted all three attempts because Azure OpenAI returned `400 The response was filtered due to the prompt triggering Azure OpenAI's content management policy`. The three `llm_runs` for trace `d2566d86-53c5-4982-a1d0-9ae479be1cef` are `status=error`.

This is a separate user-visible reliability defect: safe ordinary input must not disappear merely because the provider filters the assembled prompt. The fix must preserve safety precedence and avoid resending or duplicating a reply after retries.

## CAP-9 fresh-run receipts

| Pair | Delta | Persisted result | Verdict |
| --- | ---: | --- | --- |
| `1789901840.129209` / `1789901843.904709` | 3.775500s | Two inbound, two outbound, separate traces | Invalid timing sample |
| `1789902306.751719` / `1789902310.909999` | 4.158280s | Two inbound, two outbound, separate traces | Invalid timing sample |
| `1789902345.610449` / `1789902357.733509` | 12.123060s | Two inbound, two outbound, separate traces | Invalid timing sample |

## Closure decision

The original 11-item list is **not fully closed** under the current fresh production acceptance. CAP-1 fails, CAP-8 fails on the deployed worker, CAP-2 is partial, CAP-9 lacks a fresh sub-two-second sample, and CAP-11 lacks a fresh rendered UI capture. CAP-3–7, CAP-10, and the CAP-11 backend state pass.

## Release boundary

PR #5 remains open at `014460d` and is not merged. Its integration check passes, but the deterministic harness check fails before tests because the long-lived PR diff against `main` contains three retired MAF files: `agent-runtime-router.test.ts`, `maf-primary-agent-runtime.test.ts`, and `maf-primary-live-smoke.ts`. Production worker deployment `19075ec6-5449-4e9d-a485-3aaf3e338b6a` therefore still runs `d4d088d`; current Slack traffic cannot validate the local CAP-8 candidate or later fixes.

Do not bypass this by weakening the harness or silently deploying the branch. Production revalidation needs an explicitly approved release path that keeps retired MAF out of the active change set, or explicit authorization for a manual non-main deployment after reviewing the risk.

The three retired diffs are compatibility edits, not product logic: they add `findLatestDeliveredReportingDisclosure` and update delivery mocks to return `Date` after the active shared repository interface changed. Restoring them directly to `origin/main` would break typecheck. The narrow architecture-safe cleanup is interface segregation: keep the legacy/base conversation repository contract compatible, require delivery-aware disclosure capability only at the active orchestrator boundary, then restore the three archived files byte-for-byte. This needs explicit approval because it deliberately changes the retired-surface boundary even though the resulting archived files match `main`.

## 2026-09-24 CAP-8 closeout addendum

The historical September 20 matrix above remains unchanged. CAP-8 now **PASSES its focused production acceptance** on Railway worker `a189ed2` (deployment `4a75c333-c27d-406a-bab7-0ca0e90ce626`, `SUCCESS`). Preflight passed in `runs/harness/receipt-1790259761322-ebe1bc9f.json`.

- Descriptive request [`1790259773.634579`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1790259773634579), full quote [`1790259814.196619`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1790259814196619), and previous-exact follow-up [`1790259865.085699`](https://test-ai-agent-hq.slack.com/archives/D0BJDC2MPE2/p1790259865085699) each received one exact-message reply naming two temporary, not-reportable evidence rows.
- Production PostgreSQL stored `pulseCaptureSourceMessageId=e23f6711-8685-499d-bf70-300b3e19cbf8` on all three outbound messages. That source has exactly two active linked evidence rows; no conversation-wide evidence appeared in these replies.
- Redis marked conversation jobs `877`–`879` complete and message-send jobs `856`–`858` complete; the latter map one-to-one to the three delivered outbound IDs. There were zero failed message-send jobs in the acceptance window. The earlier pre-fix conversation job `876` remains a historical failed record.

The remaining Generic Conversation failures in the September 20 matrix are separate from CAP-8.
