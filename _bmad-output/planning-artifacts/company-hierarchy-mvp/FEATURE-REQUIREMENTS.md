---
title: Company Hierarchy MVP — Feature Requirements
document_type: feature-requirements
status: ready-for-estimation
language: English
owner: Product and Engineering
created: 2026-09-25
source_product_requirements: _bmad-output/planning-artifacts/company-hierarchy-mvp/PRODUCT-REQUIREMENTS.md
source_spec: _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
baseline_commit: a189ed2
---

# Company Hierarchy MVP — Feature Requirements

## 1. Purpose

This document defines testable feature requirements for implementing the Company Hierarchy MVP. Requirement IDs are stable references for stories, acceptance tests, API contracts, migrations, and release verification.

## 2. Feature Set Overview

| Feature | Scope |
| --- | --- |
| F-01 Person and role registry | Tenant-scoped identity, primary role, capabilities, lifecycle |
| F-02 Team and Unit hierarchy | Stable organizational containers and ownership |
| F-03 HR, HRBP, and Leadership scopes | Parallel advisory and tenant-wide scopes |
| F-04 CSV provisioning | Append-only, person-centric, atomic import |
| F-05 Slack identity resolution | Email matching, manual resolution, uniqueness |
| F-06 Unit rollout | Readiness, activation, bot-initiated DM bootstrap |
| F-07 Hierarchy administration | Typed moves, promotions, replacements, deactivation |
| F-08 Audit and authorization | Company Admin and structured mutation history |

## 3. F-01 — Person and Role Registry

### FR-PER-001 — Create tenant-scoped Person

The system shall create a Person with internal UUID, tenant ID, customer employee ID, work email, display name, optional job title, primary role, Pulse participant value, and lifecycle status.

Traceability: PR-001, PR-002, PR-003, PR-004.

### FR-PER-002 — Enforce customer employee uniqueness

The system shall reject a Person whose normalized customer employee ID already exists in the same tenant. The same value may exist in a different tenant.

Traceability: PR-002.

### FR-PER-003 — Enforce one primary role

The system shall accept only `employee`, `team_lead`, `manager`, `hr`, `hrbp`, or `leadership` and shall persist exactly one value.

Traceability: PR-003.

### FR-PER-004 — Enforce MVP Pulse mapping

The system shall persist Pulse participation separately while enforcing `true` for Employee and Team Lead and `false` for Manager, HR, HRBP, and Leadership in MVP.

Traceability: PR-004.

### FR-PER-005 — Support Company Admin capability

The system shall grant or revoke `company_admin` independently of primary role and Pulse participation.

Traceability: PR-004, PR-035.

### FR-PER-006 — Support lifecycle states

The system shall support `draft`, `active`, and `inactive`. Newly imported Persons shall start as draft.

Traceability: PR-014.

### FR-PER-007 — Protect stable identity

Ordinary active-record editing shall not change internal Person ID or customer employee ID.

Traceability: PR-002.

### FR-PER-008 — Require Slack for Person activation

Person activation shall fail when no unique Slack account is linked.

Traceability: PR-016, PR-025, PR-026.

### FR-PER-009 — Exclude non-active Persons

Conversation, proactive, Pulse, delivery, and other active runtime selectors shall exclude draft and inactive Persons.

Traceability: PR-015.

## 4. F-02 — Team and Unit Hierarchy

### FR-ORG-001 — Create stable Unit

The system shall create a tenant-scoped Unit with internal ID, customer Unit key, name, lifecycle status, and Manager owner assignment.

Traceability: PR-006.

### FR-ORG-002 — Enforce Unit key uniqueness

Customer Unit key shall be unique within a tenant and immutable through ordinary active-record editing.

Traceability: PR-006, PR-023.

### FR-ORG-003 — Create stable Team

The system shall create a tenant-scoped Team with internal ID, customer Team key, name, lifecycle status, parent Unit, and Team Lead owner assignment.

Traceability: PR-005.

### FR-ORG-004 — Enforce Team key uniqueness

