---
title: Company Hierarchy MVP — Business Requirements
document_type: business-requirements
status: approved-for-planning
language: English
owner: Product
created: 2026-09-25
source_spec: _bmad-output/specs/spec-company-hierarchy-mvp/SPEC.md
baseline_commit: a189ed2
---

# Company Hierarchy MVP — Business Requirements

## 1. Document Purpose

This document defines the business outcomes, boundaries, stakeholders, and success conditions for introducing a company hierarchy and controlled Slack rollout into enTalent.

Together with the linked Product Requirements and Feature Requirements, it is intended to be the Confluence source of truth for the Company Hierarchy MVP.

## 2. Business Context

enTalent is designed for organizations that need to deploy an AI work companion across structured groups of employees. The current product supports employee conversations and a basic team-oriented Pulse model, but it does not represent the organizational roles and ownership relationships required for a controlled customer rollout.

The initial target for this MVP is a customer organization or pilot population of approximately 300–1,500 people. The model must remain conceptually extensible toward larger organizations without attempting to represent every enterprise hierarchy pattern in the first release.

Customers need to:

- provision people before they interact with the agent;
- assign each person a clear organizational role;
- organize Employees under Team Leads and Managers;
- represent Managers' broader organizational responsibility through Units;
- represent HR, HRBP, and Leadership without forcing them into the line-management tree;
- expand a successful pilot by appending new people and structure;
- activate the agent only for people who are correctly configured and reachable in Slack;
- administer hierarchy changes without corrupting active organizational relationships.

## 3. Business Objective

Enable a customer to configure, validate, and roll out enTalent to a defined organizational population through a stable hierarchy model that is suitable for future role-specific product behavior.

## 4. Business Outcomes

### BR-001 — Structured customer rollout

The customer must be able to represent the organizational structure required for an enTalent rollout without relying on ad hoc Slack IDs or developer-managed database updates.

### BR-002 — Clear organizational ownership

Every active Team and Unit must have an unambiguous accountable owner so future employee experience, administration, and reporting behavior can be assigned correctly.

### BR-003 — Role-aware product foundation

The product must distinguish Employee, Team Lead, Manager, HR, HRBP, and Leadership so future behavior can vary by role without reworking the identity model.

### BR-004 — Separation of role and participation

Organizational role, Pulse participation, administrative capability, and organizational scope must remain separate business concepts.

### BR-005 — Pilot-to-expansion path

The customer must be able to begin with one or more Units and later append new people, Teams, and Units without rebuilding the original pilot population.

### BR-006 — Safe pre-provisioning

People must be addable before their Slack identity is available. They must remain visible but inactive until the product can contact them safely.

### BR-007 — Controlled activation

Adding a person to enTalent must not automatically start agent interaction. Customer-controlled rollout must determine when configured and reachable people become active.

### BR-008 — Scalable initial setup

The MVP must support bulk initial setup using a client-prepared CSV file, avoiding manual creation of hundreds or thousands of people.

### BR-009 — Data integrity over partial convenience

Invalid imports and invalid hierarchy mutations must fail atomically rather than leave a partially applied company structure.

### BR-010 — Stable organizational identity

People, Teams, and Units must retain stable identities when names, Slack accounts, Team Leads, or Managers change.

### BR-011 — Auditable administration

Hierarchy changes must be attributable to an administrator or internal operator and must preserve enough structured history for investigation and support.

### BR-012 — Tenant isolation

No customer person, structure, assignment, or administrative action may cross tenant boundaries.

### BR-013 — Customer administration without data overreach

The ability to administer company structure must not automatically grant access to employee conversations, Pulse evidence, insights, or reports.

### BR-014 — Future role-specific experiences

The hierarchy must support later work on role-specific reports, insight aggregation, onboarding, consent, and agent behavior without defining those experiences in this MVP.

### BR-015 — Fast MVP delivery

The first release must avoid enterprise hierarchy features that are not necessary for the target rollout, including matrix management, HRIS synchronization, organization-version workflows, and arbitrary hierarchy depth.

## 5. Stakeholders

| Stakeholder | Business interest |
| --- | --- |
| Customer sponsor | Successful pilot and expansion across the organization |
| Company Admin | Accurate setup, validation, activation, and maintenance of hierarchy |
| Employee | Correct placement and controlled access to the agent |
| Team Lead | Correct ownership of one Team while remaining eligible for employee experience |
| Manager | Correct ownership of one Unit containing Teams and/or direct Employees |
| HR | Assignment to the correct Units without being treated as a line manager |
| HRBP | Selected-Unit or tenant-wide responsibility distinct from Leadership |
| Leadership | Tenant-wide organizational scope |
| enTalent operations | Safe bootstrap, support, audit, and troubleshooting |
| Engineering | A consistent domain model with enforceable invariants |

