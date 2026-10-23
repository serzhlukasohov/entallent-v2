# Pulse Check Reports — Functional Requirements

Normative words describe target behavior. Requirement IDs are stable within this package. Each rule has a directly testable outcome; consolidated fixtures are in [Acceptance Scenarios](ACCEPTANCE-SCENARIOS.md).

## Input, lifecycle, and cohorts

### RPT-FR-001 — Isolate report inputs

Report readers shall accept only finalized, privacy-accepted, confirmed de-identified analytical records and restricted scoped metadata. Reject mismatched tenant, cycle, question/version, or reporting affiliation and exclude withdrawn, expired, or deleted data. No reporting code may traverse source links to private conversations or temporary summaries. **Verify:** source-access and mismatched-scope fixtures return no private/reportable input. **Traces:** PR-002, PR-024.

### RPT-FR-002 — Confirmation readiness and exception

The upstream readiness contract shall require sufficient condition meaning and either a captured root cause or explicit refusal to provide it. Do not interpret silence as either. Exact shown-and-confirmed receipt remains required; clarification must show a revised statement for confirmation before finalization. **Verify:** status-only stays unready; explicit driver refusal may proceed; missing receipt never finalizes. **Traces:** PR-003.

### RPT-FR-003 — Use latest confirmed state once

Select one latest eligible confirmed state per person/topic as of report cutoff. Preserve allowed de-identified history for explaining change, not as extra votes. An unconfirmed supplement does not replace current confirmed state. **Verify:** repeated history and pending updates do not increase weights or change the current score. **Traces:** PR-004, PR-015.

### RPT-FR-004 — Freeze role-aware scope

Capture cycle participants and affiliations. Team Lead scope is its direct employee team. Manager overall scope is all subordinate teams' employees plus their Team Leads, each person deduplicated. For a Manager team section, exclude that team's own Team Lead. Membership keys, not display names, identify the scope. **Verify:** a Team Lead contributes once overall and zero times to their own team breakdown. **Traces:** PR-009, PR-010.

### RPT-FR-005 — Preserve departed/transfer contributions

On deactivation/departure/transfer, stop new collection for the original scope but retain already confirmed otherwise eligible current-cycle contributions and the original denominator membership. A timely confirmed but not yet finalized record may finish normal processing. Do not move old insights to the destination team. Next cycle uses current eligible affiliations. **Verify:** old confirmed inputs remain usable after inactivation; new-team reporting cannot retrieve them. **Traces:** PR-016.

### RPT-FR-006 — Apply full withdrawal

Before any future delivery, exclude all inputs covered by a full reporting withdrawal. Remove the person from the denominator of unpublished intermediate scopes and recompute thresholds. Do not edit a delivered intermediate or include withdrawn inputs in final. Preserve applicable audit/retention duties without exposing the person. **Verify:** 10 roster members minus two full withdrawals gives denominator 8 and threshold 7, subject to floor 5. **Traces:** PR-017.

### RPT-FR-007 — Apply partial withdrawal

Exclude the requested data and their superseded equivalents without removing unrelated permitted topics. Keep denominator membership. Recompute numeric eligibility: loss of one required score means no complete employee Index for that group. Remaining finalized topics may contribute qualitatively to final. Missing values are never zero-filled. **Verify:** 2/3 remaining scores do not create an Index or complete intermediate contributor. **Traces:** PR-017, PR-018.

### RPT-FR-008 — Enforce scored versus qualitative eligibility

Intermediate numeric participants require 3/3 valid scored topics. Final qualitative selection may include 1/3, 2/3, or 3/3 finalized topics and unscored `insufficient_evidence` outcomes, including people not in numeric Engagement. Report recommendations can use only supported surviving text. **Verify:** unscored/partial insights appear only in allowed qualitative inputs and cannot bypass intermediate eligibility. **Traces:** PR-018.

## Metrics and comparisons

### RPT-FR-009 — Open-ended Index arithmetic

For person p and complete Index g, compute `I(p,g) = (q1 + q2 + q3) / 3` from three confirmed integer rubric scores 0–100. Scope metric `I(scope,g)` is the arithmetic mean of eligible `I(p,g)`, giving every person equal weight. No 70/30 polarity formula, missing-topic mean, or average of differently sized team means. **Verify:** `(60+80+70)/3=70`; adding history never adds weight. **Traces:** PR-020.

