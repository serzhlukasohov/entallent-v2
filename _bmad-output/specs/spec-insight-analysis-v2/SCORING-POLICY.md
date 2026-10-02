---
title: Open-Ended Pulse Scoring Policy and Rubric Catalog
policy_version: 1.0.0
rubric_version: 1.0.0
status: approved-product-contract
approval_date: 2026-10-01
approved_by: Product Owner through product requirements review
language: English
---

# Open-Ended Pulse Scoring Policy 1.0.0

## 1. Approval and scope

The Product Owner approved the twelve canonical topics, shared scoring rules, all question anchors, and explicitly reviewed calibration examples through the product requirements review on 2026-10-01. Every rubric below has version `1.0.0` and the same approval date and approver.

One company-wide policy contains twelve question-specific rubrics; these are not twelve independent policies. Only the applicable rubric and shared rules need to be supplied for a question assessment. This contract covers Autonomy, Growth, Purpose, and Belonging & Psychological Safety. It does not define numeric Engagement scoring, report aggregation, or recommendation generation.

Examples marked **Approved** were reviewed by the Product Owner. Examples marked **Draft** are supplemental proposals, not approved numerical targets or release acceptance criteria. Their approval remains a calibration follow-up; it does not invalidate the approved rubric contract.

## 2. Shared rules

1. Score the employee-confirmed semantic question summary before de-identification. Persist the score with the de-identified insight; purge temporary identifiable analytical material after durable completion. Original private conversation history remains governed by its separate access boundary.
2. Scores are integers from `0` through `100`, with any intermediate integer permitted. The five anchors are reference points, not the only allowed scores: `0` extremely unfavorable, `25` predominantly unfavorable, `50` materially mixed or partially supported, `75` predominantly favorable, `100` clearly favorable with supporting evidence.
3. Use the question-specific meaning, confirmed frequency, scope, and impact to choose an intermediate value. Do not count positive/negative sentences or apply the retired polarity/sentiment weighted formula. Do not infer unreported details. Calm wording may describe a severely unfavorable condition; emotional wording alone does not determine the score.
4. A high score requires positive evidence. Absence of complaints is not sufficient. A score of `50` requires evidence of a mixed or partially supported condition; it is not a default for uncertainty or silence.
5. The conversation should seek the condition, its causes, and useful examples before confirmation without forcing the employee to provide an explanation. An unknown cause does not block scoring when the condition itself is clear.
6. If the condition can be evaluated despite limited detail, score it and record lower confidence. Confidence does not reduce the score. If the condition cannot be evaluated, keep the confirmed qualitative insight without a score as `insufficient_evidence`. Declined, unresolved, and no-data outcomes also have no score; they are not negative or neutral responses.
7. Newly reported information supplements the existing confirmed insight. Preserve the earlier experience, the change, and its known cause rather than silently replacing the history. Confirm and de-identify the supplement. The current score reflects the latest confirmed condition; unconfirmed updates do not change it. Preserve prior de-identified versions and scores as history rather than counting them as additional current answers.
8. When the employee attributes a change to a manager action following a recommendation, record the attribution and link the recommendation when identifiable in the system. Temporal coincidence alone does not establish causation. Persistent analytical text and links remain subject to the privacy/access contract.
9. One policy applies consistently across the company and is fixed within a Pulse Cycle. It should remain stable across cycles. Scores from different policy versions must not form an official trend unless historical de-identified summaries have been rescored under one policy; otherwise establish a new baseline.
10. Persist policy version, rubric version, model identifier, prompt version, confidence, and calculation timestamp. Every non-zero score delta indicates trend direction in MVP, as an experiment assumption rather than a claim of statistical significance.
11. Changes to canonical topic meaning, anchors, or evaluation rules require a new version. Model/prompt provenance must remain recorded even when the policy does not change.

## 3. Canonical topics and rubrics

The IDs below identify topics in this catalog. They do not assert that matching database stable keys or migrations already exist. Canonical meanings guide natural conversations; the agent must not read them as a fixed questionnaire. Separate rubric paragraphs must not be combined into an additional composite score.

### Autonomy

#### A1 — Control over work

**Canonical meaning:** The employee's perceived ability to choose how they carry out their work, influence outcomes within their responsibilities, and act on better approaches without unnecessary barriers.

- **0:** The employee has practically no choice over how work is performed or influence on outcomes within their responsibilities; attempts to improve the approach are systematically blocked.
- **25:** Independence is limited to minor decisions; meaningful actions require approvals that substantially obstruct work.
- **50:** Some significant tasks allow independence, while control and barriers materially restrict approach and influence in others.
- **75:** The employee usually chooses their approach and can implement improvements; specific significant constraints remain.
- **100:** The employee has sufficient independence within their responsibilities, can influence outcomes, and can apply improvements without unnecessary obstacles.

