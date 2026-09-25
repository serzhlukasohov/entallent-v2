---
title: Company Hierarchy MVP — Product Requirements
document_type: product-requirements
status: approved-for-planning
language: English
owner: Product
created: 2026-09-25
source_business_requirements: _bmad-output/planning-artifacts/company-hierarchy-mvp/BUSINESS-REQUIREMENTS.md
source_spec: _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
baseline_commit: a189ed2
---

# Company Hierarchy MVP — Product Requirements

## 1. Purpose

This document translates the Company Hierarchy MVP business outcomes into product behavior. It defines actors, domain concepts, lifecycle, setup, Slack identity linking, rollout, and hierarchy administration.

## 2. Product Principles

### PP-001 — Person before channel

Organizational identity belongs to a tenant-scoped Person. Slack is a linked communication channel, not the source of organizational truth.

### PP-002 — Containers define line management

Team and Unit placement define line-management relationships. The product must not maintain a separately editable manager pointer that can disagree with Team or Unit assignments.

### PP-003 — Configuration does not equal activation

Provisioning a Person or discovering their Slack identity must not start agent interaction. Rollout is an explicit Company Admin action.

### PP-004 — Active runtime is fail-closed

Draft, inactive, invalid, cross-tenant, or ambiguously linked identities must not enter active runtime behavior.

### PP-005 — Stable identity across change

Role, owner, name, or Slack changes must not replace the stable identity of a Person, Team, or Unit.

## 3. Product Actors

| Actor | Product definition |
| --- | --- |
| Employee | Individual contributor in one Team or directly in one Unit |
| Team Lead | Owner of exactly one active Team and a Pulse participant in MVP |
| Manager | Owner of exactly one active Unit |
| HR | Advisor assigned to selected Units |
| HRBP | Advisor assigned to selected Units or the whole tenant |
| Leadership | Tenant-wide root role with scope over all Units |
| Company Admin | Capability holder who configures and activates hierarchy |
| Internal Operator | enTalent support identity using internal operational access |

## 4. Product Domain Requirements

### PR-001 — Tenant-scoped Person

The product shall represent every customer user as a Person belonging to exactly one tenant. This includes non-Pulse roles such as Manager, HR, HRBP, and Leadership. Supports BR-001, BR-003, BR-012.

### PR-002 — Stable customer employee identity

Each Person shall have a mandatory customer employee ID that is unique within the tenant and cannot be changed through ordinary active-record editing. Supports BR-010.

### PR-003 — One primary role

Each Person shall have exactly one primary organizational role: Employee, Team Lead, Manager, HR, HRBP, or Leadership. Supports BR-003, BR-004.

### PR-004 — Separate capabilities

Pulse participation and Company Admin shall be represented independently from primary role. MVP role-to-Pulse mapping shall be enforced by the product. Supports BR-004, BR-013.

### PR-005 — Stable Team

The product shall represent Team as a stable tenant-scoped entity with a stable customer Team key, display name, lifecycle status, Unit parent, and one active Team Lead owner. Supports BR-002, BR-010.

### PR-006 — Stable Unit

The product shall represent Unit as a stable tenant-scoped entity with a stable customer Unit key, display name, lifecycle status, and one active Manager owner. Supports BR-002, BR-010.

### PR-007 — Unit composition

A Unit may contain one or more Teams, direct Employees, or both. A Unit with no Teams is valid when it has a Manager and at least one direct active Employee. Supports BR-002, BR-015.

### PR-008 — Team composition

An active Team shall contain exactly one active Team Lead and at least one active Employee. A Team Lead shall not be an Employee member of their own Team. Supports BR-002.

### PR-009 — Single active placement

An active Employee shall belong to at most one active Team and exactly one active Unit. An active Team Lead shall belong to exactly one active Unit through the Team they own. Supports BR-002, BR-009.

### PR-010 — Derived line management

The product shall derive line management from Team and Unit ownership and membership. It shall not expose an independent general-purpose `reports to` field in MVP. Supports BR-002, BR-009.

### PR-011 — Tenant-wide Leadership

The product shall allow multiple Leadership Persons. Each shall have the same tenant-wide scope over all active Units. The product shall not model hierarchy among Leadership Persons in MVP. Supports BR-003, BR-015.

### PR-012 — HR Unit scope

HR Persons shall be assigned to one or more selected Units through many-to-many assignments and shall remain outside the line-management tree. Supports BR-003, BR-014.

### PR-013 — HRBP scope

HRBP Persons shall have either tenant-wide scope or selected-Unit scope. HRBP shall remain a role distinct from Leadership. Supports BR-003, BR-014.

## 5. Lifecycle Requirements

### PR-014 — Lifecycle states

Person, Team, Unit, membership, and assignment records shall support draft, active, and inactive lifecycle states. Supports BR-006, BR-007, BR-010.

### PR-015 — Draft isolation

Draft entities shall be visible to Company Admin but excluded from conversation, Pulse, delivery, and other active runtime behavior. Supports BR-006, BR-007.

### PR-016 — Activation validation

Activation shall synchronously validate role, ownership, membership, tenant, lifecycle, and Slack readiness rules for the affected structure. Supports BR-007, BR-009.

### PR-017 — Partial Slack readiness

Draft Persons without Slack identity shall not block activation of otherwise valid colleagues, Teams, or Units. Their pending assignments shall remain visible. Supports BR-006, BR-007.

### PR-018 — Inactivation instead of deletion

Previously active Persons, Teams, and Units shall be made inactive rather than physically deleted. Supports BR-010, BR-011.

## 6. CSV Provisioning Requirements

### PR-019 — Person-centric CSV

