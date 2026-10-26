# Pulse Check interactive demo requirements

Date: 2026-10-26

Status: agreed product requirements; implementation and runtime compatibility are not yet verified.

## Purpose and delivery boundary

Let a prospective customer experience the causal chain from their own conversation to a saved, anonymized insight and a Team Lead recommendation.

This document captures the requirements agreed in the product discovery conversation. This PR does not implement or deploy the demo. The intended implementation baseline is `main` after final Pulse Check reports for Team Leads and managers have been delivered. Creating this requirements branch from today's `main` does not assert that this prerequisite is complete. Reconcile the implementation branch with that delivered version before development.

The demo must reuse the active product conversation, insight processing, scoring and reporting logic. A scripted conversation, keyword classifier, fixed report or independently generated display-only insight cannot substitute for the real chain. The earlier exploratory UI mockups establish layout preferences only; their content and behavior are not implementation specifications.

## Access and sessions

- Provide access through a dedicated link. Registration and invitation mechanisms are not required by the agreed first-version flow.
- Each page load, including refresh, creates an independent session and opens the first tab in its pre-start state.
- Refresh does not restore the previous conversation, insight or report. New sessions must not receive results from previous or concurrent sessions.
- Keep demo traffic and synthetic records separate from customer production data. The hosting choice (separate instance or isolated demo tenant) remains an implementation decision requiring an isolation review.
- Resetting the browser experience does not specify backend deletion or retention. Define retention and cleanup before launch.

## Interface

All product-facing interface text is English. Use three tabs on the same page:

1. **Conversation**
2. **Saved insight**
3. **Team Lead report**

The approved layout direction is the tabbed interface: an interactive chat in the first tab and a database-like table in the second. Three simultaneous narrow columns and an insight panel below the chat are not the selected layouts.

Preserve the content of previous tabs within the session so visitors can return and compare their messages, saved insights and recommendations. Fast comparison is the objective; the exact comparison affordance remains a UX detail. Do not replace the full final report with a newly designed dashboard.

## Conversation

- Initially show **Start demo**, with no agent conversation started before that action.
- On start, the agent proactively sends the first message on a randomly selected eligible backlog topic. Recognition is an example, not the only or fixed starting topic.
- Present a Slack-like direct-message conversation with clearly identifiable senders, individual messages, a text composer and a send action. Visitors write their own replies rather than selecting a prepared role or case.
- Support free answers and topic changes. If a conversation starts with recognition but surfaces a substantive workload or autonomy signal, follow that signal instead of requiring an answer to the initial question.
- Understand both the employee's assessment/situation and the reason behind it. A bare positive or negative statement is not sufficient evidence of a complete insight.
- Before progression, summarize the understood situation and cause and ask for confirmation. Allow confirmation, rejection or clarification; revised understanding needs confirmation again.
- One sufficiently understood and confirmed backlog topic is normally enough. Do not require completion of all three questions of an index or the full backlog.
- Do not impose message-count limits or force an answer to a specific question. Roughly 60-70% backlog orientation is a qualitative conversational intent, not a quota, timer or routing probability. Gently seek useful backlog evidence while supporting user-introduced subjects.
- Off-topic conversation alone does not justify fabricating a backlog insight or unlocking an unsupported report.

### Fully positive experiences

Positive evidence is a valid outcome. If the first topic is fully positive, with a clear reason and no improvement need, confirm it and try a second backlog topic. If the second is also fully positive, the demo may complete with high product-derived scores and no corrective recommendations for those topics.

Do not pressure the visitor into reporting a problem. Do not map generic praise directly to 100/100 or invent an improvement recommendation: use product scoring and evidence rules. The precise persisted-record count for this two-topic path must follow the real pipeline and be settled during implementation.

## Saved insight

- Open this stage after confirmation and successful persistence of the relevant insight(s).
- Render the actual persisted anonymized record(s) in a polished, read-only, database-like table. Do not generate a separate paraphrase just for display.
- Expose the anonymized meaning, underlying cause, backlog topic and product-supported criticality score. Match actual storage and scoring contracts; illustrative mockup column names and numbers are not prescribed schema.
- Preserve semantic meaning, cause and degree of criticality while removing names and identifying circumstances. Removing names alone is insufficient when the situation identifies the employee indirectly.
- The visitor can compare against the original conversation by returning to the first tab.
- Do not introduce editing, re-anonymization requests or feedback correction controls at this stage. The product's internal processing is being revealed for demonstration; post-storage editing is not part of this flow.

Anonymization quality is a launch gate, not something to repair with a fabricated display record. Validate difficult, identifying and high-severity examples before exposing this demo to prospects.

## Team simulation and report inputs

The visitor supplies one person's experience, which is not sufficient to claim an observed team pattern. Explain clearly that this is a simulation of a team sharing that experience.