Customer Team key shall be unique within a tenant and immutable through ordinary active-record editing.

Traceability: PR-005, PR-023.

### FR-ORG-005 — Enforce one active Unit Manager

An active Unit shall have exactly one active Manager. An active Manager shall own exactly one active Unit.

Traceability: PR-006, PR-038.

### FR-ORG-006 — Enforce one active Team Lead

An active Team shall have exactly one active Team Lead. An active Team Lead shall own exactly one active Team.

Traceability: PR-005, PR-008, PR-038.

### FR-ORG-007 — Enforce Team parent

An active Team shall belong to exactly one active Unit. A Team shall never be active outside a Unit.

Traceability: PR-005, PR-009.

### FR-ORG-008 — Add Team Employee

The system shall assign an Employee to one Team and derive the Employee's Unit from that Team.

Traceability: PR-009, PR-010.

### FR-ORG-009 — Add direct Unit Employee

The system shall assign an Employee directly to one Unit without creating a Team membership.

Traceability: PR-007, PR-009, PR-010.

### FR-ORG-010 — Enforce single active placement

The system shall reject any operation that leaves an Employee in multiple active Teams, multiple active Units, or both Team and direct-Unit membership simultaneously.

Traceability: PR-009.

### FR-ORG-011 — Validate active Team minimum

Team activation shall require one active Team Lead, one active Employee, and one active parent Unit.

Traceability: PR-008, PR-016.

### FR-ORG-012 — Validate active Unit minimum

Unit activation shall require one active Manager and at least one active subordinate Person. The subordinate may be a direct Employee or belong to a Team.

Traceability: PR-007, PR-016.

### FR-ORG-013 — Allow Unit without Team

The system shall allow an active Unit containing a Manager and direct Employees with no Team records.

Traceability: PR-007.

### FR-ORG-014 — Derive line manager

The system shall derive immediate line management as follows: Team Employee to Team Lead, direct Unit Employee to Unit Manager, and Team Lead to Unit Manager.

Traceability: PR-010.

### FR-ORG-015 — Reject cross-tenant structure

Team, Unit, Person, membership, and owner references from different tenants shall fail before persistence.

Traceability: PR-001, PR-040.

## 5. F-03 — Leadership, HR, and HRBP Scopes

### FR-SCP-001 — Tenant-wide Leadership

The system shall allow multiple active Leadership Persons and derive all active Units as the scope of each.

Traceability: PR-011.

### FR-SCP-002 — No Leadership hierarchy

The MVP administration experience shall not offer parent Leadership, C-level reporting-line, or per-Leadership Unit assignment fields.

Traceability: PR-011.

### FR-SCP-003 — HR selected-Unit assignment

The system shall assign an HR Person to one or more selected Units through active many-to-many assignments.

Traceability: PR-012.

### FR-SCP-004 — HRBP scope mode

The system shall require each HRBP Person to use either `all_units` or `selected_units` scope mode.

Traceability: PR-013.

### FR-SCP-005 — HRBP selected assignments

For `selected_units`, the system shall require at least one active Unit assignment. For `all_units`, explicit assignments shall not restrict tenant-wide scope.

Traceability: PR-013.

### FR-SCP-006 — Allow overlapping advisory scope

The system shall allow multiple HR and HRBP Persons to be assigned to the same Unit.

Traceability: PR-012, PR-013.

### FR-SCP-007 — Keep advisory roles outside line management

HR and HRBP assignments shall not create Team membership, Unit membership, Team ownership, Unit ownership, or line-management relationships.

Traceability: PR-012, PR-013.

## 6. F-04 — CSV Provisioning

### FR-CSV-001 — Accept one person-centric file

The importer shall accept one CSV containing one Person per row.

Traceability: PR-019.

### FR-CSV-002 — Required base fields

Each row shall require customer employee ID, work email, display name, and primary role. Job title and Company Admin capability may be optional.

Traceability: PR-019, PR-023.

### FR-CSV-003 — Role-dependent fields

The importer shall require:

