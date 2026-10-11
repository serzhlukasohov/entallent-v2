# Insight Analysis V2: clean production test on the QA group

Checked 2026-10-04. Target: Railway `reasonable-adaptation` / `production`, tenant `Test AI Agent` (`7d1e0163-6d53-4713-bd24-254690cc5090`), PR #7 head `6840c36`.

## Product boundary

Insight Analysis V2 observes ordinary private employee conversations. It does not start a conversation or send a separate survey invitation. The approved contract does require one natural in-dialogue Confirmation Bundle when three question meanings in an Index are ready (SPEC.md IA-006–IA-011; collected requirements REQ-010–REQ-014). The Bundle must hide the questionnaire structure. Only confirmed meanings are scored, de-identified, and eligible for team reporting. The existing conversation agent may reply normally to an employee-initiated message; that reply is a separate product flow.

The first attempted live wave was invalid for clean UX acceptance: an operator sent five manual invitations, and an expired V1 group state produced a confirmation reply. That V1 state had a 2026-09-30 cutoff but was confirmed on 2026-10-04. It is a defect to investigate separately; it is not V2 Bundle evidence. No V2 final insight or manager report was created from that wave.

## Clean baseline and limits

At the reset on 2026-10-04, a tenant- and roster-guarded production transaction deleted the five QA members' prior conversations, messages, memory, goals, style profiles, LLM-run records, survey windows and their derivatives, risk signals, activity projections, and pending backlog. A rollback rehearsal succeeded before commit. The committed reset removed 12 windows, 5 conversations containing 398 messages, 156 memory records, 36 goals, 5 style profiles, 196 LLM runs, and 14 risk signals. Post-reset checks returned zero for all 18 inspected person-scoped tables, including conversations, messages, windows, working insights, Bundles, final insights, and report snapshots. The five active Slack account links, survey consent, team roster, and tenant workspace connection were preserved.

Seven bot messages created during the invalid attempt (five manual invitations and two ensuing bot replies) were deleted from the five Slack DMs. Older Slack DM history remains visible: the bot token can delete its own messages, but cannot erase messages authored by QA participants. The application conversation runtime reads its PostgreSQL conversation store; that store is empty for all five people after reset. Do not treat old Slack UI history as evidence for this new run.

The active V2 definition `a9451b3d-5062-4c16-81b3-271f91ca8dea` has version `v2-policy-1.0.0`, 12 questions, and four groups. Scoring policy `027fd3c5-804f-4560-b0de-2429d463c20a` is version `1.0.0`. The immutable first cycle is `af104cdf-64ee-4d51-9ece-48110e5e359f`, 2026-10-04 13:30–17:30 UTC, with frozen five-person cohort `eb12c97a-b298-4694-918f-1d9a971bc504`. The clean logical start is the reset time, later than the cycle's technical start. At the user's request, successor cycle `08fe2300-042e-46c1-821c-fb6ddef73bb7` and cohort `4a8b471b-94a7-4528-aa2d-5feaf02138ac` were prepared for 2026-10-04 17:30 UTC through 2026-10-05 18:00 UTC (20:00 Warsaw). Production verification found the same approved scoring policy and exact same five-person roster, with no overlap and no successor windows before start. Messages and insights already bound to the first cycle stay there; QA must send new messages after the successor starts for that cycle's insights. Report inputs and snapshots must remain separate by cohort.

On 2026-10-06, after the successor cutoff, the user requested a new 48-hour cycle including the sixth QA member. Cycle `2131c5e7-a4b8-4d85-b354-bc0ed9119eef` and cohort `9b5d3697-229c-4243-9481-bd6f1456faec` were prepared for 2026-10-06 17:00 UTC through 2026-10-08 17:00 UTC (19:00 Warsaw on both dates). The cohort freezes six eligible members, including the one member added after the prior freeze. The user relayed that member's consent; the survey consent flag was set with an operator-attestation audit record. No participant-authored consent receipt was inspected. Production checks found policy `1.0.0`, a configured manager target, zero overlapping cohorts, and zero windows before start. The previous cycles' answers and report inputs remain separate. For this six-person cohort, the intermediate Autonomy report selector requires five distinct complete `3/3` contributors; delivery still requires the privacy and recipient checks below.