- Add five synthetic employee responses semantically consistent with the visitor's confirmed situation and cause. This gives one visitor plus five simulated teammates, not six real respondents.
- Model a unanimous team for the visitor-derived topics. Vary wording without adding new causes or conflicting signals that would change recommendations.
- Fill remaining backlog topics with prepared synthetic baseline data so the final report is complete without interviewing the visitor across the entire backlog.
- Exclude or replace baseline data for topics covered by the visitor, including both topics on the positive path. Do not let unrelated baseline data override the visitor's evidence on those topics.
- Label the simulation and prepared synthetic data clearly. Do not present generated teammates as independent corroboration or real customer data.
- Use the product reporting pipeline on this combined dataset, rather than swapping in a fixed report after the conversation.

## Final Team Lead report and attribution

Show the exact product **final Team Lead report**, rendered as it would appear in Slack. Preserve the actual final report's structure, wording conventions and complete scope. The manager report is a baseline delivery prerequisite, not an additional demo report tab.

Add a clearly distinguishable demo annotation, for example **Based on your conversation**, on recommendations derived from the visitor's confirmed insights. Prepared baseline-only recommendations must not carry that annotation.

The five semantically matching teammates belong to the visitor-derived simulation path. Distinguish this from unrelated prepared baseline data. Carry source provenance through to recommendation generation; do not infer attribution afterward from keyword similarity or highlight all recommendations indiscriminately.

If a recommendation depends on both visitor-derived and baseline evidence, retain that distinction rather than implying exclusive visitor origin. Exact attribution metadata and annotation presentation remain technical/UX decisions. Annotations must not rewrite the final product report into a different report format.

For positive topics with no justified corrective recommendation, show the corresponding positive result without manufacturing an action merely to provide something to highlight.

## Generation timing and states

- Start report preparation/generation as soon as the confirmed inputs are durably available, while the visitor studies the saved insight tab.
- If the report is not ready when the visitor enters the last tab, show a loader and an English explanation that the report is being generated.
- Target report readiness within 30 seconds of starting generation. Up to one minute is acceptable for the initial version; these are experience targets, not verified latency measurements or hard cutoffs.
- Persistence or generation errors must not be masked by stale records, another session's report, or canned success output. Preserve already available session content and explain the failure. Recovery interactions require implementation design.

## Acceptance scenarios

| ID | Scenario | Required result |
| --- | --- | --- |
| AC-01 | Open the link or refresh after a completed run | New isolated session; Conversation tab; Start demo; no restored results |
| AC-02 | Press Start demo | Agent initiates a message about an eligible randomly selected backlog topic; composer accepts free text |
| AC-03 | Recognition opener receives a workload or autonomy disclosure | Agent follows the disclosed topic, establishes situation and cause, and requests confirmation |
| AC-04 | Visitor rejects or changes the summary | Understanding is revised and confirmed before progression |
| AC-05 | One negative or mixed topic has sufficient confirmed evidence | Actual anonymized record is persisted and displayed with product criticality; report preparation starts |
| AC-06 | First topic is fully positive | Confirm it and try another backlog topic without manufacturing a problem |
| AC-07 | Both explored topics are fully positive | Product-derived positive scores; no unsupported corrective recommendations; baseline does not contradict covered topics |
| AC-08 | Input contains names, distinctive circumstances or severe concerns | Persisted anonymous output preserves meaning, cause and severity without identifying the author |
| AC-09 | Visitor describes approval delays | Saved signal, synthetic teammates and visitor-derived recommendations remain about that same confirmed situation/cause; no fixed unrelated report |
| AC-10 | Report contains visitor-derived and baseline-only recommendations | Visitor-derived recommendations are marked; baseline-only recommendations are not; provenance is explicit |
| AC-11 | Report generation is still running on tab entry | Loader appears; completed result uses the actual final Slack Team Lead report format |
| AC-12 | Visitor continues on their own subjects for many messages | Agent remains supportive and gently backlog-oriented; no forced-answer loop or message-count cutoff |
| AC-13 | Two visitors run concurrently, or an old job completes after refresh | Records, messages and reports remain scoped to the correct session |
| AC-14 | Persistence or generation fails | Visible error state; no fabricated success, stale result or unrelated sample output |

## Implementation discovery and release gates

Before implementing, verify against the delivered `main` version:

1. Locate the active TypeScript conversation entry point, backlog selection, confirmation contract and persistence pipeline. Reuse them through appropriate adapters; do not extend retired MAF/`agent-service` surfaces.
2. Verify whether the existing pipeline supports a shortened one-topic cycle and the optional second positive topic. Identify any demo-specific orchestration without silently changing real-product behavior.
3. Identify the exact saved insight/criticality schema and final Team Lead Slack renderer. Do not treat exploratory UI mockups as their contracts.
4. Verify anonymous insight quality against identifying circumstances, semantic drift and criticality loss. Confirmation of the conversation does not alone validate the subsequent anonymization.
5. Define isolated session ownership, job/result correlation, retention and cleanup. Refresh must not permit an old result to populate a new session.
6. Define synthetic dataset construction and minimum cohort rules without weakening production privacy controls.
7. Define reliable insight-to-recommendation provenance, including mixed-source recommendations.
8. Measure real report latency and settle failure recovery UX.

These are implementation verification tasks, not claims that existing capabilities are missing or already complete. Hosting topology, final data contracts, detailed report annotations, retention and failure recovery remain open technical choices within the agreed requirements.
