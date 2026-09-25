---
id: SPEC-company-hierarchy-mvp
title: Company hierarchy and Slack rollout for MVP
type: product-contract
status: ready-for-implementation-planning
created: 2026-09-25
baseline_commit: a189ed2
---

# Company Hierarchy and Slack Rollout for MVP

## 1. Purpose

Define the minimum company hierarchy, provisioning, activation, and administration model required to roll enTalent out to companies of roughly 300–1,500 people while preserving a path toward larger organizations.

This contract covers organizational structure only. It intentionally does not define insight aggregation, privacy thresholds, report content, report delivery, onboarding dialogue, or employee consent. Those subjects require separate product contracts.

## 2. Current-Code Gap

At baseline `a189ed2`, the active TypeScript product has a team-only model:

- `users` represents a conversation-oriented user but has no organizational role or stable customer employee identifier.
- `teams.managerSlackUserId` stores a delivery address rather than a tenant-scoped manager identity.
- `team_memberships` supports one active `member` team but does not model Team Leads, Managers, Units, HR, HRBP, or Leadership.
- survey/reporting ownership is bound to a single Team.
- Slack ingestion creates users and conversations after an inbound message; there is no company-directory provisioning or outbound first-contact bootstrap.
- customer-facing company administration and role-scoped authorization do not exist; current admin access uses an internal API key.

The existing team schema must not be stretched by overloading `managerSlackUserId`, membership `role`, or Team names with the new hierarchy.

## 3. Product Vocabulary

### Person

A tenant-scoped human identity provisioned by the customer. Every Employee, Team Lead, Manager, HR, HRBP, Leadership member, and Company Admin is a Person even when they do not participate in Pulse.

### Primary organizational role

Exactly one of:

- `employee`
- `team_lead`
- `manager`
- `hr`
- `hrbp`
- `leadership`

Roles are mutually exclusive in MVP. Product capabilities and organizational scopes are modeled separately.

### Pulse participant

A separate boolean capability indicating whether the Person is eligible for employee conversation and Pulse behavior. MVP defaults are:

| Primary role | Default Pulse participant |
| --- | --- |
| Employee | Yes |
| Team Lead | Yes |
| Manager | No |
| HR | No |
| HRBP | No |
| Leadership | No |

The capability remains stored separately from role so future products may enable different behavior without rewriting the hierarchy. For MVP, the role-to-capability mapping above is enforced and is not customer-configurable.

### Team

A stable group of Employees led by one Team Lead. A Team retains its identity when its Team Lead changes.

### Unit

A stable organizational area owned by one Manager. A Unit contains:

- zero or more Teams;
- their Team Leads and Employees;
- zero or more Employees who report directly to the Unit Manager.

A Unit retains its identity when its Manager changes. `Unit` is an internal neutral term and does not claim to be the customer's Department, Business Unit, legal entity, or geography.

### Leadership scope

The tenant-wide root scope containing all active Units. Multiple Persons may have the Leadership role. All Leadership Persons have the same scope in MVP; CEO/CTO/CPO and similar labels are display titles only.

### HR and HRBP scope

HR and HRBP are advisory roles outside the line-management tree:

- HR is assigned to one or more Units.
- HRBP is assigned either to all Units in the tenant or to a selected set of Units.
- assignments may overlap.
- HRBP remains distinct from Leadership even with tenant-wide scope.

### Company Admin

A separate capability that may be assigned to any Person. It does not change primary role, Pulse participation, or report access.

## 4. Organizational Model

```text
Tenant-wide Leadership scope
└── Unit
    ├── Manager (Unit owner)
    ├── Direct Employee
    ├── Team
    │   ├── Team Lead (Team owner)
    │   └── Employee(s)
    └── Team
        ├── Team Lead
        └── Employee(s)

Parallel advisory scopes:
HR   ── assigned to selected Unit(s)
HRBP ── assigned to selected Unit(s) or all tenant Units
```

## 5. Source of Truth

Team and Unit assignments are the source of truth for line management. MVP must not add an independently editable `reportsToPersonId` that can contradict the containers.

Line management is derived as follows:

- an Employee in a Team reports to that Team's Team Lead;
- a direct Unit Employee reports to that Unit's Manager;
- a Team Lead reports to the Manager of the Unit containing the Team;
- a Manager belongs to the tenant-wide Leadership scope;
- HR and HRBP assignments do not create line-management relationships.

All hierarchy mutations must use typed application operations that update the complete affected relationship atomically. Direct table editing is not a supported product workflow.

## 6. Cardinality and Integrity Rules