### RPT-FR-010 — Numeric Engagement arithmetic

Use only three explicitly stated integer answers 1–10 for the approved quantitative questions, not sentiment inference or eNPS promoter/detractor arithmetic. `E(p)=(a1+a2+a3)/3`; scope Engagement is the equal-person mean of all eligible complete respondents. Use every eligible respondent, not a five-person sample. **Verify:** 6,8,10 gives 8.0/10; a missing answer, 0, 11, or 7.5 is invalid. **Traces:** PR-014, PR-020.

### RPT-FR-011 — Retain precision and apply categories

Do not round component means before aggregation or comparisons. Visible numeric metrics use one decimal. Team Lead intermediate category uses unrounded scope Index: `<40` Critical; `40 <= x <70` Needs Attention; `>=70` Healthy. Hide its numeric score everywhere in the recipient payload, including accessibility text. **Verify:** 39.999 is Critical, 40 is Needs Attention, 69.999 is Needs Attention, 70 is Healthy. **Traces:** PR-007, PR-020.

### RPT-FR-012 — Comparable final baseline

For every displayed Index/Engagement dynamics, compare the unrounded current metric with the same metric's final result from the previous completed valid cycle in the same scope. For intermediate, do not compare to a previous preliminary intermediate. Preserve internal final open-ended metrics where complete eligible contributions meet floor 5, without requiring numeric display to Team Lead. **Verify:** eligible prior final is used even if a different preliminary value exists; absent comparable prior result yields Baseline established. **Traces:** PR-020.

### RPT-FR-013 — Direction and version compatibility

Any positive/negative unrounded delta maps to Improving/Declining; exact equality maps to Stable. Do not infer statistical significance. Incompatible policy/question meaning requires compatible rescoring or a new baseline. Employee composition changes alone do not reset history; add a localized caveat that composition may influence change. Uncomparable scope boundary changes must not be silently treated as the same scope. **Verify:** visible rounded equality can still have non-zero direction; incompatible policy does not produce an official delta. **Traces:** PR-020.

## Triggering and time

### RPT-FR-014 — Intermediate overall thresholds

For scope roster size N after applicable full withdrawals, require `max(5, ceil(0.8*N))` distinct complete scored participants for each open-ended Index. Apply separately for Team Lead direct team and Manager overall including Team Leads. Partial withdrawal does not reduce N; departure/transfer does not reduce the original-cycle N. **Verify:** N=5/6/10 requires 5/5/8. **Traces:** PR-013, PR-017.

### RPT-FR-015 — Automatic one-time intermediate

Trigger first publication automatically when an Index first meets its threshold during the reporting window. At most one logical intermediate per tenant/cycle/audience scope/Index, with durable idempotency. Do not wait for a preset intermediate date or for every Manager team to meet display thresholds. Later inputs do not update the publication. Once final report-data cutoff is reached, do not initiate a new intermediate for that cycle. **Verify:** repeated threshold checks and job retries cannot create a second report. **Traces:** PR-013, PR-014, PR-024.

### RPT-FR-016 — Distinguish cycle end and report cutoff

Calculate the last working day that falls inside the cycle using company work calendar/timezone, and schedule final formation/delivery at the end of that working day. Persist report-data cutoff at formation start separately from immutable calendar `periodEnd`. Do not rewrite the original cycle interval to obtain an early final. **Verify:** a Sunday cycle end with Friday as the last configured working day selects Friday; a Friday holiday selects the preceding working day. **Traces:** PR-014.

### RPT-FR-017 — Settle pre-cutoff inputs

Use durable received and required confirmation timestamps within `[cycleStart, reportDataCutoff)` for report eligibility. Finish outstanding processing of timely inputs before assembly; a finalization job completing later is not a late employee response. Do not include post-cutoff confirmations/answers or read working storage from the report renderer. **Verify:** same timely events with different processing order create the same final input set. **Traces:** PR-015.

### RPT-FR-018 — Technical failure recovery

Do not issue a known incomplete final or insufficient-data notice while timely eligible processing is failing. Retry processing/assembly with the same cutoff and idempotency keys. Do not silently extend cutoff or claim an on-time final was delivered if recovery misses the business-day deadline. Operational delay is an error/recovery state, not low participation. **Verify:** a processing error cannot convert six timely complete respondents into an “only four” notice. **Traces:** PR-015, PR-022, PR-024.

