# Prompt for Pulse Check Report Infographics

Скопируйте блок ниже в инструмент для генерации инфографики или интерфейсных макетов. Промпт на английском; примеры также на английском, потому что для этой иллюстрации выбран company language = English. Для немецкого или другого языка замените переменную и переведите весь текст репортов единообразно. Промпт описывает целевые отчёты, а не существующий production UI.

## Copy-ready master prompt

```text
You are a senior information designer creating a precise, readable visual reference for an employee-listening product called enTalent.

TASK
Create a coordinated set of FOUR infographic-style Slack message mockups showing the four approved Pulse Check report variants:
A. Team Lead — Intermediate Index Report
B. Team Lead — Final Engagement Report
C. Manager — Intermediate Index Report
D. Manager — Final Engagement Report

These are native text-based Slack reports, not analytics dashboards or posters full of decorative charts. Show how a real manager would scan a structured agent message. Use realistic Slack-inspired typography, restrained spacing, native-looking dividers, and a neutral workplace interface. Do not copy a real person's photo or invent interactive features.

OUTPUT FORMAT
Preferred: four separate high-resolution portrait images, one report variant per image, all using exactly the same visual system. Use at least 1600 px width per image; let height expand with content. Manager variants need taller canvases so every team section and action remains readable. Never shrink text to squeeze four complete reports into one small image.
If the tool can produce only one image, make a large 2×2 comparison board with four clearly separated portrait panels, at least 4096 px wide, each labeled A/B/C/D outside its report. Keep all sample text legible. If necessary, use fewer words in explanations while preserving their meaning, not smaller illegible text or omitted sections.
Optional secondary deliverable only after the four readable panels: one compact comparison overview. Do not replace the individual report examples with the overview.

VARIABLES FOR THIS GENERATION
Product: enTalent
Company language: English
Cycle: Q4 2026
Period: 1 October–31 December 2026
Data: entirely synthetic design examples, not real employee findings
Team names: Team North, Team South, Team Orbit

ROLE MODEL — IMPORTANT
Team Lead manages direct employees.
Manager has an overall reporting scope containing Team Leads and the employees of their teams.
Manager reports ALWAYS have two parts:
1. Overall scope: Team Leads and employees each contribute once as equal participants.
2. Teams — management priorities: insights of subordinate employees describe conditions in each team; the team's own Team Lead's personal responses are excluded. Actions tell the Manager what to discuss or agree with that Team Lead.
Do not call the V2 role “Manager of Managers.” Do not turn the second part into employee monitoring or a personal competence rating.

SHARED VISUAL SYSTEM
- Put a clear large bold report title at the top, optionally preceded by 📊.
- Under the title, put the cycle and dates in smaller secondary text, with short italic context where useful.
- Intermediate reports need a prominent readable notice, not a nearly invisible footer:
  “Preliminary results and recommendations. Final report arrives on the last working day of this cycle.”
- Use short bold section headings and generous but economical whitespace.
- Use native-looking horizontal dividers between Manager overall/team sections and between teams.
- Show each action on its own line. Use ➜ as a consistent action marker and bold only the initial action phrase.
- Use 🎯 for Main Focus, always followed by a concrete problem statement.
- Use ↑ Improving, → Stable, or ↓ Declining for dynamics. If no valid comparison exists, use “Baseline established,” with no invented arrow.
- Use ℹ️ for Insufficient data/context.
- Use green/yellow/red circles ONLY for the Team Lead intermediate categorical state: 🟢 Healthy, 🟡 Needs Attention, 🔴 Critical. Always include the text label; color alone is not meaning.
- Do not invent categorical bands for Engagement or add colorful score gauges to Manager reports.
- Do not use ✅ checkboxes for recommended work that has not been completed. Do not cover the message in warning signs, exclamation marks, gradients, or unrelated emoji.
- Keep causes short, concrete, and management-oriented. Do not render long italic paragraphs.
- Keep Manager teams vertically stacked, not in a wide spreadsheet with tiny columns.
- Do not include response counts, named employee data, avatars for individual employees, quotes, private messages, percentages answered, waiting-for-confirmation counts, contributor deltas, or survey progress.
- No buttons, check-off controls, filter menus, trend charts, radar diagrams, pie charts, employee lists, PDF icons, “view dashboard” links, or other unapproved features.
- Do not print raw JSON, API names, backticks, Markdown syntax, SQL, or implementation notes inside a mockup. Render bold/italic visually.
- Simulate familiar Slack message composition without wasting most of the canvas on a full sidebar or giant application chrome. The report is the focus. One small neutral enTalent sender/avatar and timestamp is enough if useful.
- Ensure good contrast and keep essential meaning clear in grayscale.

CONTENT RULES — NEVER VIOLATE
1. Team Lead INTERMEDIATE shows a categorical state and dynamics, NEVER the numeric Index or question scores. For the synthetic Autonomy example use “Needs Attention · Declining,” not “64.2/100.”
2. Team Lead FINAL shows numeric Engagement /10, NEVER separate numeric Autonomy/Growth/Purpose/Belonging scores.
3. Manager INTERMEDIATE shows numeric values /100 for ONE triggering Index only, overall and for eligible teams. Do not show extra Engagement or the other three Index scores.
4. Manager FINAL shows Engagement /10 overall and for eligible teams. Open-ended Indices explain causes qualitatively; do not display four numeric Index metrics.
5. Main Focus means “what specifically hurts or needs attention now,” not “the lowest Index.” It can combine connected Autonomy and Belonging/psychological-safety issues. Do not replace it with “Autonomy is lowest.”
6. Recommendations must follow the supplied causes. Zero to three actions per overall section or eligible team is allowed; three is a maximum, not a required number. The supplied North team has two actions; the supplied South team has none.
7. Team Orbit must show ONLY its team name and “Insufficient data” in its team block. Do not show a hidden metric, arrow, cause, action, count, or “0/10.”
8. General final delivery is on the last working day within the cycle, not after the calendar cycle closes. If cycle end is a weekend, final can arrive Friday. Do not invent a specific 17:00 sending rule.
9. All report copy uses COMPANY language, even if a recipient privately chats with the agent in Ukrainian, Chinese, Russian, or another language. For these images company language is English. A later German version must translate all report labels and narrative, not just headings.
10. State, cause, and actions must read as team-level conditions, never a diagnosis of an identifiable person.

PANEL A — TEAM LEAD INTERMEDIATE
Title:
“Team Lead · Intermediate Autonomy Report”
Period:
“Q4 2026 · 1 Oct–31 Dec”
Prominent note:
“Preliminary results and recommendations. Final report arrives on the last working day of this cycle.”
State/dynamics:
“🟡 Needs Attention · ↓ Declining”
Heading:
“What is happening and why”
Explanation:
“Routine work is understood, but small implementation choices still require approval. Unclear decision boundaries delay progress and make employees hesitant to act independently.”
Heading:
“Recommended actions”
Two separate action items:
“➜ Clarify decision boundaries for recurring implementation choices.”
“➜ Agree an escalation route for decisions outside those boundaries.”
No numeric score. No third filler action. No miniature question score panel.

PANEL B — TEAM LEAD FINAL
Title:
“Team Lead · Final Engagement Report”
Period:
“Q4 2026 · 1 Oct–31 Dec”
Metric:
“Engagement: 7.3/10 · ↓ Declining”
Heading:
“What is happening and why”
Explanation:
“Meaningful work remains a positive driver. Unclear decision boundaries and hesitation to challenge priorities are making everyday work harder.”
Focus:
“🎯 Main Focus — Make decisions easier to take and safer to question”
Focus explanation:
“Employees need clarity on what they can decide and a constructive way to raise concerns. These connected issues span autonomy and psychological safety.”
Heading:
“Recommended actions”
Two separate action items:
“➜ Agree decision boundaries for routine work.”
“➜ Invite concerns before confirming priorities and explain how they influenced the decision.”
No preliminary notice. No four diagnostic numeric scores.

PANEL C — MANAGER INTERMEDIATE
Title:
“Manager · Intermediate Autonomy Report”
Period:
“Q4 2026 · 1 Oct–31 Dec”
Prominent preliminary note exactly as in A.

PART 1 heading:
“1 · Overall scope”
Metric:
“Autonomy: 67.5/100 · ↓ Declining”
Explanation:
“Repeated approval steps slow routine decisions across the scope. Ownership at team boundaries is not consistently clear.”
Subheading:
“Recommended actions”
One action:
“➜ Agree shared decision principles with Team Leads for routine cross-team choices.”

PART 2 heading:
“2 · Teams — management priorities”

Team North block:
“Team North · Autonomy: 64.2/100 · ↓ Declining”
“Approval is needed for small implementation choices, delaying routine work.”
“➜ Agree a delegation boundary with the Team Lead for routine implementation decisions.”

Team South block:
“Team South · Autonomy: 78.1/100 · ↑ Improving”
“Clear ownership supports independent decisions. No additional action is supported by the current insights.”
No action bullet for this team.

Team Orbit block:
“Team Orbit”
“ℹ️ Insufficient data”
No other text or metric in this block.

PANEL D — MANAGER FINAL
Title:
“Manager · Final Engagement Report”
Period:
“Q4 2026 · 1 Oct–31 Dec”

PART 1 heading:
“1 · Overall scope”
Metric:
“Engagement: 7.6/10 · ↓ Declining”
Explanation:
“Meaningful work supports engagement. Unclear decision ownership and difficulty raising priority concerns are the main supported obstacles.”
Focus:
“🎯 Main Focus — Clarify ownership and make priority concerns safe to raise”
Subheading:
“Recommended actions”
“➜ Align ownership across teams with the Team Leads.”
“➜ Establish a constructive priority-review practice across the scope.”

PART 2 heading:
“2 · Teams — management priorities”

Team North block:
“Team North · Engagement: 7.3/10 · ↓ Declining”
“🎯 Focus — Unclear decision rights and hesitation to challenge priorities”
“These conditions create approval delays and leave concerns unresolved.”
“➜ Agree decision boundaries with the Team Lead for recurring work.”
“➜ Ask the Team Lead to invite concerns before finalizing priorities.”

Team South block:
“Team South · Engagement: 8.2/10 · ↑ Improving”
“Clear ownership and useful feedback support a healthy work experience. No current problem requiring an additional action is supported.”
No invented focus/problem and no action bullet for this team.

Team Orbit block:
“Team Orbit”
“ℹ️ Insufficient data”

No preliminary notice in D. No four numeric diagnostic Indices. Do not repeat every North action in the overall section.

TEXT AND COMPOSITION QA BEFORE OUTPUT
Check that all text is correctly spelled and readable; no invented letters or gibberish. Ensure the number formats are exactly /100 for Manager intermediate and /10 for finals. A has no numeric score. C and D have visibly distinct overall and teams sections. Each action is its own bullet line. Orbit has no disclosed result. Intermediate notices qualify both results and recommendations. Main Focus states a problem, not the lowest Index. No individual employee information or counts appears. Do not add screenshots of conversations.

If rendering all exact text is beyond the image model's capability, produce the same four layouts as editable infographic/UI compositions with real text layers rather than faking small illegible text. Preserve content and semantic rules over decorative detail.

Return the four coordinated visuals. If your tool supports explanatory output, list any unavoidable deviations outside the artwork, never hide them in the report content.
```

## Optional follow-up prompt: edge states

```text
Using the exact visual system already established, create a separate supplemental infographic with these three small synthetic report states:
1. Baseline established: show a final Engagement value, no directional arrow, and “Baseline established.” Do not invent prior-period numbers.
2. Insufficient overall final: show only final title/period and “Insufficient data for a final report for this cycle.” No score, employee count, narrative, or recommendations.
3. Healthy team with no actions: show the permitted report metric/direction, a brief supported positive explanation, and no fabricated action bullets.
Keep the company language English and preserve every role-specific metric visibility rule. These are supplemental states, not new report types or interface features.
```