### Person

- Every Person belongs to exactly one tenant.
- Every Person has exactly one primary organizational role.
- `customerEmployeeId` is required, immutable after activation through ordinary editing, and unique within the tenant.
- `workEmail` is required for MVP Slack matching and must be normalized for comparison.
- A Slack account may belong to at most one Person.

### Team

- `customerTeamKey` is required, stable, and unique within the tenant.
- An active Team belongs to exactly one active Unit.
- An active Team has exactly one active Team Lead.
- One active Team Lead owns exactly one active Team.
- An active Team contains at least one active Employee.
- Each active Employee belongs to at most one active Team.
- A Team Lead is not an Employee member of the Team they lead.
- Empty Teams are allowed only in draft.

### Unit

- `customerUnitKey` is required, stable, and unique within the tenant.
- An active Unit has exactly one active Manager.
- One active Manager owns exactly one active Unit.
- An active Unit contains at least one active subordinate Person.
- A Unit may have zero Teams and consist only of direct Employees under its Manager.
- A Team can never exist outside a Unit.
- Each active Employee and Team Lead belongs to exactly one active Unit.

### Leadership

- A tenant may have multiple active Leadership Persons.
- All active Leadership Persons have the same tenant-wide Unit scope.
- Units are not assigned to individual Leadership Persons in MVP.
- Leadership Persons do not report to one another in MVP.
- The final active Leadership Person cannot be deactivated while active Units remain.

### HR and HRBP

- HR-to-Unit and HRBP-to-Unit assignments are many-to-many.
- HR has selected-Unit scope only.
- HRBP has either `all_units` or `selected_units` scope mode.
- HR and HRBP are not Unit members and do not own Units.
- Scope assignment does not grant Company Admin capability or change Pulse participation.

### Tenant isolation

- Every Person, Team, Unit, assignment, import, activation, and audit event is tenant-scoped.
- Cross-tenant references fail closed.

## 7. Lifecycle

Hierarchy entities use:

```text
draft | active | inactive
```

### Draft

- May be structurally incomplete.
- Is visible in the rollout admin interface.
- Is ignored by conversation, Pulse, reporting, and delivery runtime paths.
- May retain pending Team, Unit, HR, and HRBP assignments.

### Active

- Passed synchronous role, ownership, membership, tenant, Slack-readiness, and cycle checks.
- Is available to active product runtime behavior.

### Inactive

- Is excluded from new runtime activity.
- Retains stable identity and audit history.
- Replaces hard deletion for formerly active records.

MVP does not require full organization-version objects, scheduled effective dates, approval chains, rollback UI, or historical reconstruction UI.

## 8. Slack Identity and Rollout

### Workspace installation

The Slack app is installed at workspace level. Individual employees do not install a separate copy of the bot.

### Identity linking

- CSV Persons are matched to Slack directory accounts by exact normalized work email.
- Display name must never be used for automatic identity matching.
- An absent or ambiguous match leaves the Person in draft.
- Company Admin may manually select a Slack account as a fallback.
- Inbound Slack activity must link to the existing Person rather than create a duplicate when a provisioned identity exists.

### Activation readiness

- Slack identity is required to activate a Person.
- Missing Slack identity does not prevent Person creation.
- A Person with valid structure and Slack identity is shown as `ready_for_rollout`; this is a derived UI state, not an additional lifecycle status.
- Pending draft Persons do not block activation of otherwise valid Team or Unit structures.
- Minimum active Team and Unit membership counts consider active Persons only.

### Batch rollout

Company Admin starts rollout for one or more Units:

1. Validate the selected active-ready Persons and hierarchy.
2. Activate all ready Persons in the selected Unit scope atomically at the domain boundary.
3. Leave Persons without Slack identity in draft with pending assignments.
4. Open or resume a Slack DM for each activated Person.
5. Create the product conversation and enqueue the first onboarding message.
6. Record per-Person onboarding delivery state separately from hierarchy lifecycle.

The first onboarding message is authorized by company rollout. Ongoing employee consent, Pulse consent, and onboarding dialogue are out of scope for this specification.

## 9. CSV Import Contract

### Semantics

- One CSV file, one Person per row.
- Import is append-only in MVP.
- It may create new Persons, Teams, Units, and assignments.
- It may reference existing Teams, Units, Managers, and Team Leads by stable keys/IDs.
- It may not update, move, deactivate, or rename existing records.
- Duplicate existing `customerEmployeeId`, conflicting stable keys, or any other validation error rejects the entire file.
- No rows are persisted until the complete file validates.
- A valid file is applied atomically and creates draft records.