### RPT-FR-019 — Overall final gate and notice

After timely input settlement, require at least five complete valid quantitative Engagement participants in the relevant overall scope; no 80% threshold. Publish one final per scope/cycle. Below five, send one localized insufficient-data notice for the cycle without numeric metrics, qualitative condition claims, names, or participation counts. **Verify:** 5 of 100 is eligible; 4 is a notice; retries do not duplicate either outcome. **Traces:** PR-014, PR-022.

### RPT-FR-020 — Manager per-team gates

Intermediate team row: at least five subordinate employees with 3/3 scored topics for the triggering Index. Final team row: at least five subordinate employees with 3/3 valid quantitative Engagement. No additional 80%. Exclude that Team Lead. Below the floor, show team label plus localized Insufficient data, no metric, dynamics, causes, or actions. An overall eligible result remains deliverable even if every team row is insufficient. **Verify:** four employees plus their Team Lead does not meet the team floor; five employees in a ten-person team does. **Traces:** PR-019, PR-022.

## Analytical text and payloads

### RPT-FR-021 — Build team signals from allowed text

Group meaningful common causes, preserve differing causes/opposing experiences, and summarize without individual breakdowns. Use neutral factual scope wording supported by actual insights. Never invent cause, population prevalence, or recommendation effectiveness from scores alone. **Verify:** two distinct supported causes do not become a universal invented third cause. **Traces:** PR-004.

### RPT-FR-022 — Main Focus selection

Use supported current problems, impact, and severity, with reach/dynamics as context. Permit a cross-Index focus. Do not implement the superseded lowest-Index, worst-delta tie-break, or Index-label-only focus algorithm. Partial qualitative inputs may reveal a material issue even without a complete numeric diagnostic Index. **Verify:** a material mixed Autonomy/Belonging issue may be selected instead of an unrelated lower Index score; no problem is invented in a healthy case. **Traces:** PR-005, PR-018.

### RPT-FR-023 — Recommendation sets

Generate zero to three distinct prioritized verb-led bullet actions per overall report section or eligible Manager team section. Team Lead actions address their direct influence; Manager overall actions address their overall remit; Manager team actions describe changes to discuss/agree through that Team Lead. Do not duplicate the entire team action list in overall recommendations. Do not recommend an already completed obsolete remedy. **Verify:** one supported action produces one bullet, not three generic bullets; healthy/no-supported-action case may produce zero. **Traces:** PR-006, PR-010, PR-012.

### RPT-FR-024 — Team Lead intermediate payload

Include Index title, cycle dates, preliminary notice, categorical state, dynamics/baseline, brief explanation and zero to three actions. The preliminary notice explicitly qualifies both results and recommendations and says final arrives on the last working day of the cycle. Do not include numeric Index/question scores or other Index metrics. **Verify:** serialized text, blocks, and accessible fallback have no hidden numeric score. **Traces:** PR-001, PR-007.

### RPT-FR-025 — Team Lead final payload

Include final title/dates, Engagement x.x/10, dynamics/baseline, one concise consolidated explanation, supported concrete Main Focus and zero to three prioritized actions. No separate numeric Autonomy/Growth/Purpose/Belonging. Use all allowed timely final insights, including those finalized from partial Index coverage and late pre-cutoff confirmations. **Verify:** final is not a concatenation of four intermediate narratives. **Traces:** PR-008, PR-018.

### RPT-FR-026 — Manager intermediate payload

Two visible sections: overall scope and teams. Overall displays triggering Index x.x/100, dynamics, brief explanation, zero to three overall actions. Eligible team sections display that Index's x.x/100, dynamics, brief problems/causes, zero to three actions through the Team Lead. Add the explicit preliminary-results-and-recommendations notice for the whole report. **Verify:** no extra Index/Engagement metrics appear; team-data insufficiency cannot delay overall trigger. **Traces:** PR-011.

### RPT-FR-027 — Manager final payload

Overall: final Engagement x.x/10 and dynamics, consolidated explanation, concrete Main Focus, zero to three Manager actions. Teams: Engagement x.x/10 and dynamics, supported concrete focus/causes, zero to three team-management actions or insufficient-data row. Open-ended Indices remain diagnostic, not separate visible numeric final metrics. **Verify:** exclude each TL's own data from team metrics while including it once overall. **Traces:** PR-012.

## Language, presentation, and delivery

### RPT-FR-028 — Company-language output