No automation, operator, or V2-specific script should send employee-facing Slack messages. The earlier `v2-live-pilot-monitor` heartbeat was read-only and scoped to the first two cohorts; it is not evidence for the new cohort. Do not enqueue manager reports until eligible confirmed inputs are checked and the employee-facing flow is verified. Before every connector smoke or payload, run the named production PostgreSQL/Redis `pnpm harness:preflight`.

The original five-person QA team is an explicitly quarantined legacy reporting fixture, as approved in the Company Hierarchy MVP reconciliation on 2026-09-27. All five belong to its frozen legacy roster; the new cohort freezes six legacy members. Only one of the original five also has a new-hierarchy Employee/placement row; do not interpret that as an incomplete pilot roster or manufacture customer employee IDs and work emails to cut over the others. The active manager Serhii 1 has a linked Slack account and the team has a configured DM. The pilot's manager-delivery check must verify the frozen legacy cohort, the approved target binding, the active hierarchy manager role, and anonymity threshold. Full migration of reporting membership to the new hierarchy remains a separate launch decision.

## Clean acceptance sequence

### Earlier five-person Autonomy-only scope

For this QA run, exercise and judge the live happy path for **Autonomy only** (A1 control over work, A2 voice and influence, A3 clarity of expectations). A participant reaches the pilot's employee scoring milestone only after all three Autonomy meanings are confirmed, scored under policy `1.0.0`, de-identified, and purged from temporary analytical storage. One ready or delivered Bundle alone does not meet that milestone. Growth, Purpose, and Belonging remain in the product definition but are not required to pass this narrowed live pilot.

The manager-delivery milestone remains a separate five-person check: all five frozen-roster members must each have a valid `3/3` Autonomy Index, then an eligible **intermediate Autonomy report** may be verified before the successor cycle ends at 2026-10-05 18:00 UTC. The approved final cycle report still requires all four eligible Index groups and is outside this narrowed pilot. After cutoff, an Autonomy-only intermediate report cannot be generated for this cycle; if the five-person gate has not been reached in time, record the report milestone as unverified and use a new cycle for that check. Do not treat the Autonomy-only pilot as full acceptance of IA-001–IA-047 or the other nine question paths; it covers A1–A3 and the associated privacy and reporting gates only.

| Stage | Action by QA / system | Evidence to inspect | Pass condition |
| --- | --- | --- | --- |
| 0. Baseline | No employee message yet | Five active linked accounts; zero per-person conversation/analytical rows; active 12-question definition and policy binding | No prior state can influence the run |
| 1. Natural start | Each of five QA members writes to the existing bot DM in their own words; operator sends no prompt | New inbound message, processing receipt, a new tenant/person/cycle-bound window, no V1 group state | V2 capture begins from normal conversation |
| 2. Private working capture | Members discuss real or controlled work examples across Autonomy's three topics | Three separate working rows for Autonomy, source-bound IDs, no manager-readable text | Temporary meanings are private and not reportable |
| 3. Confirmation | On a later natural turn, the agent presents one Index-level Bundle; the member agrees, corrects one part, declines, or stays silent as assigned | One in-dialogue outbound Bundle, component mapping, delivered receipt, verdict receipt | No standalone survey invitation and no exposed question numbers |
| 4. Scoring and privacy | Confirmed meaning passes the approved question rubric, then de-identification and purge | Question score `0–100`, `1.0.0` policy provenance, privacy decision, final de-identified row; empty private working content after finalization | No unconfirmed or identifying text enters reportable storage |
| 5. Intermediate report | Only after five distinct eligible `3/3` Autonomy contributors before cutoff | Dry-run candidate, contributor count, snapshot payload audit, manager binding, Slack receipt | Autonomy aggregate only; no names, quotes, or send below five |
| 6. Cutoff/final | Assess the first cycle after 2026-10-04 17:30 UTC and the successor after 2026-10-05 18:00 UTC, each plus the 15-minute settlement period | Autonomy cutoff/no-data rules, separate cohorts, and any eligible pre-cutoff intermediate snapshot | Exact half-open cutoffs, no cross-cycle mixing, no small-delta or duplicate send; four-Index final delivery stays outside this narrowed pilot |

For this narrowed run, cover the three approved Autonomy rubrics and the live happy path. Keep separate negative cases for partial acceptance, correction, full rejection, refusal, silence/cutoff, insufficient evidence, withdrawal, retry, and target change; these and the other nine question rubrics remain open unless separately observed. Map each observation to IA-001–IA-047 in `REQUIREMENT-TRACKER.md` without closing untested requirements; local CI and synthetic calibration remain supporting evidence, not substitutes for live Slack and deployed privacy acceptance.