### Minimum columns

| Column | Required | Notes |
| --- | --- | --- |
| `customerEmployeeId` | Yes | Unique tenant-scoped Person key |
| `workEmail` | Yes | Used for exact Slack matching |
| `displayName` | Yes | Display value only |
| `jobTitle` | No | Does not control permissions |
| `primaryRole` | Yes | One allowed role enum |
| `customerUnitKey` | Role-dependent | Required for Employee, Team Lead, and Manager |
| `unitName` | When creating Unit | Must be consistent for repeated key |
| `customerTeamKey` | Role-dependent | Required for Team Lead and Team Employee; blank for direct Unit Employee |
| `teamName` | When creating Team | Must be consistent for repeated key |
| `assignedUnitKeys` | HR/HRBP only | Delimited stable Unit keys |
| `hrbpScopeMode` | HRBP only | `all_units` or `selected_units` |
| `companyAdmin` | No | Boolean capability |

### Role-specific interpretation

- `employee`: Unit required; Team optional. Empty Team means direct Unit Employee.
- `team_lead`: Unit and Team required; Person becomes draft Team owner.
- `manager`: Unit required; Person becomes draft Unit owner.
- `hr`: one or more selected Unit keys required.
- `hrbp`: `all_units` or one or more selected Unit keys required.
- `leadership`: no Unit assignment; scope is tenant-wide.

`pulseParticipant` is derived from `primaryRole` during MVP import. It is persisted as a separate capability but is not an editable CSV field in this release.

Repeated Team or Unit keys create only one entity. Names, owners, tenant, and parent relationships must be consistent across all rows.

### Import errors

The UI returns all detectable row-level and cross-row errors in one response, including:

- duplicate Person in the file;
- Person already exists;
- duplicate or conflicting Team/Unit key;
- unknown referenced existing key;
- invalid role or role-specific columns;
- multiple Team Leads for one Team;
- multiple Managers for one Unit;
- Person assigned to multiple Teams or Units;
- cross-tenant reference;
- malformed or duplicate work email;
- contradictory Pulse capability value.

## 10. Administration and Authorization

### Company Admin capability

Company Admin may:

- import new draft hierarchy data;
- view validation errors and Slack-link readiness;
- manually resolve Slack identity;
- create and edit draft Persons, Teams, Units, and assignments;
- activate Unit bundles and start rollout;
- execute typed moves, promotions, replacements, and deactivations.

Company Admin capability alone does not grant access to employee insights, Pulse evidence, or future reports.

### Internal access

The existing shared `ADMIN_API_KEY` may remain as a temporary internal/operator mechanism but is not the customer authorization model for hierarchy administration.

### Audit

Every hierarchy mutation records:

- tenant;
- actor Person or internal operator identity;
- operation type;
- affected entity IDs;
- previous structured values;
- resulting structured values;
- timestamp;
- success or rejection reason.

## 11. Typed Hierarchy Operations

Free-form editing of active ownership and role fields is prohibited. Required domain operations include:

- create draft Person/Team/Unit;
- append-only CSV import;
- link or unlink Slack identity;
- activate Unit rollout bundle;
- move Employee between Team and direct Unit membership;
- move Employee between Teams or Units;
- promote Employee to Team Lead;
- replace Team Lead;
- promote eligible Person to Manager;
- replace Unit Manager;
- change HR/HRBP Unit assignments;
- grant or revoke Company Admin;
- deactivate Person, Team, or Unit.

Each operation validates the complete affected subgraph and commits all changes in one database transaction.

### Deactivation rules

- Employee: end active membership and mark inactive.
- Team Lead: replace the Team Lead atomically, or deactivate/reassign the Team and its Employees.
- Manager: replace the Unit Manager atomically, or deactivate/reassign the Unit structure.
- HR/HRBP: end active Unit assignments.
- Leadership: reject removal of the final active Leadership Person while active Units remain.
- Hard deletion of any previously active Person, Team, or Unit is prohibited.

## 12. Recommended Persistence Shape

Exact table names remain an architecture decision, but the implementation must preserve these boundaries:

