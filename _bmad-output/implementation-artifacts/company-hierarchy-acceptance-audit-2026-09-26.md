---
title: Company Hierarchy MVP - Acceptance Evidence Audit
document_type: acceptance-audit
status: in-progress
source_spec: _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
date: 2026-09-26
---

# Company Hierarchy MVP acceptance evidence

This audits the six acceptance groups in SPEC section 14 against the current branch. "Local" means automated checks against synthetic data; it does not certify customer rollout. The BMAD implementation-readiness workflow is a pre-implementation PRD/architecture/epic check, so the existing SPEC and feature requirements are used here as the traceability baseline for post-implementation acceptance.

| SPEC acceptance group | Current evidence | Status / missing proof |
| --- | --- | --- |
| Identity and roles | `people.integration.test.ts` checks tenant identity and role/Pulse constraint. `hierarchy-csv.integration.test.ts` imports all six roles. Capability and OIDC session tests cover independent admin grant/revocation; capability audit stores structured before/after values. | Local coverage. Verify customer IdP subject binding and Company Admin permissions through a real HTTPS browser session. |
| Team and Unit integrity | `organization.integration.test.ts` checks parent placement, direct Employees, owner/key uniqueness. `hierarchy-mutation.integration.test.ts` checks rejected and successful owner changes in migrated PostgreSQL. | Local coverage for key cases. Customer legacy mapping and resulting active graph have not been reviewed. |
| Draft and activation | `hierarchy-rollout.integration.test.ts` checks multi-Unit atomicity, pending Persons, shared scope deduplication, and retry. Runtime eligibility tests cover draft/inactive/non-Pulse exclusion. | Local coverage. Verify the actual customer setup preview and rollout after migration and Slack linking. |
| CSV | `hierarchy-csv.integration.test.ts` checks six roles, later append, collected errors, zero writes on rejection, and transaction rollback. | Local coverage. Verify browser upload and tenant isolation with the real Company Admin session. |
| Slack rollout | Slack matching and inbound reuse have focused tests. `onboarding-flow.integration.test.ts` crosses PostgreSQL and BullMQ with mocked Slack and verifies one persisted first contact on retry. `onboarding-reconciliation.integration.test.ts` preserves uncertain sends. Rollout and link/unlink audit now include affected IDs and structured before/after states. | Real Slack directory scope, DM delivery, receipt, inbound reuse, and an uncertain-send reconciliation need live acceptance. |
| Changes and deactivation | `active-graph.test.ts`, mutation service/controller/UI tests, and `hierarchy-mutation.integration.test.ts` cover explicit previous-owner actions, rejected replacement preserving the graph, and PostgreSQL audit rows for rejected and successful owner changes. Success audits include structured before/after states for owner replacement and deactivation; invalid Unit selection reaches the rejected rollout audit. See the criterion-level review below. | Local coverage for the listed operations. Exercise representative customer UI flows and inspect audit rows in the target environment. |

### Changes and deactivation: criterion-level review

| SPEC criterion | Current branch evidence | Evidence limit |
| --- | --- | --- |
| Promotions, moves, and owner replacements are atomic | `HierarchyMutationService` runs Manager and Team Lead promotions and Employee moves in serializable transactions; its service tests cover successful operations and orphan rejection. `hierarchy-mutation.integration.test.ts` checks owner replacement against migrated PostgreSQL. The setup controller exposes typed endpoints and the setup UI requires an explicit previous-owner action. | The PostgreSQL test exercises owner replacement, not every move and promotion variant. Customer browser flow has not run. |
| Failed validation leaves the previous active hierarchy unchanged | `planManagerPromotion`, `planTeamLeadPromotion`, and `planEmployeeMove` validate the affected active graph before writes. Service tests cover rejected moves and promotions; the PostgreSQL test checks an invalid replacement rollback. | Concurrent customer edits and all UI error paths have not been exercised in the target environment. |
| Deactivation cannot orphan an active Team or Unit | `HierarchyDeactivationService` validates active Person, Team, and Unit transitions in serializable transactions. Its tests cover the final Team Employee, owner replacement requirement, final Leadership Person, Team deactivation, and Unit transfer. | These are local service tests; a customer graph and browser deactivation have not been checked. |
| Every successful or rejected mutation produces an audit record | Draft, advisor scope, capability, Slack link, rollout, typed mutation, and deactivation services write success audits inside their transactions and rejected audits after rollback. Focused tests check owner-change audit rows, invalid rollout selection, capability changes, and Slack linking. | Source inspection and selected tests establish the service-level pattern, not an exhaustive database assertion for every route. Requests rejected by session/CSRF or controller payload validation before calling a mutation service are outside this service-level audit evidence; the product contract should clarify whether they require a separate access-attempt audit. |

## Explicit owner replacement decision

The prior Team Lead or Manager must be explicitly changed to Employee in the same Team/Unit or deactivated. The request cannot omit this choice; a failed graph validation leaves the prior owner in place. The replacement keeps the Team/Unit ID. Deactivation cancels pending or failed onboarding intents in the same transaction. An in-flight `sending` intent remains subject to receipt reconciliation.