Legitimate safety requirements or coordination of decisions affecting other teams do not automatically reduce the score. Evaluate whether sufficient independence remains and whether constraints obstruct work.

**Approved examples:**
- **20:** "I can decide small details, but almost every meaningful change requires approval. Even routine improvements regularly get stuck."
- **60:** "I choose how to handle routine work, but on important projects the approach is tightly prescribed. Some improvements are possible, others get blocked without a clear reason."
- **90:** "I can choose my approach and try improvements. Cross-team changes need coordination, but that process usually helps rather than blocks me."

#### A2 — Voice and influence

**Canonical meaning:** The extent to which the employee's ideas are heard, seriously considered, and can influence decisions or lead to action.

- **0:** The employee's input is systematically ignored or devalued.
- **25:** Input is heard mostly as a formality; substantive consideration is rare.
- **50:** Input is considered inconsistently: seriously in some significant situations, ignored in others.
- **75:** Input is usually considered seriously; specific significant exceptions remain.
- **100:** Input is consistently considered seriously; the employee understands how their contribution affects decisions or why a suggestion is rejected.

A reasoned rejection does not imply a low score. High scores do not require every proposal to be implemented. Implementation is evidence of influence, not a mandatory acceptance rate.

**Approved example — 90:** "My suggestions are discussed seriously; some are accepted, and the decisions on others are explained. Feedback is occasionally delayed."

#### A3 — Clarity of expectations

**Canonical meaning:** The employee's understanding of their current responsibilities, priorities, expected results, and what successful performance looks like.

- **0:** Tasks and success criteria are unclear; contradictory expectations obstruct work.
- **25:** Most expectations are unclear; the employee regularly has to guess priorities.
- **50:** Main tasks are understood, but significant priorities or success criteria remain unclear.
- **75:** Expectations are predominantly clear; specific gaps cause limited difficulty.
- **100:** Expected results, priorities, and success criteria are clear, and clarity is maintained when expectations change.

**Approved example — 65:** "Tasks and deadlines are clear, but when priorities conflict, it is often unclear which matters more."

### Growth

#### G1 — Skill development

**Canonical meaning:** The employee's perceived progress in developing skills relevant to their work, including whether work provides challenges that support learning.

- **0:** The employee explicitly experiences stagnation; work offers no opportunities to develop professionally meaningful skills.
- **25:** Development is rare and limited; the main work contributes little to learning.
- **50:** Useful development occurs, but inconsistently or only across part of the relevant skills.
- **75:** The employee regularly develops relevant skills and sees progress; specific constraints remain.
- **100:** The employee sees sustained, personally meaningful progress; work and accessible learning support development.

Difficulty and workload alone do not demonstrate growth. Experienced specialists may develop depth of expertise without constantly acquiring new skills.

**Approved example — 80:** "I'm getting noticeably better at designing complex systems through my projects, although I still have limited opportunities to develop my mentoring skills."

#### G2 — Useful feedback

**Canonical meaning:** The extent to which feedback helps the employee understand what to improve and make progress in their work.

- **0:** Needed feedback is absent, or received feedback does not help the employee understand what to improve.
- **25:** Feedback is predominantly vague, late, or unclear and difficult to apply.
- **50:** Some feedback helps improvement, but substantial gaps limit its usefulness.
- **75:** Feedback is usually specific, timely, and actionable; specific shortcomings remain.
- **100:** Clear, actionable feedback is available when needed, and the employee sees how it helps improve their work.

Critical feedback can receive a high score when useful. Praise alone does not establish usefulness.

**Approved example — 65:** "Code reviews help me improve specific technical decisions, but feedback on larger design choices often comes too late to use."

#### G3 — Future development opportunities

**Canonical meaning:** The employee's confidence that they have accessible opportunities to continue learning and progressing professionally within the company.

- **0:** The employee sees no accessible opportunities for continued, personally meaningful professional development in the company.
- **25:** Opportunities appear largely inaccessible; significant barriers undermine confidence in continued development.
- **50:** Some realistic opportunities exist, but access or fit with the employee's goals is substantially limited.
- **75:** The employee is confident that suitable opportunities are accessible; specific limitations or uncertainties remain.
- **100:** The employee sees realistic, accessible opportunities in a meaningful direction and is confident they can use them.

Programs on paper are insufficient: assess real accessibility. Progress does not have to mean promotion.

**Approved example — 85:** "There are relevant projects and funded learning opportunities I can access. The specialist career path is less clear, but I'm confident I can keep developing here."

### Purpose

