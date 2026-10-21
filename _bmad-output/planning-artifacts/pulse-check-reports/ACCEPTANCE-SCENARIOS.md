# Pulse Check Reports — Acceptance Scenarios

These are required development/QA scenarios, not tests executed by this documentation PR. All people, teams, messages, and dates used for implementation fixtures must be synthetic. Include deterministic arithmetic/policy assertions and separate narrative/render evaluations; visual examples are not statistical or AI-quality evidence.

| ID | Given / when | Required result | Functional requirements |
| --- | --- | --- | --- |
| RPT-AC-01 | Reader is offered a temporary summary, original message link, or another tenant's finalized row | No private-source access or cross-tenant contribution | FR-001, FR-036 |
| RPT-AC-02 | Sufficient status without cause/refusal; then explicit refusal to explain; then a shown bundle is agreed | Initially not ready; explicit refusal permits confirmation; missing cause remains unknown | FR-002 |
| RPT-AC-03 | Corrected statement has no shown-and-confirmed receipt | Cannot finalize it; a clarification alone is not consent to the final rewrite | FR-002 |
| RPT-AC-04 | Three question scores 60, 80, 70; repeated history plus an unconfirmed update | Employee Index 70 from latest confirmed states; one contribution; pending text does not replace it | FR-003, FR-009 |
| RPT-AC-05 | Manager has two teams of five with employee Indices 60 and 80; their TLs have 90 and 30 | Overall mean `(5×60+5×80+90+30)/12 = 68.333…`; team means 60 and 80 exclude own TL; no average-of-teams result 70 | FR-004, FR-009 |
| RPT-AC-06 | A confirmed contributor becomes inactive or transfers during cycle | Eligible confirmed source-team data remain in source-cycle metrics and denominator; no old insight in destination team; next-cycle source roster omits them | FR-005 |
| RPT-AC-07 | Roster 10; two people fully withdraw before unpublished intermediate | Denominator 8, required 7; withdrawn inputs absent from future deliveries; published intermediate is unchanged | FR-006, FR-014, FR-033 |
| RPT-AC-08 | One of three topics is partially withdrawn | No complete employee Index; denominator unchanged; remaining allowed finalized topics can enter final qualitative analysis | FR-007, FR-008 |
| RPT-AC-09 | An incomplete Index has two finalized scored insights, one unconfirmed working topic; another finalized insight is unscored | Allowed finalized topics can enter final qualitative input; working text cannot; none creates a complete scored intermediate participant | FR-001, FR-008 |
| RPT-AC-10 | Privacy fallback retains direction/severity but no concrete cause | No source-text retrieval or invented concrete cause/action; usable valid numeric score can remain in numeric aggregation | FR-008, FR-021, FR-023 |
| RPT-AC-11 | Engagement answers 6, 8, 10; alternative 0/11/7.5/missing/inferred values | Valid result 8.0/10; invalid/incomplete alternatives do not qualify as a complete respondent; no eNPS transform | FR-010 |
| RPT-AC-12 | Raw Index values 39.999, 40, 69.999, 70 | Critical, Needs Attention, Needs Attention, Healthy respectively; TL payload/fallback contains no numeric Index | FR-011, FR-024 |
| RPT-AC-13 | Same metric previous valid final differs from prior preliminary; two raw values round to the same display | Compare with final and use raw delta; rounded equality does not force Stable | FR-012, FR-013 |
| RPT-AC-14 | No valid prior cycle, incompatible policy/topic version, or only employee composition changes | Baseline for absent/incompatible result unless compatible rescoring exists; composition alone retains comparison with caveat | FR-013 |
| RPT-AC-15 | Roster sizes 5, 6, 10 reach 5, 5, 8 complete participants; repeated events | Automatic first intermediate, once per Index; 4/4 or 2/3 participants do not meet floor/complete condition | FR-014, FR-015 |
| RPT-AC-16 | Company cycle ends Sunday, Friday is working; alternative Friday is a configured holiday | Final day is Friday in first case and the previous working day in second; immutable calendar cycle end remains separate | FR-016 |
| RPT-AC-17 | Required confirmation/answers arrive before report cutoff but finalization is delayed; another confirmation arrives after cutoff | Settle timely inputs and include them; exclude post-cutoff input; report code never reads temporary storage | FR-017 |
| RPT-AC-18 | Timely processing fails temporarily while six complete respondents are expected | No false insufficient-data notice/known partial final; recovery keeps cutoff and does not double-send | FR-018, FR-034 |
| RPT-AC-19 | Final overall scope has 5 of 100 complete Engagement respondents versus only 4 | Five qualifies with all five; four produces localized insufficient-data notice, no count/score/condition claim | FR-019 |
| RPT-AC-20 | Separate Manager team has four employees plus its TL, then five employees of ten; overall report is eligible | First shows Insufficient data; second can show metric without 80% requirement; own TL excluded | FR-020 |
| RPT-AC-21 | Overall Manager final qualifies but every team is individually under floor | Deliver overall final and team-label/Insufficient data entries; do not suppress overall | FR-020, FR-027 |
| RPT-AC-22 | Supported mixed Autonomy/Belonging problem is serious, while another unrelated Index has a lower score | Main Focus describes the actual supported problem; no automatic lowest-Index selection or universal-team claim | FR-021, FR-022 |
| RPT-AC-23 | Narrative evidence supports one action, three distinct actions, or a healthy team with none; old remedy is already completed | Render 1/3/0 action bullets; no filler/duplication; no obsolete remedy | FR-023 |
| RPT-AC-24 | Team Lead intermediate | Correct Index title, dates, categorical state/dynamics, concise causes/actions; explicit preliminary results AND recommendations; no number leakage | FR-024, FR-031 |
| RPT-AC-25 | Team Lead final with late pre-cutoff and partial finalized topics | Engagement/dynamics, one consolidated explanation, concrete Main Focus and ≤3 actions; no four numeric Index scores | FR-025 |
| RPT-AC-26 | Manager intermediate with eligible and ineligible teams | Correct two parts for one triggering Index only, numeric values permitted, distinct overall vs team actions, preliminary notice | FR-026 |
| RPT-AC-27 | Manager final | Overall includes TL own experience once; each own-team section excludes TL; Engagement only as visible numeric metric; qualitative focus/causes and ≤3 actions per section/team | FR-027 |
| RPT-AC-28 | Company German, recipient Ukrainian chat, source insights in several languages | Entire report and notice text German; conversation can stay Ukrainian; language metadata recorded; no re-scoring due to display language | FR-028, FR-029 |
| RPT-AC-29 | Desktop/mobile, long translated text, many teams, no emoji/screen reader | Readable stacked hierarchy, clear preliminary qualifier, native limit validation, no clipped actions/teams, meaningful privacy-safe accessible fallback | FR-030, FR-031, FR-032 |
| RPT-AC-30 | Contributor withdrawal/recipient/workspace authorization changes after assembly, before delivery | No invalid/retargeted send; explicit recovery under current authorized inputs | FR-033 |
| RPT-AC-31 | Two jobs race; Slack send times out after potential acceptance | At most one authorized publication attempt; ambiguous state requires reconciliation, no automatic repeat send | FR-034 |
| RPT-AC-32 | Otherwise eligible final differs from intermediate for only 1–4 people | No suppression solely due to changed-person count; existing input anonymization/floors remain enforced | FR-035 |
| RPT-AC-33 | Expired/deleted inputs or generic admin-only actor requests report/source data | No revival or private access; retention and audience authorization remain authoritative | FR-036 |

## Narrative and visual review rubric

Evaluate generated text against the actual permitted synthetic input set, not against the numeric score alone. A passing report:

- states concrete supported conditions/causes without revealing a person;
- preserves material differences and positive drivers;
- does not imply that all employees share a minority experience;
- does not diagnose from a score or attribute improvement to a recommendation without supported attribution;
- identifies a real Main Focus rather than an Index label;
- offers distinct feasible actions in the right role's influence;
- stays concise, has no filler, and uses zero to three actions appropriately;
- renders metrics, preliminary status, language, and insufficient data correctly.

Use [Slack Presentation](SLACK-PRESENTATION.md) as a composition reference, not immutable model wording. No fabricated numerical pass rate, word-count budget, or statistically validated threshold is approved by this package. The implementation design must record a bounded validation/fallback strategy for invalid narrative output without publishing unsupported content.