Resolve company language from admin configuration with English default; apply consistently to the whole report and notices, including fallback text, preliminary message, headings, metric state/dynamics labels, focus, and actions. Personal chat language never overrides a report's language. Preserve scoring meaning when rendering translations; do not rescore because display language changes. **Verify:** company German + Team Lead Ukrainian chat yields German report. **Traces:** PR-021.

### RPT-FR-029 — Language storage boundary

Record report language in snapshot metadata. Canonical app-generated human-readable analytical/report records and admin UI must align with company language as a cross-cutting dependency. Do not localize enum keys, IDs, JSON field names, or overwrite original private conversation messages. Personal conversation runtime must support the user's comfortable language independently; implementing all cross-product localization is a separate dependency, not a claim of current support quality. **Verify:** translated report contains stable machine keys in stored structured metadata; report process has no source-conversation translation/read permission. **Traces:** PR-021.

### RPT-FR-030 — Native Slack visual hierarchy

Use native Block Kit-compatible report messages: clear title, period/context, bold short section labels, whitespace/dividers, and compact vertically stacked team sections. Italicize only short secondary notes. Keep preliminary qualifications visible, not hidden in an obscure footer. Actions are separate verb-led bullets. Details are in SLACK-PRESENTATION.md. **Verify:** desktop/mobile render review preserves section order, no wide overflowing table, and 0/1/3 action variants. **Traces:** PR-021.

### RPT-FR-031 — Semantic emoji and accessible text

Use stable optional symbols with text: 📊 report; state dot + state word; ↑/→/↓ + direction; 🎯 focus; ➜ action; ℹ️ information/insufficient data. A state dot does not independently define a new threshold. Do not use a completed checkbox for pending advice, emoji-only meaning, or excessive warnings. Equivalent accessible text must preserve privacy and metric visibility. **Verify:** reading fallback without emoji still explains the report, with no numeric leakage for TL intermediate. **Traces:** PR-021.

### RPT-FR-032 — Size and safe rendering

Validate Block Kit payloads against current official Slack limits; escape untrusted text so insights cannot inject mentions, links, blocks, or formatting. No silent truncation that drops actions, qualifications, or teams. An oversized Manager report needs an explicit technical packaging design preserving one logical immutable report and per-delivery receipts, not a new product pagination feature invented by the renderer. **Verify:** long localized text and many-team fixtures either fit or use the reviewed bounded packaging strategy without omitted required content. **Traces:** PR-021, PR-024.

### RPT-FR-033 — Snapshot and recipient validation

Persist immutable assembled payload, kind/Index, tenant/cycle/scope, report-data cutoff, language, calculation/privacy/scoring versions, closed input provenance, and frozen recipient/workspace binding before send. Revalidate authorization, current withdrawals, and binding immediately before delivery. Cancel invalid snapshot; never silently retarget or fall back to a public channel. **Verify:** changed recipient, withdrawn source, or workspace mismatch sends nothing under that snapshot. **Traces:** PR-017, PR-024.

### RPT-FR-034 — Delivery idempotency and ambiguous outcome

Use database-enforced logical report identity and durable delivery state. Only the authorized attempt may send; positive provider receipt marks delivery. Ambiguous post-send failure must not automatically call Slack again for the same report until reconciliation resolves the outcome. Published reports are immutable. **Verify:** concurrent jobs, retries, and provider timeout cannot cause silent duplicate publications. **Traces:** PR-024.

### RPT-FR-035 — Do not add deferred inference machinery

Do not add a new overlap/subtraction detection or suppression system as part of this MVP. Specifically, the target final must not require five changed contributors since intermediate. Keep the existing de-identification, floor, scope, no-identifiable-content, consent, and delivery protections. Pilot gate behavior changes require an explicit migration/cutover plan, not disabling unrelated privacy checks. **Verify:** otherwise eligible final with 1–4 updated contributors is not suppressed solely for that count. **Traces:** PR-023.

### RPT-FR-036 — Retention and role boundaries

Use the existing typed retention policies for source insights, withdrawals, report snapshots, and audit provenance; do not revive expired/deleted inputs. Access follows the specific Team Lead/Manager scope and delivery authorization, not generic admin capability. Preserve original conversation isolation. **Verify:** cross-tenant/admin-only/expired-data cases cannot retrieve report inputs or receive a report. **Traces:** PR-002, PR-024.