## Release path

1. Identify the intended customer tenant UUID, the database environment containing legacy Teams, and the corporate IdP. Run the read-only tenant report from `LEGACY-RECONCILIATION.md`; do not infer Unit/Team owners from Slack IDs.
2. Review and approve every legacy Team mapping, run the dry-run manifest, apply draft backfill against the identified tenant, and reconcile counts. Preserve historical reporting cohorts.
3. Configure the OIDC application and bootstrap the first Company Admin. Verify login, session revocation, setup UI, CSV preview/import, and tenant authorization in a real HTTPS browser.
4. Verify Slack app email scope, exact identity matching, Unit batch rollout, one first-contact message per activated Person, queue receipt, and inbound identity reuse on the target environment. Reconcile uncertain `sending` rows before any resend.
5. Cut over organizational ownership reads only after tenant reconciliation. The 2026-09-27 product decision keeps prior survey/report recipients until the separate reporting launch. Preserve historical cohorts and report destinations, then run affected regression checks and the full harness after code changes.

The focused owner replacement PostgreSQL test passed on the isolated `entalent_hierarchy_acceptance` database on 2026-09-26. This validates those owner operations, not all mutation routes.

On 2026-09-27, a concurrent run of six Company Hierarchy PostgreSQL integration files exposed `40001` serialization aborts in two transactions. A bounded retry now wraps all 16 serializable hierarchy transactions, with no external side effects inside the retry callback. The parallel six-file run, focused retry/audit tests, and API typecheck passed after the change. This strengthens concurrent local acceptance; it does not verify customer-scale contention.

The existing confirmation deidentification path previously saw only legacy reporting Team identifiers. It now obtains current active Unit/Team, scoped Person, and linked Slack identifiers independently of the legacy report lookup. A PostgreSQL integration test verifies Team and direct Unit scope, tenant isolation, and unchanged legacy report membership; the conversation orchestration test verifies a current Unit name blocks an unsafe confirmation when no legacy Team exists. This preserves the existing policy and report-recipient decision.

The read-only legacy report accepts a fully pre-migration schema with `schemaReady: false`, fails on partial hierarchy schema, and rejects an unknown tenant. Production aggregate inspection found four tenant records and one legacy Team with five active memberships. After the user granted access and confirmed `Test AI Agent` as the target, the restricted production report was exported to `/private/tmp/entalent-legacy-hierarchy-production-2026-09-27.json` (mode `0600`). The user classified its only Team, `QA Grill Verification 2026-09-08`, as a test fixture to remain in the legacy path. The backfill manifest supports explicit quarantine classification, rejects missing/duplicate/unknown classifications, and keeps the source fingerprint gate. Production migrations `0018`–`0025` were applied; the post-migration report matched the source fingerprint and the confirmed quarantine apply wrote an audit row with zero new Units, Teams, or placements. No hierarchy cutover has run.

The OIDC token exchange form-encodes the client ID and secret before HTTP Basic authentication, including secrets with spaces, punctuation, or non-ASCII characters. Discovery fails early when a provider explicitly advertises token endpoint methods without `client_secret_basic`; the operator setup instructions name that requirement. Focused flow/verifier tests and API typecheck passed locally. The connected EU Auth0 issuer advertises `client_secret_basic` and PKCE S256. Its dedicated Regular Web Application has the exact API callback and only the authorization-code grant; the database connection is enabled and Google social development keys are excluded from this application. No application user or subject binding exists yet. The deployed API still returns 404 at the callback route, so HTTPS login remains unverified.

No customer hierarchy rows, current Team read-path cutover, real OIDC login, or live Slack delivery has been claimed by this audit.

## Branch deployment for production verification (2026-09-27)

The feature commit `2153d15` and the current `main` Pulse fix were combined as `921a825` on `origin/codex/company-hierarchy-mvp-grill`; `main` remained at `030bc467`. The clean checkout at `921a825` passed typecheck, API and worker tests, build, eight targeted PostgreSQL integration scenarios, and full harness receipt `runs/harness/receipt-1790525561147-9a053631.json`. The CAP-8 SQL test was not run because its separate `*_test` database was unavailable.

The operator manually uploaded that exact checkout to Railway project `reasonable-adaptation`, environment `production`, with CLI messages naming the branch and SHA. API deployment `dfe48f43-e01f-4929-ba47-f595b4045590` and worker deployment `a1a4f533-9c90-4ea5-a4b0-69e752a7d673` both reached `SUCCESS`. API `/api/v1/health` and `/api/v1/company-setup/ui?tenantId=7d1e0163-6d53-4713-bd24-254690cc5090` returned HTTP 200. `/api/v1/company-auth/callback` returned HTTP 401 without an OIDC state cookie, as expected for a direct unauthenticated request; before this deployment it returned 404. No `dashboard` or retired `agent-service` deployment was triggered. The GitHub service source still tracks `main`, so a later push to `main` may replace these manually uploaded images.