- Unit key for Employee, Team Lead, and Manager;
- Team key for Team Lead and Team Employee;
- no Team key for direct Unit Employee;
- selected Unit keys for HR;
- HRBP scope mode and selected Unit keys when applicable;
- no Unit key for Leadership.

Traceability: PR-019.

### FR-CSV-004 — Create draft hierarchy

A successful import shall create new Persons, Teams, Units, memberships, ownership, advisory scopes, and capabilities in draft.

Traceability: PR-019, PR-020.

### FR-CSV-005 — Enforce append-only behavior

The importer shall reject any row that attempts to redefine or mutate an existing Person. Existing Team and Unit keys may be referenced but not redefined inconsistently.

Traceability: PR-020, PR-024.

### FR-CSV-006 — Reject duplicate Person

The importer shall reject customer employee IDs duplicated within the file or already present in the tenant.

Traceability: PR-020, PR-021.

### FR-CSV-007 — Validate repeated structure keys

Repeated Unit or Team keys shall resolve to one entity. Name, parent, and owner declarations for the same key shall be consistent.

Traceability: PR-023.

### FR-CSV-008 — Reference existing structure

The importer shall allow a new Person row to reference an existing tenant-scoped Unit or Team key without including the existing owner as a new Person row.

Traceability: PR-024.

### FR-CSV-009 — Validate complete file before write

The importer shall parse and validate the entire file before creating any record.

Traceability: PR-021.

### FR-CSV-010 — Apply import atomically

All records from a valid file shall persist in one transaction. Any persistence failure shall roll back the complete import.

Traceability: PR-021.

### FR-CSV-011 — Return all detectable errors

The validation response shall include row number, field or entity key, error code, and human-readable explanation for every detectable error.

Traceability: PR-022, PR-043.

### FR-CSV-012 — Preserve active structure on failure

An invalid or failed import shall not change active or draft stored hierarchy.

Traceability: PR-021.

## 7. F-05 — Slack Identity Resolution

### FR-SLK-001 — Normalize work email

The system shall trim and lowercase work emails for matching while retaining an appropriate display value.

Traceability: PR-025.

### FR-SLK-002 — Match exact unique email

The system shall automatically link only when exactly one eligible Slack account has the same normalized work email.

Traceability: PR-025, PR-026.

### FR-SLK-003 — Reject display-name matching

The system shall not automatically link a Person by display name, preferred name, or fuzzy name similarity.

Traceability: PR-026.

### FR-SLK-004 — Represent missing and ambiguous states

The administration UI shall distinguish `missing_slack_match` from `ambiguous_slack_match` and keep the Person in draft.

Traceability: PR-026, PR-044.

### FR-SLK-005 — Manual link

Company Admin shall be able to select one currently unassigned Slack account from the tenant workspace and link it to the draft Person.

Traceability: PR-027.

### FR-SLK-006 — Unique Slack assignment

Manual or automatic linking shall fail if the Slack account is already linked to another Person.

Traceability: PR-028.

### FR-SLK-007 — Reuse provisioned identity on inbound

Slack ingestion shall resolve the linked Person before any create-user fallback and shall not create a duplicate Person.

Traceability: PR-029.

### FR-SLK-008 — Unlink Slack identity safely

Company Admin shall be able to unlink Slack identity from a draft or inactive Person. Unlinking an active Person shall require the Person to be deactivated in the same atomic operation; otherwise the operation shall fail.

Traceability: PR-016, PR-028, PR-036, PR-037.

## 8. F-06 — Unit Rollout

### FR-RLT-001 — Calculate readiness

The UI shall calculate `ready_for_rollout` for a draft Person only when Slack identity and all required structural assignments are valid.

Traceability: PR-030.

### FR-RLT-002 — Select rollout scope

Company Admin shall select one or more Units for rollout and see counts of ready, missing-Slack, structurally invalid, and already active Persons before confirmation.

Traceability: PR-031, PR-042.

### FR-RLT-003 — Activate ready Persons only

The rollout operation shall activate ready Persons and leave all non-ready Persons in draft with their pending assignments.

