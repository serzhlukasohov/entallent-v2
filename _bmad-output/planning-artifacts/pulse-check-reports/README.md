# Pulse Check Reports — Team Lead and Manager

Status: product decisions approved in the October 2026 requirements interview; implementation pending.
Documentation date: 2026-10-21.
Reviewed code baseline: `origin/main` at `6646764b6b45d4b7db588b0c5ba349ec326901e4`.

This package defines four MVP reports and their insufficient-data outcomes:

1. Team Lead intermediate Index report.
2. Team Lead final Engagement report.
3. Manager intermediate Index report: overall scope and teams.
4. Manager final Engagement report: overall scope and teams.

Start with [Product Requirements](PRODUCT-REQUIREMENTS.md), then [Functional Requirements](FUNCTIONAL-REQUIREMENTS.md) and [Acceptance Scenarios](ACCEPTANCE-SCENARIOS.md). [Slack Presentation and Examples](SLACK-PRESENTATION.md) defines the approved formatting system. [Infographic Prompt](INFOGRAPHIC-PROMPT.md) is a copy-ready visual-design prompt with synthetic example content. [Decision and Integration Notes](DECISIONS-AND-INTEGRATION.md) identifies superseded rules, current-code gaps, and engineering design obligations.

## Authority and boundaries

These requirements are derived from the user's V1 Team Lead/Manager documents and the completed reporting interview, including subsequent corrections. Later decisions supersede earlier proposals. In particular, Main Focus is a concrete current problem, not the lowest-scoring Index; final delivery is on the last working day of the cycle; report language is the company language.

For the Team Lead and Manager reporting scope, this package supersedes conflicting report-output, lifecycle, rollout-scope, and cutoff defaults in `docs/collected-product-requirements.md`, `docs/current-project-grill.md`, historical July report designs, and the limited V2 reporting pilot decision packet. It does not silently grant HR/HRBP/Leadership report access or replace unrelated requirements. Keep the existing company hierarchy and Insight Analysis contracts except for explicitly listed changes/dependencies.

The role name in V2 is **Manager**. V1's “Manager of Managers” describes the source material, not a separate V2 report role. Manager reports include Team Leads as participants in the overall section and exclude each Team Lead's own answers from that Team Lead's team section.

This is a documentation-only change. It does not enable report gates, modify production data, deploy, send Slack messages, implement a new formatter, or claim that these reports already exist. Implementation must stay in the active TypeScript architecture. New migrations, technical designs, and runtime tests belong to follow-up development work.

HR/HRBP/Leadership report content is not yet defined. Interview planning for those roles is separate work. A general language policy is recorded as a cross-cutting dependency; this package does not authorize rewriting original private conversation messages.