#### P1 — Personal meaning

**Canonical meaning:** The extent to which the employee experiences their work as personally meaningful, including its connection to the impact they value.

- **0:** Work is experienced as devoid of personal meaning or explicitly opposed to what matters to the employee.
- **25:** Work is predominantly not personally meaningful; meaningful moments are rare.
- **50:** Some work is meaningful, but substantial parts feel pointless or disconnected from valued goals.
- **75:** Work is predominantly personally meaningful; specific areas lose that connection.
- **100:** Work is consistently experienced as meaningful, and the employee can explain its connection to what matters to them.

Meaning may come from craftsmanship, helping people, or building useful products. Alignment with the company's mission is not mandatory. Fatigue or calm expression alone does not establish a lack of meaning.

**Approved example — 80:** "Helping customers solve difficult problems matters to me. Most of my work does that, although some internal reporting feels disconnected from any useful outcome."

#### P2 — Visibility of contribution

**Canonical meaning:** The employee's understanding of how their work contributes to meaningful outcomes for others, the team, the organization, or its customers.

- **0:** The employee does not understand how their work contributes to any meaningful outcomes.
- **25:** The connection to outcomes is predominantly unclear; the employee rarely sees whom their work helps or how.
- **50:** Contribution is clear in some significant tasks, but the connection is lost for substantial parts of the work.
- **75:** The employee usually understands whom their work helps and how; specific significant gaps remain.
- **100:** The employee clearly understands the connection between their main work and meaningful outcomes and can give concrete examples.

Assess visibility, not the size of the contribution. P2 can be high while P1 is low if contribution is understood but not personally meaningful.

**Approved example — 65:** "I can see how our customer-facing features help users, but I don't understand what several major internal projects are supposed to achieve."

#### P3 — Recognition of good work

**Canonical meaning:** The extent to which the employee experiences good work and valuable contributions as being noticed and acknowledged.

- **0:** The employee explicitly reports that good work and significant achievements are systematically unnoticed or credited to others.
- **25:** Good work is rarely noticed; substantial contributions go unrecognized.
- **50:** Recognition exists but is inconsistent: significant achievements are sometimes noticed and sometimes ignored.
- **75:** Good work is usually noticed and acknowledged; specific significant exceptions remain.
- **100:** The employee experiences good work as consistently noticed and acknowledged in a suitable way.

Recognition need not be public praise, a bonus, or promotion. Absence of praise during a particular week does not automatically reduce the score.

**Approved example — 85:** "My manager usually acknowledges specific contributions and gives me credit. Less visible maintenance work still gets overlooked sometimes."

### Belonging & Psychological Safety

#### B1 — Team belonging

**Canonical meaning:** The employee's sense of being accepted, included, and a genuine member of their team.

- **0:** The employee feels excluded or rejected by the team.
- **25:** The employee predominantly feels like an outsider; acceptance and inclusion are rare.
- **50:** Belonging is experienced in some interactions, but the employee remains outside other significant situations.
- **75:** The employee usually feels accepted and a full team member; specific inclusion problems remain.
- **100:** The employee consistently feels accepted, included, and a full team member.

Belonging does not require friendship with everyone or participation in social events. Assess the employee's experience of acceptance and inclusion.

**Approved example — 65:** "I feel included when we work together on projects, but important informal discussions often happen without me, and I sometimes feel outside the core group."

#### B2 — Psychological safety

**Canonical meaning:** The employee's perceived safety in raising concerns, sharing ideas, disagreeing, or admitting mistakes without fear of humiliation or retaliation.

- **0:** The employee reports punishment, humiliation, or threats for speaking up; openness is perceived as unsafe.
- **25:** Significant fear of negative consequences frequently leads the employee to hide problems, disagreement, or mistakes.
- **50:** The employee can speak openly in some situations, but feels unsafe and holds back in other significant circumstances.
- **75:** The employee can usually raise issues, propose ideas, and admit mistakes openly; specific situations still cause concern.
- **100:** The employee confidently speaks up and admits mistakes and, based on described experience, expects respectful, constructive treatment.

Absence of complaints does not demonstrate safety. Reasonable accountability for mistakes is not automatically unsafe: assess whether honest disclosure is possible without humiliation or retaliation. A2 assesses influence; B2 assesses the safety of expression.

**Approved example — 40:** "I can admit mistakes to teammates, but I avoid disagreeing with our manager because people who challenge decisions get publicly embarrassed."

#### B3 — Manager support

**Canonical meaning:** The employee's experience of receiving practical help, guidance, and support from their manager in day-to-day work.