The real QA members must author their own inbound DM messages and confirmations. The worker has no test user tokens and must not impersonate them. Record only tenant-scoped IDs, statuses, counts, policy versions, privacy-safe diagnostics, and Slack message IDs in acceptance evidence. Do not copy employee message bodies or credentials into reports.

## Operator dashboard

The PR adds a temporary, public `/pilot` page to the existing dashboard for
the approved Test AI Agent tenant and its exact two frozen QA cohorts. It uses
the existing `TENANT_ID`, `ADMIN_API_KEY`, and `INTERNAL_DASHBOARD_ENABLED`
server-side configuration. The read-only API returns per-cycle
capture and processing counts, statuses for all twelve defined topics,
Confirmation Bundle counts, finalization counts, and report delivery counts.
No employee text, name, ID, individual score, private summary, or report
payload is selected. The page is a QA progress view, not a manager report. A
manager report remains subject to the five-contributor gate and separate
delivery checks. Remove the public QA exception and add appropriate access
control before a customer launch. The updated API and dashboard were released
as a PR #7 branch trial on 2026-10-04. Both Railway deployments reached
`SUCCESS`; API readiness returned database and Redis `up`, and the public
`/pilot` page returned HTTP 200 with both separate cohorts and twelve topic
rows in each. It exposed only aggregate statuses and counts.

On 2026-10-07, the user approved a temporary public QA view of all six test
participants' individual records. `/pilot` and `/trends` now include the third,
six-person frozen cohort. Restored Team, Pulse Check, and per-participant pages
read only that exact cohort through an admin-key-guarded API route and show
linked display names, temporary working summaries while present, and current
final de-identified summaries and individual scores. The dashboard enables
these pages only with `QA_PRIVATE_VIEW_ENABLED=true`; its public Railway domain
then makes their content available to anyone with the URL without login.
Pages send `no-store` and `noindex, nofollow` while remaining accessible by URL.
Neither raw employee messages nor source-message IDs are selected. Finalization
still purges temporary summaries; this view does not change manager-report
eligibility or delivery. The QA exception must be disabled before onboarding
real employees or using this dashboard as a customer or manager surface.

The live QA conversation revealed that a complete V2 question group could
remain blocked before confirmation: Bundle selection required a delivered
reporting disclosure, while the ordinary V2 path did not offer one when a
group became ready. PR #7 commit `6840c36` adds a readiness-only check so the
next eligible normal reply includes the existing disclosure text. A later
participant turn may then present the Bundle after the disclosure has a
delivery receipt. CI and the scoped harness passed; worker trial deployment
`48f4a6b9` reached `SUCCESS`. The existing QA window and counts were preserved.
On 2026-10-04 the successor cohort recorded one delivered disclosure and one
subsequent delivered Bundle after two user-authorized connector turns. This
verifies the deployed delivery transition and processing receipts. The Bundle
still awaits a participant verdict, so scoring and privacy finalization remain
unverified. Connector-authored turns are technical path evidence; separate
participant-authored turns remain needed for clean natural-dialogue UX evidence.

## Three-per-day QA cadence deployed 2026-10-08

For the user's temporary six-person test, worker deployment
`052ada61-2e2c-48d3-b8f0-677204ed2b69` is `SUCCESS`, with the worker startup
observed. The Test AI Agent tenant policy now names the open frozen cohort
`9b5d3697-229c-4243-9481-bd6f1456faec` as `qaThreePerDayCohortId`;
the guarded activation updated one tenant row and readback confirmed the key,
six-person roster, and open period. Within that cohort,
the scheduler may send at most three proactive contacts in a rolling 24 hours,
at least four hours apart and at least two hours after the member's last inbound
message. It will not send another while a previous proactive contact remains
unanswered. Quiet-hours, active-user, linked-channel, and risk gates
remain in force. All other tenants retain their existing worker cadence. The
policy key is inert after cohort cutoff on 2026-10-08 17:00 UTC. API readiness
returned HTTP 200 with database and Redis `up` after deployment. No Railway
variable was changed and no manual check-in was sent; the natural scheduler
scans hourly. The separate first-contact backlog probe issue remains open.