```text
people / users
- id
- tenant_id
- customer_employee_id
- work_email
- display_name
- job_title
- primary_role
- pulse_participant
- lifecycle_status

person_capabilities
- person_id
- capability                  // company_admin
- status

units
- id
- tenant_id
- customer_unit_key
- name
- manager_person_id
- lifecycle_status

teams
- id
- tenant_id
- customer_team_key
- unit_id
- name
- team_lead_person_id
- lifecycle_status

team_memberships
- team_id
- employee_person_id
- lifecycle_status

unit_direct_memberships
- unit_id
- employee_person_id
- lifecycle_status

unit_advisor_assignments
- unit_id
- advisor_person_id           // HR or selected-scope HRBP
- advisor_role
- lifecycle_status

hrbp_scopes
- hrbp_person_id
- scope_mode                  // all_units | selected_units
```

Tenant-consistent composite keys or equivalent application checks are required. New forward migrations must be used; existing applied migrations must not be rewritten.

## 13. Compatibility Requirements

- Active conversation and proactive runtime remain TypeScript-only.
- Retired MAF/`agent-service` paths must not be modified or re-enabled.
- Existing `teams.managerSlackUserId` must not remain the authoritative organizational owner after migration.
- Channel identity remains in `channel_accounts`; organizational relationships must reference Person IDs, not Slack IDs.
- Existing Team data requires an explicit migration/backfill plan before new constraints become mandatory.
- Draft entities must not leak into current conversation, Pulse, admin analytics, or delivery queries.
- The existing development dashboard must not be presented as the customer hierarchy or reporting surface.

## 14. Acceptance Criteria

### Identity and roles

- A tenant can create Persons for all six roles with one primary role each.
- Company Admin and Pulse participation can change independently of primary role.
- Duplicate tenant/customer employee IDs fail.
- Cross-tenant identity or assignment attempts fail closed.

### Team and Unit integrity

- A Team remains the same entity after Team Lead replacement.
- A Unit remains the same entity after Manager replacement.
- A direct Unit Employee can be active without Team membership.
- An active Team cannot exist without one active Team Lead, one active Employee, and one active Unit.
- An active Unit cannot exist without one active Manager and one active subordinate.
- A Unit with direct Employees and no Teams is valid.
- Multiple active Team/Unit ownership and multiple active Employee placements are rejected.

### Draft and activation

- Incomplete imports remain draft and are ignored by runtime queries.
- Persons without Slack identity remain draft and visible as missing Slack.
- Pending draft Persons do not block rollout of ready colleagues.
- Unit rollout activates only valid, Slack-linked Persons and preserves pending assignments for the rest.

### CSV

- A valid person-centric CSV creates the intended draft hierarchy atomically.
- Any duplicate or validation error leaves the database unchanged and returns all detected errors.
- A later append CSV may add new Persons and reference existing Unit/Team keys.
- A CSV cannot mutate an existing Person, Team, Unit, role, or assignment.

### Slack rollout

- Exact normalized work email links one Slack account to one Person.
- Missing or ambiguous matching requires manual resolution.
- Batch rollout opens/resumes DM and enqueues onboarding without requiring employee-first contact.
- An inbound event from a provisioned Slack account does not create a duplicate Person.

### Changes and deactivation

- Promotions, moves, and owner replacements are atomic.
- Failed validation leaves the previous active hierarchy unchanged.
- Deactivation cannot orphan an active Team or Unit.
- Every successful or rejected mutation produces an audit record.

## 15. Explicit Non-Goals

- Insight collection, confirmation, correction, withdrawal, or aggregation semantics.
- Team, Unit, HR, HRBP, or Leadership report content.
- Report privacy/inference policy and subtraction-attack controls.
- Customer-facing report UI.
- Employee onboarding dialogue and ongoing consent policy.
- Matrix or dotted-line reporting.
- Multiple active Teams or Units per Employee.
- Department, Business Unit, legal entity, or geography hierarchy.
- Hierarchy below or above the fixed Employee/Team Lead/Manager/Leadership levels.
- HRIS, SCIM, or public provisioning API.
- CSV updates, deletes, moves, or full-snapshot synchronization.
- Scheduled changes, temporary delegation, approval workflows, or rollback UI.
- Full historical hierarchy reconstruction.

## 16. Implementation Slicing

Recommended order:

1. Person identity, roles, capabilities, and lifecycle schema.
2. Stable Unit/Team schema and integrity constraints.
3. Typed draft and active hierarchy operations.
4. Append-only atomic CSV parser/importer and validation report.
5. Company Admin API and rollout UI.
6. Slack directory matching and manual resolution.
7. Unit batch activation and outbound onboarding bootstrap.
8. Migration/backfill from current Team and `managerSlackUserId` data.
9. Runtime guards proving draft/non-participant identities are excluded.

Before implementation begins, architecture must define the forward-migration/backfill strategy and the authorization mechanism replacing customer use of the shared admin key.