The product shall accept one CSV file with one Person per row. Person rows shall carry or reference the Unit, Team, ownership, advisory scope, and Company Admin data required for that Person. Supports BR-008.

### PR-020 — Append-only semantics

CSV import shall create new draft records only. It shall not update, move, rename, deactivate, or delete existing records. Supports BR-005, BR-009, BR-015.

### PR-021 — Atomic import

The complete CSV shall validate before persistence. Any validation error shall reject the whole file and leave stored hierarchy unchanged. Supports BR-009.

### PR-022 — Complete validation feedback

The product shall return all detectable file-level, row-level, and cross-row validation errors in one result. Supports BR-008, BR-009.

### PR-023 — Stable structure keys

CSV shall use tenant-unique stable customer keys for Persons, Teams, and Units rather than display names as identifiers. Supports BR-010.

### PR-024 — Existing-reference support

An append CSV may reference an existing Team, Unit, Manager, or Team Lead without redefining or updating that entity. Supports BR-005.

## 7. Slack Identity Requirements

### PR-025 — Slack directory matching

The product shall match provisioned Persons to Slack directory accounts using exact normalized work email. Supports BR-006, BR-007.

### PR-026 — Ambiguity fail-closed

Missing or ambiguous Slack matches shall leave the Person in draft. Display name shall not be used for automatic matching. Supports BR-006, BR-009.

### PR-027 — Manual Slack resolution

Company Admin shall be able to link an unmatched Person to an unassigned Slack account manually. Supports BR-006.

### PR-028 — Unique Slack ownership

One Slack account shall not be linked to more than one Person. Supports BR-009, BR-010.

### PR-029 — No duplicate on inbound

When an inbound Slack message belongs to a pre-provisioned linked Person, the product shall reuse that Person rather than creating another user. Supports BR-009, BR-010.

## 8. Rollout Requirements

### PR-030 — Derived rollout readiness

The product shall show whether a draft Person is ready for rollout based on valid structure and a unique Slack link. Readiness shall not be a separate persisted lifecycle state. Supports BR-006, BR-007.

### PR-031 — Unit-scoped rollout action

Company Admin shall be able to start rollout for one or more selected Units. Supports BR-001, BR-007.

### PR-032 — Ready-person activation

Rollout shall activate ready Persons in the selected scope while leaving non-ready Persons in draft. Supports BR-006, BR-007.

### PR-033 — Bot-initiated first contact

For each activated Person, the product shall open or resume a Slack DM, create the product conversation if needed, and enqueue the first onboarding message. Employee-first contact shall not be required. Supports BR-007.

### PR-034 — Delivery state separation

Onboarding delivery state shall be tracked separately from hierarchy lifecycle so a delivery error does not corrupt organizational identity. Supports BR-007, BR-009.

## 9. Administration Requirements

### PR-035 — Company Admin capability

The product shall allow multiple Company Admin capability holders per tenant. The capability shall not modify primary role, Pulse participation, or future data visibility. Supports BR-013.

### PR-036 — Typed hierarchy operations

Draft hierarchy may be edited before activation. Active hierarchy shall be changed only through typed operations, including move Employee, promote an eligible Person to Team Lead or Manager, replace Team Lead, replace Manager, change advisor scope, grant or revoke Company Admin, link or unlink Slack identity, and deactivate a Person, Team, or Unit. Supports BR-009, BR-011.

### PR-037 — Atomic mutations

Each hierarchy operation shall validate the affected subgraph and apply all resulting changes in one transaction. Supports BR-009.

### PR-038 — Owner replacement safety

An active Team or Unit shall never be left without its required active owner. Owner deactivation shall require replacement or structural deactivation/reassignment in the same operation. Supports BR-002, BR-009.

### PR-039 — Leadership continuity

The product shall reject deactivation of the final active Leadership Person while active Units remain. Supports BR-002.

### PR-040 — Audit trail

Every successful or rejected hierarchy mutation shall record tenant, actor, operation, affected entities, prior values, resulting values, timestamp, and outcome. Supports BR-011, BR-012.

### PR-041 — Internal/customer authorization separation

The shared internal admin key shall not be treated as the customer-facing hierarchy authorization model. Supports BR-013.

## 10. Product Experience Requirements

### PR-042 — Hierarchy overview

Company Admin shall be able to inspect Units, Teams, Persons, owners, lifecycle states, Slack readiness, and validation issues from a rollout administration surface.

### PR-043 — Actionable validation

Every rejected import, activation, move, replacement, or deactivation shall explain which rule failed and identify the affected rows or entities.

### PR-044 — Pending Person visibility

The administration surface shall clearly distinguish draft Persons waiting for Slack linkage from structurally invalid Persons.

### PR-045 — No report-surface reuse

The existing internal development dashboard shall not be presented as the customer hierarchy administration or future reporting surface.

## 11. Product Non-Goals

The Product Requirements intentionally exclude:

- insight and report behavior;
- report permissions and privacy thresholds;
- onboarding dialogue and consent;
- organizational structures deeper than the approved MVP hierarchy;
- matrix management;
- automatic CSV updates;
- HRIS and SCIM synchronization;
- scheduled or retroactive organizational changes;
- temporary acting-manager delegation;
- organization rollback UI.

## 12. Product Acceptance Summary

The product contract is satisfied when a customer can:

1. Upload a valid append-only CSV representing new people and structure.
2. See all created records in draft.
3. Resolve Slack accounts by work email or manual selection.
4. Activate a valid Unit population without waiting for unmatched people.
5. Initiate first Slack contact through a controlled rollout action.
6. Safely move, promote, replace, or deactivate active hierarchy members.
7. Inspect all hierarchy changes through an audit trail.
