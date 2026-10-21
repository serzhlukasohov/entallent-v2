# Slack Presentation and Synthetic Examples

The user approved this presentation direction for the same Reports requirements PR. It is an output contract, not a runtime implementation or an image-generation requirement.

## Visual hierarchy

1. Clear, bold report title: audience, intermediate/final, and Index when applicable.
2. Short period/context line. For intermediate, a prominent readable qualification: both results and recommendations are preliminary; final arrives on the last working day of the cycle. Do not demote this solely to a faint footer.
3. Metric/state and dynamics, with the visibility rules below.
4. Short bold section labels, brief concrete explanation, and a concrete Main Focus where the report calls for it.
5. Action items on separate lines, starting with a verb; bold the short action phrase rather than whole paragraphs.
6. Whitespace and native dividers separate major sections/teams. Manager teams are vertically stacked compact sections, suitable for mobile, rather than a wide dense spreadsheet-like table.

Use italic for short secondary context, not the entire explanation. No obligatory decorative charts, buttons, progress meters, employee counts, personas, personal profiles, score distributions, PDF attachment, or app dashboard is introduced by these examples.

## Stable semantic symbols

| Meaning | Symbol and text |
| --- | --- |
| Report identity | 📊 + localized report title |
| Team Lead intermediate state | 🟢 Healthy / 🟡 Needs Attention / 🔴 Critical; words accompany color |
| Dynamics | ↑ Improving / → Stable / ↓ Declining; Baseline established when no comparison |
| Main Focus | 🎯 + concrete problem heading/text |
| Pending recommended action | ➜ + concrete verb-led action |
| Context/insufficient data | ℹ️ + explanatory words |

Do not use ✅ to label work that has not happened. Do not turn every line into an ❗ alert. Emoji are supportive; the full meaning must survive accessible text without symbols. Do not invent categorical Engagement bands or Manager red/yellow/green thresholds; their numeric metric and direction suffice. Company language translates labels and explanation, not mathematical values or identifier keys.

## Metric visibility

| Variant | Visible metric | Never show as an extra metric |
| --- | --- | --- |
| Team Lead intermediate | Categorical Index state + dynamics | Numeric Index/question scores |
| Team Lead final | Engagement x.x/10 + dynamics | Numeric four diagnostic Indices |
| Manager intermediate overall/eligible team | Triggering Index x.x/100 + dynamics | Other Index/Engagement metrics |
| Manager final overall/eligible team | Engagement x.x/10 + dynamics | Numeric four diagnostic Indices |

Main Focus is a supported concrete problem or connected issues, possibly across Indices. It is not an automatically selected Index label.

## Native Slack implementation reference

Official references checked on 2026-10-21:

