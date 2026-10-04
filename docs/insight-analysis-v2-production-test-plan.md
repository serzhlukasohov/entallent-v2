# Insight Analysis V2 production test plan

Checked 2026-10-04. Target: Railway `reasonable-adaptation` / `production`, tenant `Test AI Agent` (`7d1e0163-6d53-4713-bd24-254690cc5090`). This is a controlled test tenant, but its Slack workspace has real reachable accounts.

## Prepared state and recipients

- The tenant has inactive definition `a9451b3d-5062-4c16-81b3-271f91ca8dea` (`v2-policy-1.0.0`) with all 12 approved questions. There is no open window or active scoring cycle.
- The frozen QA team has five active, linked, survey-enabled participants: Annna S, Ed, Roman, Serhii Lukashov, and Yjinia. Their employee conversation, Bundle, clarification, and confirmation messages belong in their respective bot DMs. No participant receives another participant's text or score.
- The QA team's manager report target is the existing bot DM `D0C5MUFTDG8`, verified for the active manager-role test account **Serhii 1**. He is outside the five-person roster. The prior DM target `D0BJDC2MPE2` was also valid, but belonged to participant Serhii Lukashov; it was replaced for future reports. Historical report snapshots keep their recorded target.
- A manager report may go only to Serhii 1 after the frozen-roster, contributor, privacy, target-recheck, and snapshot gates pass. The deployed V2 consumer is present but delivery remains disabled by its pending decision constant and unset tenant/version gates.

## Execution order

1. Obtain the separate Product approval for `v2-report-pilot-2026-10-04` in `_bmad-output/planning-artifacts/insight-analysis-v2/REPORTING-DECISION-PACKET.md`. After approval, set the reviewed decision ID in source and the tenant/version Railway gates, rerun CI, and release the worker code. Keep V2 out of the V1 group-state report path.
2. Recheck the deployed SHA and named PostgreSQL/Redis targets. Prepare a future cycle with the approved policy before its start; at the start activate the definition, then open the frozen cohort. Each participant's first live conversation creates the bound employee window. Recheck the roster and consent immediately before this step.
3. Confirm the five named participants are available to answer in their own bot DMs. Production has no `SLACK_TEST_*` user credentials, so bot-side scripts cannot supply employee confirmations; the manager snapshot requires five real eligible contributors.
4. First live wave: the five participants use their own bot DMs for the same Index. Check private capture, Bundle, confirmation, score provenance, de-identification, and purge per person. Only five complete eligible contributors may yield the first manager snapshot to Serhii 1.
5. Separate wave: exercise partial acceptance, clarification, refusal, silence/cutoff, insufficient evidence, withdrawal, retries, and target change. Verify suppression and absence of duplicate or small-delta manager sends. Run the four Index groups and final-cutoff cases as their policy gates become available.
6. Record tenant-scoped window IDs, queue/outbound receipts, privacy-safe database counts, snapshot status, and Slack message IDs. Do not copy employee message bodies or credentials into the acceptance report.

## Current stop point

PR #7 head `74fe4b4` passed both CI jobs. Production `api`, `worker`, and `dashboard` run the reviewed code from `1359a13`; the later PR commit changes documentation only. Migrations `0047`–`0050` are applied, the three services are `SUCCESS/RUNNING`, API health is `ok`, and dashboard `/trends` returns HTTP 200. Repeated synthetic calibration passed 42/42 approved examples, three unscored insufficient-evidence cases, and 12/12 ordered low/high pairs. The tenant still has one inactive 12-question V2 definition, five active survey-consented linked QA members, no unfinished window/cycle/cohort, and no V2 insight or snapshot rows. The configured manager DM resolved to the active linked manager without sending a message. The report rules remain pending; no employee or manager Slack message has been sent for this V2 cycle.