Traceability: PR-032.

### FR-RLT-004 — Preserve valid partial rollout

One missing Slack account shall not block otherwise valid Persons in the selected Unit from activation.

Traceability: PR-017, PR-032.

### FR-RLT-005 — Open or resume DM

For each activated Person, the system shall use the linked Slack identity to open or resume a direct-message channel.

Traceability: PR-033.

### FR-RLT-006 — Create conversation bootstrap

The system shall create the required product conversation records before enqueueing the first onboarding message.

Traceability: PR-033.

### FR-RLT-007 — Enqueue one onboarding message

The system shall enqueue no more than one logical initial onboarding message per Person rollout activation.

Traceability: PR-033.

### FR-RLT-008 — Track delivery separately

The system shall expose onboarding queued, delivered, failed, or retry-required state without changing the Person's organizational role or assignments.

Traceability: PR-034.

## 9. F-07 — Hierarchy Administration

### FR-ADM-001 — Show hierarchy tree

The administration surface shall show Units, Managers, direct Employees, Teams, Team Leads, Team Employees, lifecycle state, and Slack readiness.

Traceability: PR-042.

### FR-ADM-002 — Separate pending assignments

Pending assignments for draft Persons shall be visible but clearly excluded from active membership counts.

Traceability: PR-017, PR-044.

### FR-ADM-003 — Move Employee atomically

Moving an active Employee between Team and direct Unit membership, Teams, or Units shall end the old placement and create the new placement in one transaction.

Traceability: PR-036, PR-037.

### FR-ADM-004 — Promote Employee to Team Lead

Promotion shall validate the target Team, end incompatible Employee placement, update primary role and Pulse mapping, assign Team ownership, and commit atomically.

Traceability: PR-036, PR-037.

### FR-ADM-005 — Replace Team Lead

Replacement shall remove the previous Team Lead owner, assign one valid replacement, preserve Team identity, and never expose an ownerless active Team.

Traceability: PR-038.

### FR-ADM-006 — Replace Manager

Replacement shall remove the previous Manager owner, assign one valid replacement, preserve Unit identity, and never expose an ownerless active Unit.

Traceability: PR-038.

### FR-ADM-007 — Change advisor scope

The system shall atomically add or end HR/HRBP Unit assignments and validate the advisor's primary role.

Traceability: PR-036.

### FR-ADM-008 — Deactivate Employee

Employee deactivation shall end active placement and exclude the Person from new runtime activity without hard deletion.

Traceability: PR-018, PR-036.

### FR-ADM-009 — Protect Team Lead deactivation

The system shall reject standalone Team Lead deactivation while the Person owns an active Team. The caller must replace the owner or deactivate/reassign the Team in the same operation.

Traceability: PR-038.

### FR-ADM-010 — Protect Manager deactivation

The system shall reject standalone Manager deactivation while the Person owns an active Unit. The caller must replace the owner or deactivate/reassign the Unit in the same operation.

Traceability: PR-038.

### FR-ADM-011 — Protect final Leadership

The system shall reject deactivation of the final active Leadership Person while any active Unit exists.

Traceability: PR-039.

### FR-ADM-012 — Prohibit hard deletion

Customer-facing operations shall not hard-delete any previously active Person, Team, or Unit.

Traceability: PR-018.

### FR-ADM-013 — Use a customer-authorized administration surface

The customer hierarchy administration experience shall use customer-scoped authorization and shall not expose or relabel the existing internal development dashboard as the customer administration or reporting surface.

Traceability: PR-041, PR-045.

### FR-ADM-014 — Edit draft hierarchy

Company Admin shall be able to edit draft Persons, Teams, Units, ownership, memberships, advisory assignments, and capabilities, subject to tenant scope and draft validation rules.

Traceability: PR-014, PR-036.

### FR-ADM-015 — Promote eligible Person to Manager

Manager promotion shall validate the target Unit, end incompatible active placement or ownership, update primary role and Pulse mapping, assign Unit ownership, and commit atomically.