- **0:** Needed support is absent, or the manager's actions systematically obstruct the employee's ability to work effectively.
- **25:** Help is predominantly unavailable or ineffective; significant work difficulties remain unsupported.
- **50:** The manager helps in some situations, but support is insufficient in other important cases.
- **75:** The employee usually receives needed help, guidance, and assistance removing obstacles; specific significant gaps remain.
- **100:** The employee reliably receives suitable, timely support when needed, and the manager helps address significant work obstacles.

High scores do not require constant intervention. An independent employee may need support only occasionally. If help has not been needed and availability is unknown, do not assume a high or low score.

**Approved example — 80:** "My manager helps resolve priorities and removes blockers when I ask. Support is reliable, although decisions involving other teams sometimes take too long."

## 4. Supplemental calibration examples — DRAFT, NOT APPROVED

These proposed fixtures expand low/middle/high coverage. Their exact numerical targets require Product Owner review. Approved examples in section 3 retain their approved status.

| Topic | Draft low example | Draft middle example, when needed | Draft high example, when needed |
| --- | --- | --- | --- |
| A2 | **15:** My suggestions are routinely dismissed without discussion, even when they concern my own work. | **55:** My ideas shape technical decisions, but suggestions about team processes are usually ignored. | Approved 90 example in section 3. |
| A3 | **20:** I regularly receive conflicting priorities and cannot tell what a successful result should look like. | Approved 65 example in section 3. | **95:** Responsibilities, priorities, and success criteria are clear; when they change, we clarify them promptly. |
| G1 | **15:** My main work repeats skills I already have, and opportunities to develop relevant skills are rare. | **50:** Some projects help me learn, but about half my work offers no meaningful development. | Approved 80 example in section 3. |
| G2 | **20:** Feedback usually arrives after the work is finished and gives little guidance I can apply. | Approved 65 example in section 3. | **95:** I receive specific feedback when I need it and can describe how applying it improved my work. |
| G3 | **15:** The learning and project opportunities I want exist, but I am repeatedly unable to access them. | **50:** I can access some relevant learning, but opportunities in my main development direction remain uncertain. | Approved 85 example in section 3. |
| P1 | **15:** Most work feels pointless to me; only an occasional task connects with something I value. | **50:** Customer work feels meaningful, but a substantial part of my role feels disconnected from anything I care about. | Approved 80 example in section 3. |
| P2 | **20:** I rarely understand who uses my work or what outcomes it supports. | Approved 65 example in section 3. | **95:** I can explain how my main tasks affect customers and team outcomes, with recent concrete examples. |
| P3 | **15:** Significant achievements usually go unnoticed, and others are sometimes given the credit. | **50:** Some important contributions are acknowledged, while other equally important ones regularly go unnoticed. | Approved 85 example in section 3. |
| B1 | **15:** I usually feel outside the team and am rarely included in work discussions that concern me. | Approved 65 example in section 3. | **95:** I feel accepted and included in relevant team interactions, even though I do not join social events. |
| B2 | **15:** I routinely hide concerns and mistakes because people who disclose them get humiliated. | Approved 40 example in section 3. | **95:** I can raise concerns, disagree, and admit mistakes; recent responses have been respectful and constructive. |
| B3 | **15:** When I need help with priorities or blockers, support is usually unavailable. | **50:** My manager helps with priorities, but significant delivery blockers often remain unsupported. | Approved 80 example in section 3. |

## 5. Brownfield alignment and developer handoff

The approved topic set supersedes the older catalog in `packages/database/src/seed.ts` and REQ-008 in `docs/collected-product-requirements.md` for V2 open-ended analysis. Code and persisted survey definitions have not been migrated by this documentation change.

- A1 replaces strengths-use opportunity with control over work; do not relabel old answers as A1.
- A2 retains voice/influence; A3 retains expectation clarity, with the meanings defined here.
- G1 refines actual skill development; G2 replaces occurrence of a progress discussion with usefulness of feedback; G3 replaces role clarity with future development opportunities.
- P1 and P2 retain meaning/contribution with the boundaries above. P3 replaces a seven-day praise event with the recognition pattern.
- B1 replaces wellbeing with team belonging; B2 retains psychological safety; B3 replaces broad personal care from someone at work with practical support from the manager.
- Create versioned topic definitions for changed meanings. Do not reuse an old rubric version or reinterpret historical responses automatically. Database key choices and migration mechanics are implementation work.

Implementation is reviewable when all twelve canonical topics have versioned definitions, scores use the matching approved rubric and provenance, missing data remains unscored, confirmed updates preserve de-identified history and update the current score, and changed topic meanings do not silently inherit historical answers. Approved fixtures are calibration references; automated acceptance tolerances and supplemental draft targets require separate validation rather than invented thresholds.