## 6. Business Scope

### In scope

- tenant-scoped Person identity;
- one primary organizational role per Person;
- separate Pulse participation and Company Admin capabilities;
- stable Team and Unit entities;
- direct Unit Employees;
- tenant-wide Leadership;
- HR and HRBP Unit scopes;
- draft, active, and inactive lifecycle;
- append-only atomic CSV import;
- Slack identity matching and manual resolution;
- customer-controlled batch rollout by Unit;
- typed and atomic hierarchy changes;
- auditability and tenant isolation.

### Out of scope

- report content or delivery rules;
- insight collection, confirmation, correction, or aggregation;
- anonymity and inference policy for Team or Unit reports;
- customer-facing analytics dashboards;
- onboarding conversation content or employee consent policy;
- matrix and dotted-line reporting;
- Departments, Business Units, legal entities, or geographies;
- arbitrary numbers of management layers;
- multiple active Teams or Units per Employee;
- HRIS, SCIM, or public provisioning APIs;
- CSV-based updates, deletions, moves, or full synchronization;
- scheduled organizational changes or temporary delegation;
- versioned organization snapshots and rollback UI;
- full historical hierarchy reconstruction.

## 7. Business Policies

### BP-001 — One primary role

Each Person has exactly one primary role. Additional product permissions are capabilities or scopes, not additional primary roles.

### BP-002 — Team and Unit ownership

A Team is owned by one Team Lead. A Unit is owned by one Manager. A Unit may contain Teams, direct Employees, or both.

### BP-003 — Neutral Unit terminology

`Unit` is the internal product term for the organizational population under one Manager. It does not assert that the customer's structure is a Department or Business Unit.

### BP-004 — Slack-gated participation

A Person may be provisioned without Slack, but may not become active until a unique Slack identity is linked.

### BP-005 — Customer-controlled rollout

The customer starts rollout for selected Units. Slack identity discovery alone must not trigger agent interaction.

### BP-006 — Append-only CSV

CSV import adds new draft records only. Existing people and structure are changed through controlled administrative operations.

### BP-007 — No hard deletion of active identities

Previously active Persons, Teams, and Units become inactive rather than being physically deleted.

## 8. Business Success Measures

The MVP is successful when:

- a customer can upload a valid pilot population without engineering intervention;
- invalid CSV files produce actionable errors and no partial database changes;
- every activated Person is uniquely linked to a Slack account;
- a Company Admin can activate a selected Unit without waiting for every imported Person to be Slack-ready;
- Team and Unit ownership cannot become ambiguous;
- organizational moves and owner replacements cannot leave orphaned active structures;
- a later pilot expansion can append new people and structure without modifying existing records through CSV;
- all hierarchy changes are tenant-scoped and auditable;
- inactive or draft Persons do not participate in agent runtime behavior.

## 9. Business Risks

| Risk | Business impact | Required mitigation |
| --- | --- | --- |
| Incorrect CSV structure | Wrong employee placement or rollout delay | Full-file validation and atomic rejection |
| Duplicate identity | Messages or data attached to the wrong person | Stable customer employee ID and unique Slack linkage |
| Partial activation | Inconsistent product behavior | Typed activation operations and runtime active-only filters |
| Orphaned Team or Unit | Missing accountability and broken future behavior | Atomic owner replacement/deactivation rules |
| Admin privilege overreach | Privacy and trust failure | Separate Company Admin capability from data access |
| Terminology mismatch | Customer confusion | Neutral Unit model plus customer-facing names/titles |
| Premature enterprise complexity | Delayed MVP | Explicit non-goals and fixed hierarchy depth |

## 10. Dependencies and Assumptions

- The customer can provide stable employee identifiers and work emails.
- The Slack application is installed for the target workspace before activation.
- Slack permissions allow directory lookup and bot-initiated direct messages.
- Customer administrators are responsible for the correctness of uploaded organizational data.
- The active product runtime remains TypeScript-only.
- Existing Team data will require a separately planned forward migration and backfill.

## 11. Requirement Traceability

Detailed product behavior is defined in `PRODUCT-REQUIREMENTS.md`. Testable feature behavior is defined in `FEATURE-REQUIREMENTS.md`.

When documents conflict:

1. Business Requirements define the approved outcomes and scope.
2. Product Requirements define the intended user and domain behavior.
3. Feature Requirements define testable implementation-facing behavior without changing the approved business intent.