Traceability: PR-004, PR-036, PR-037, PR-038.

### FR-ADM-016 — Deactivate advisory or Leadership Person

HR or HRBP deactivation shall end active advisory assignments in the same transaction. Leadership deactivation shall preserve the final-Leadership invariant.

Traceability: PR-018, PR-036, PR-037, PR-039.

### FR-ADM-017 — Deactivate Team safely

Team deactivation shall atomically end its ownership and memberships and either reassign or deactivate affected Persons so no active Person is left with an invalid placement.

Traceability: PR-009, PR-018, PR-036, PR-037, PR-038.

### FR-ADM-018 — Deactivate Unit safely

Unit deactivation shall atomically reassign or deactivate its Teams, direct Employees, ownership, and advisory assignments so no active entity remains attached to an inactive Unit.

Traceability: PR-009, PR-012, PR-013, PR-018, PR-036, PR-037, PR-038.

## 10. F-08 — Audit and Authorization

### FR-AUD-001 — Authorize Company Admin

Customer hierarchy operations shall require an active Person with Company Admin capability in the same tenant.

Traceability: PR-035, PR-041.

### FR-AUD-002 — Prevent implicit data visibility

Company Admin authorization shall not satisfy authorization checks for employee conversations, Pulse evidence, insights, or reports.

Traceability: PR-035.

### FR-AUD-003 — Record successful mutations

Every successful import, activation, identity link, move, promotion, owner replacement, scope change, capability change, or deactivation shall create an audit event.

Traceability: PR-040.

### FR-AUD-004 — Record rejected mutations

Every rejected hierarchy mutation shall record actor, tenant, operation, target identifiers, and rejection reason without storing secrets or raw CSV content unnecessarily.

Traceability: PR-040.

### FR-AUD-005 — Capture structured before and after

Audit events for successful mutations shall include structured previous and resulting values sufficient to understand the organizational change.

Traceability: PR-040.

### FR-AUD-006 — Identify internal operator actions

Actions performed through temporary internal operational access shall be distinguishable from customer Company Admin actions.

Traceability: PR-041.

## 11. Cross-Feature Requirements

### FR-X-001 — Tenant isolation

All reads, writes, uniqueness checks, validation, and audit queries shall include tenant scope and fail closed on mismatch.

Traceability: PR-001, PR-040.

### FR-X-002 — Transactional integrity

CSV import, activation, moves, promotions, replacements, and deactivations shall use database transactions covering the full affected subgraph.

Traceability: PR-021, PR-037.

### FR-X-003 — TypeScript-only active path

Implementation shall remain in the active TypeScript API/application/worker/dashboard boundaries and shall not modify or invoke retired MAF or `agent-service` paths.

Traceability: PR-015; repository architecture constraint.

### FR-X-004 — Forward migration only

Schema changes shall use new forward migrations. Previously applied migrations shall not be rewritten.

Traceability: PR-005, PR-006; repository migration constraint.

### FR-X-005 — Existing Team migration plan

Before new hierarchy constraints are enabled, implementation shall define how current Team rows, member rows, and `managerSlackUserId` values are mapped or quarantined.

Traceability: PR-005, PR-006, PR-010.

### FR-X-006 — Draft runtime regression

Automated verification shall prove that draft Persons and pending assignments cannot enter active conversation, proactive, Pulse, or delivery queries.

Traceability: PR-015, PR-017.

## 12. Definition of Done

The feature set is ready for customer rollout only when:

- all Feature Requirements in the selected release slice have automated acceptance coverage;
- forward migrations and current-data backfill have been reviewed;
- tenant isolation and role/cardinality constraints pass database integration tests;
- CSV all-or-nothing behavior is proven;
- Slack matching and duplicate prevention are proven;
- Unit rollout sends at most one initial onboarding message per activated Person;
- failed hierarchy operations preserve the previous valid active structure;
- draft and inactive records are excluded from active runtime behavior;
- audit events exist for successful and rejected mutations;
- no retired MAF or `agent-service` surface is changed or invoked.
