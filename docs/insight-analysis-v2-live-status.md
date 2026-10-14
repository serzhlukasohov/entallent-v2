# Insight Analysis V2 — private pilot status

Operator-only status for the Test AI Agent QA cohorts. This file is local to the test worktree. It is not a manager report or a customer dashboard. Counts exclude message text, employee names, individual scores, and private insight content.

**Checked:** 2026-10-07 22:54 Warsaw (20:54 UTC). The six-person cycle is active: 5 / 6 members have started, 35 / 35 in-period inbound messages have processing receipts, 5 windows and 5 working question summaries exist; 1 is ready for confirmation. No Confirmation Bundle, final question insight, or report snapshot exists yet. The first two cycles are closed; their last verified counts remain below. **PR:** #7, `6840c36`.

## Current six-person cycle

Cycle `2131c5e7-a4b8-4d85-b354-bc0ed9119eef`, frozen cohort `9b5d3697-229c-4243-9481-bd6f1456faec`: **2026-10-06 19:00 to 2026-10-08 19:00 Warsaw** (17:00 UTC on both dates). Six eligible legacy-team members are frozen, including the newly added member. The user relayed that member's survey consent; an operator-attestation audit record accompanies the consent flag. After start: 5 / 6 members with 35 / 35 processed inbound messages, 5 policy-bound windows, 5 working question summaries, 1 ready meaning, 0 Bundles, 0 final insights, and 0 report snapshots. The three-question Autonomy group is incomplete. Policy `1.0.0` and manager target are configured. Old-cycle answers do not transfer. An intermediate Autonomy report requires five distinct complete `3/3` contributors from this cohort and separate privacy and recipient checks. The deployed public `/pilot` and `/trends` pages now include this cohort; restored Team and Pulse QA pages show its six members and current V2 records.

## Earlier five-person cycles

| Milestone | Current evidence | Acceptance target |
| --- | ---: | --- |
| Participants who started a DM | First: 2 / 5; successor: 3 / 5 | All five initiate ordinary conversations |
| Inbound messages processed | First: 10 / 10; successor: 38 / 38 | Every accepted inbound turn has a processing receipt |
| Active V2 windows | 2 in first cycle; 3 in successor | A policy-bound window for each participant who writes in the current cycle |
| Ready private question meanings | Successor: 0 ready, 11 `no_data`; first cycle: 7 `no_data` | Three meanings for one Index per participant before a Bundle |
| Complete three-question groups ready for Bundle | 0 now; one participant completed Autonomy `3/3` | At least one natural Bundle, then broader Index coverage |
| Confirmation Bundles | Successor: 3 delivered after 2 delivered disclosure receipts; 1 Autonomy agreement receipt | Delivered in dialogue and answered by the participant |
| Final de-identified question insights | Successor: 6 scored question insights; one participant completed Autonomy `3/3` | Confirmed, scored or explicitly unscored, with private derivatives purged |
| Manager report snapshots | 0 | Pilot: one eligible pre-cutoff Autonomy intermediate aggregate from five distinct contributors; no names or quotes |
| Frozen QA roster in approved legacy team | Frozen 5 / 5; active legacy team now 6, with the new member outside this cohort | Preserve the explicitly quarantined pilot cohort and its frozen membership |

The first cycle ends **2026-10-04 19:30 Warsaw**. The separate successor cycle runs from then until **2026-10-05 20:00 Warsaw**. Earlier inputs do not transfer into the successor's reporting cohort. A final report, if eligible, is assessed after the successor cutoff and settlement interval.

## Conversation coverage

The approved live pilot acceptance now focuses on Autonomy only. Participants should describe their own real or controlled work experience naturally. The bot should not send a separate survey invitation or expose the question list. Autonomy needs meaningful coverage of its three topics, followed by one natural in-dialogue confirmation. The other indices remain implemented product paths, but their live acceptance is outside this narrowed run.

| Index | Topics to cover in conversation |
| --- | --- |
| Autonomy | Control over work; voice and influence; clarity of expectations |
| Growth | Skill development; useful feedback; future development opportunities |
| Purpose | Personal meaning; visibility of contribution; recognition of good work |
| Belonging | Team belonging; psychological safety; manager support |

Engagement is a separate numeric contract and is not part of the twelve open-ended V2 questions.

## Acceptance gates

1. Each new DM produces a processing receipt and a tenant/person/cycle/policy-bound V2 window; no old V1 confirmation is treated as V2 evidence.
2. The agent captures separate private meanings for three topics of an Index, then displays one natural Confirmation Bundle. The participant can agree, correct one meaning, decline, or remain silent; each outcome follows the documented lifecycle.
3. Only confirmed meanings are scored under policy `1.0.0` on the `0–100` range. A privacy decision precedes a persistent de-identified insight; temporary analytical text and source IDs are purged. Silence, decline, and insufficient evidence do not become zero scores.
4. The Autonomy-only pilot employee milestone requires three confirmed valid Autonomy question scores, de-identification, and temporary-state purge. A separate intermediate Autonomy report requires all five frozen-roster participants to have a complete `3/3` Autonomy Index before the 2026-10-05 20:00 Warsaw cutoff. The approved final cycle message still requires all four eligible Index groups and is not a pass criterion for this narrowed pilot. If Autonomy does not reach the five-person gate before cutoff, its manager-delivery milestone remains unverified and needs a new cycle.
5. The configured target is the active hierarchy manager Serhii 1 through the team Slack DM. The five-person QA cohort remains in the approved legacy reporting team for this pilot; its cutover to new `people`/placement records belongs to the separate hierarchy rollout. Verify the frozen legacy roster and recipient binding before each manager delivery. Only aggregates, contributor counts, and fixed team-level action text may be delivered. No employee name, quote, private summary, or individual score appears in the manager payload.
6. Verify cutoff behavior, tenant/cohort separation, withdrawal and target rechecks, idempotent snapshot delivery, and no cross-cycle mixing. Match live evidence against IA-001–IA-047; automated tests alone do not close the live acceptance.

The Railway dashboard has a public domain. Its Trends page separates V2 pilot cycles from legacy Pulse; the restored Team and Pulse QA pages show current V2 records for the exact frozen six-person cohort. This public QA exception was approved by the user on 2026-10-07 and must be removed before customer use. The read-only heartbeat reports meaningful changes in the task; this local panel should be updated from tenant/cohort-scoped metadata only. V2 report jobs are manually enqueued only after the approved contributor, privacy, and recipient checks pass.
