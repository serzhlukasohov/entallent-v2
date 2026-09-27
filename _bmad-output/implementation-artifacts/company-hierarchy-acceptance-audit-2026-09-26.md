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