- [Header block](https://docs.slack.dev/reference/block-kit/blocks/header-block/): plain-text larger bold title, with documented limits.
- [Section block](https://docs.slack.dev/reference/block-kit/blocks/section-block/): formatted sections/fields.
- [Formatting with rich text](https://docs.slack.dev/block-kit/formatting-with-rich-text/): rich text, lists, context, and dividers.
- [Block Kit](https://docs.slack.dev/block-kit/): message composition and accessibility considerations.

Use the renderer's chosen supported block type consistently. Slack `mrkdwn` inside sections uses `*bold*` and `_italic_`; do not assume GitHub Markdown, Markdown tables, or arbitrary CSS will render there. A native `header` uses plain text, so do not inject Markdown syntax into it. Validate the current limits and accessible fallback in the development implementation. Wide images of text must not replace accessible native report text.

## Four synthetic report examples

All example content below is invented solely for layout and acceptance review. Company language is English. Cycle label is Q4 2026, period 1 October–31 December 2026. This is not real workforce data, a confirmed production snapshot, or a proposal to change collection topics. Exact wording can vary while the requirements remain binding. Overall/individual-team example numbers are illustrative and do not constitute a hidden dataset for arithmetic.

### A — Team Lead intermediate

> 📊 **Team Lead · Intermediate Autonomy Report**
>
> *Q4 2026 · 1 Oct–31 Dec*
>
> **Preliminary results and recommendations. Final report arrives on the last working day of this cycle.**
>
> 🟡 **Needs Attention** · ↓ Declining
>
> **What is happening and why**
>
> Routine work is understood, but small implementation choices still require approval. Unclear decision boundaries delay progress and make employees hesitant to act independently.
>
> **Recommended actions**
>
> ➜ **Clarify decision boundaries** for recurring implementation choices.
>
> ➜ **Agree an escalation route** for decisions outside those boundaries.

No number is visible. The two actions are meaningful; a third is not required.

### B — Team Lead final

> 📊 **Team Lead · Final Engagement Report**
>
> *Q4 2026 · 1 Oct–31 Dec*
>
> **Engagement: 7.3/10** · ↓ Declining
>
> **What is happening and why**
>
> Meaningful work remains a positive driver. Unclear decision boundaries and hesitation to challenge priorities are making everyday work harder.
>
> 🎯 **Main Focus — Make decisions easier to take and safer to question**
>
> Employees need clarity on what they can decide and a constructive way to raise concerns. These connected issues span autonomy and psychological safety.
>
> **Recommended actions**
>
> ➜ **Agree decision boundaries** for routine work.
>
> ➜ **Invite concerns before confirming priorities** and explain how they influenced the decision.

Do not add four diagnostic numeric scores or identify a person. Focus is a concrete cross-Index issue.

### C — Manager intermediate

> 📊 **Manager · Intermediate Autonomy Report**
>
> *Q4 2026 · 1 Oct–31 Dec*
>
> **Preliminary results and recommendations. Final report arrives on the last working day of this cycle.**
>
> **1 · Overall scope**
>
> **Autonomy: 67.5/100** · ↓ Declining
>
> Repeated approval steps slow routine decisions across the scope. Ownership at team boundaries is not consistently clear.
>
> **Recommended actions**
>
> ➜ **Agree shared decision principles** with Team Leads for routine cross-team choices.
>
> **2 · Teams — management priorities**
>
> **Team North · Autonomy: 64.2/100** · ↓ Declining
>
> Approval is needed for small implementation choices, delaying routine work.
>
> ➜ **Agree a delegation boundary with the Team Lead** for routine implementation decisions.
>
> **Team South · Autonomy: 78.1/100** · ↑ Improving
>
> Clear ownership supports independent decisions. No additional action is supported by the current insights.
>
> **Team Orbit**
>
> ℹ️ **Insufficient data**

Separate teams with native dividers/spacing. Team Leads participate once in overall but not their own team's results. Do not show response counts or an inferred hidden score for Team Orbit.

### D — Manager final

> 📊 **Manager · Final Engagement Report**
>
> *Q4 2026 · 1 Oct–31 Dec*
>
> **1 · Overall scope**
>
> **Engagement: 7.6/10** · ↓ Declining
>
> Meaningful work supports engagement. Unclear decision ownership and difficulty raising priority concerns are the main supported obstacles.
>
> 🎯 **Main Focus — Clarify ownership and make priority concerns safe to raise**
>
> **Recommended actions**
>
> ➜ **Align ownership across teams** with the Team Leads.
>
> ➜ **Establish a constructive priority-review practice** across the scope.
>
> **2 · Teams — management priorities**
>
> **Team North · Engagement: 7.3/10** · ↓ Declining
>
> 🎯 **Focus — Unclear decision rights and hesitation to challenge priorities**
>
> These conditions create approval delays and leave concerns unresolved.
>
> ➜ **Agree decision boundaries with the Team Lead** for recurring work.
>
> ➜ **Ask the Team Lead to invite concerns before finalizing priorities.**
>
> **Team South · Engagement: 8.2/10** · ↑ Improving
>
> Clear ownership and useful feedback support a healthy work experience. No current problem requiring an additional action is supported.
>
> **Team Orbit**
>
> ℹ️ **Insufficient data**

The final metric is Engagement, not four numeric Index scores. Each team can have zero to three actions; the overall section separately has zero to three. This is one logical final report, not a different report for every action.

### Insufficient overall final

> 📊 **Final Pulse Check Report · Q4 2026**
>
> ℹ️ **Insufficient data for a final report for this cycle.**

No count, employee identity, numeric metric, inferred condition, or generic advice is added. A processing failure uses an operational failure/recovery path instead of this notice.

### Additional render fixtures

Render 0, 1, and 3 recommendation sets; Baseline established; Stable; a composition-change caveat; a supported single-Index focus; a supported cross-Index focus; all teams insufficient but overall eligible; and company-language translations such as German with longer text. These are required visual scenarios, not a new dashboard design.
