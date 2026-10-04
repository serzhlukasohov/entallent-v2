# Insight Analysis V2 production test plan

Checked 2026-10-04. Target: Railway `reasonable-adaptation` / `production`, tenant `Test AI Agent` (`7d1e0163-6d53-4713-bd24-254690cc5090`). This is a controlled test tenant, but its Slack workspace has real reachable accounts.

## Prepared state and recipients

- The tenant has inactive definition `a9451b3d-5062-4c16-81b3-271f91ca8dea` (`v2-policy-1.0.0`) with all 12 approved questions. There is no open window or active scoring cycle.
- The frozen QA team has five active, linked, survey-enabled participants: Annna S, Ed, Roman, Serhii Lukashov, and Yjinia. Their employee conversation, Bundle, clarification, and confirmation messages belong in their respective bot DMs. No participant receives another participant's text or score.
- The QA team's manager report target is the existing bot DM `D0C5MUFTDG8`, verified for the active manager-role test account **Serhii 1**. He is outside the five-person roster. The prior DM target `D0BJDC2MPE2` was also valid, but belonged to participant Serhii Lukashov; it was replaced for future reports. Historical report snapshots keep their recorded target.
- A manager report may go only to Serhii 1 after the frozen-roster, contributor, privacy, target-recheck, and snapshot gates pass. No V2 report is currently deliverable: the V2 report consumer is not implemented.

## Execution order

1. Finish the Product decisions in `_bmad-output/planning-artifacts/insight-analysis-v2/REPORTING-DECISION-PACKET.md`: complete Index formula, partial final aggregation, calibration acceptance, and report disclosure rules. Implement the V2 enqueue/consumer and its threshold, snapshot, and delivery checks. Keep V2 out of the V1 group-state report path.
2. Verify the approved policy fixture, isolated database/Redis tests, full harness, and PR CI. Release the reviewed code through the repository's normal `main` auto-deploy path. Confirm the deployed commit and readiness separately for API, worker, and dashboard.
3. Recheck the five participant accounts, manager DM, consent, workspace binding, roster, and lack of overlapping windows. Prepare a future cycle with the approved policy before its start; open the cohort and five employee windows only after the deployment and calibration gates pass.
4. First live wave: the five participants use their own bot DMs for the same Index. Check private capture, Bundle, confirmation, score provenance, de-identification, and purge per person. Only five complete eligible contributors may yield the first manager snapshot to Serhii 1.
5. Separate wave: exercise partial acceptance, clarification, refusal, silence/cutoff, insufficient evidence, withdrawal, retries, and target change. Verify suppression and absence of duplicate or small-delta manager sends. Run the four Index groups and final-cutoff cases as their policy gates become available.
6. Record tenant-scoped window IDs, queue/outbound receipts, privacy-safe database counts, snapshot status, and Slack message IDs. Do not copy employee message bodies or credentials into the acceptance report.

## Current stop point

At this check, PR #7 head `28e5df0` passed both CI jobs, while the latest successful production API, worker, and dashboard deployments still ran the older `7be2b86` branch trial. The V2 report consumer and approved report/calibration decisions are absent. Keep the definition inactive; do not open a cycle or send employee or manager messages until the gates above are met.