This verifies deployment and route availability only. First Company Admin Person creation, exact Auth0 `sub` binding, browser sign-in, CSV/UI flows, Unit rollout, live Slack delivery, and production audit checks remain open.

## First Company Admin bootstrap (2026-09-27)

The EU Auth0 tenant had no application user for the designated operator email. A database-connection user was created with a generated temporary password that was not printed or stored. The resulting Auth0 `sub` was bound to a new draft, non-Pulse leadership Person in tenant `Test AI Agent` by the one-time bootstrap script. The script committed the encrypted OIDC provider configuration, exact subject binding, active `company_admin` capability, and audit event atomically. Production readback returned one matching draft Person, provider, subject, and capability. A direct start request returned HTTP 302 to the expected EU Auth0 issuer with an OIDC state cookie and PKCE S256. Auth0 accepted a password-reset email request and logged `scpr`; delivery, password setup, and human browser login remain unverified.

No Unit/Team activation or Slack delivery occurred in this bootstrap. The operator must complete password setup and personal Auth0 sign-in before browser session and setup UI acceptance can be recorded.

## First Company Admin browser sign-in (2026-09-27)

The operator completed the password reset and signed in through the EU Auth0 application. Auth0 readback showed `email_verified=true`, `logins_count=1`, and `last_login=2026-09-27T17:11:27.054Z`. The user-owned Chrome tab displayed `/api/v1/company-setup/ui` with the exact target tenant and bootstrapped Admin Person, the setup forms, and `1 Persons · 0 Units · 0 Teams`. Production PostgreSQL contained one unexpired, non-revoked Company Admin session for that tenant/Person, created at `2026-09-27 17:11:27.841637+00`. This accepts the first browser login and setup read path; it does not accept any setup write operation or Unit rollout.

The setup page listed Slack workspace `T09GT50ADC5` as active but displayed `Needs users:read.email` for email matching. Verify the Slack app scopes and reauthorization before claiming automatic identity matching. No Slack message was sent in this check.

## Slack scope metadata and browser CSV preview (2026-09-27)

Production harness preflight reached the named PostgreSQL and Redis targets (`runs/harness/receipt-1790530984061-4d3c2e0b.json`). The encrypted bot token in the active `T09GT50ADC5` connection passed Slack `auth.test` for that exact workspace and advertised `users:read.email`; only the connection's stored scope list was stale. An operator reconciliation updated the stored list from the token response and wrote an audit row with before/after scopes. After refreshing the user-owned setup page, email matching displayed `Ready`. No Slack app scope change or reinstallation was needed.

An authenticated browser CSV preview with three fictional `example.invalid` Persons (Manager, Team Lead, Employee), one Unit, and one Team returned `Preview passed` and `3 rows ready to import`. The fixture was removed from the form without importing. Production readback remained one Person, zero Units, zero Teams, and one scope-reconciliation audit event. This accepts the browser preview and scope display, not CSV persistence, Slack identity linking, Unit activation, or message delivery.

## Existing User adoption and test roster (2026-09-27)

The designated Employee `janepetsko993@gmail.com` resolves to active Slack user `U0BJMPNQ9L5`, already linked to User `f2fbc6dd-0d71-4918-bec5-7ad2196c3ac1`. That User has one conversation, 102 messages, and one membership in the quarantined legacy QA Team. Creating a fresh setup Person would conflict with the existing account; attaching a draft Person to the active User in a separate commit would temporarily make the conversation runtime ineligible. The approved fix adds an internal-operator adoption within the serializable Unit rollout, with exact Slack email, account owner, tenant, role, graph, and audit checks. A migrated PostgreSQL test verifies rollback leaves the User eligible and successful activation keeps ID, history, legacy membership, and one onboarding intent.

The invited Manager `lukashovserhii3@gmail.com` is an active Slack user `U0C4VG5PK09` with no prior account or conversation. Authenticated setup created and email-linked draft Manager `e26e83bf-be1d-43e2-8156-3850b54bcd96`, then draft Unit `4f0281d9-a4ce-4564-bca8-56c1cc4c4388` (`qa-pilot-20260927`, `QA Pilot 2026-09-27`). There is no new Team; the old QA Team remains quarantined. The operator dry-run found one exact Employee Slack email match, original history counts of 1/102, and the selected Manager link. Full graph validation and real first-contact receipts remain unverified until apply. Rollout will create first-contact intents for both Manager and Employee; the user selected the existing AI proactive check-in behavior.

The confirmed operator apply activated exactly those two Persons and the Unit, with no Teams or graph issues. The original Company Admin remained pending because their Slack account is not linked. Readback found one direct active Employee placement, the original Employee User ID and linked Slack account, one conversation, 102 messages, one legacy QA membership, and one each of `org.person.adopt_legacy` and `org.unit.rollout` audit events. Both first-contact intents were pending with zero attempts at initial readback. The normal worker proactive scan ran at 18:00 UTC and is scheduled hourly, so a scoped `onboarding-only` worker job was added for prompt acceptance. Its local PostgreSQL/BullMQ and processor tests pass; production delivery receipts are still open.
