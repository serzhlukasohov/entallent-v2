# ADR-008: Privacy Boundaries for Manager Analytics

**Status:** Accepted  
**Date:** 2025-01

## Context

The platform collects sensitive personal data through natural conversation. Managers and HR need access to aggregate engagement insights to make organizational decisions, but must not be able to read individual employee conversations or derive individual-level sensitive signals.

The main privacy tensions:
1. **Utility vs. privacy**: Aggregate analytics are useful; individual surveillance is harmful
2. **Role-based access**: Managers see their team's aggregate data; admins see operational data; users own their own data
3. **Re-identification risk**: Small cohorts can reveal individuals even in aggregate

## Decision

### Access tiers

| Role | What they can access |
|------|---------------------|
| Employee | Own conversations, memory items, goals (read, correct, delete) |
| Manager | Aggregate team analytics (cohort ≥ 5), survey coverage rates, no individual data |
| HR Admin | Aggregate org-wide analytics, survey definitions, no raw conversations |
| System Admin | Operational data (queue stats, LLM runs, audit logs), user debug (with audit trail) |
| AI System | Reads conversation + memory + survey context for its designated user only |

### Minimum cohort size

All aggregate analytics **suppress data if the cohort has fewer than 5 unique users**. This prevents re-identification of individuals through:
- Risk signal distribution
- Survey score averages
- DAU/MAU breakdowns for small teams

This threshold is hardcoded (`MIN_COHORT_SIZE = 5`) and not configurable per tenant to prevent policy weakening.

### Manager data isolation

- Managers cannot query raw `messages` or `memory_items` tables
- Managers cannot see individual risk signals — only team-level severity distributions with cohort suppression
- The API layer enforces this at the controller level (no manager-facing endpoints expose individual records)

### Sensitive access audit

Access to the user debug endpoint (`GET /admin/user-debug/:userId`) is always logged to the audit trail with `action=admin.user_debug_viewed`. The audit log is append-only and cannot be deleted through the normal API.

## Consequences

**Positive:**
- Clear separation of concerns — managers never see sensitive individual data
- Cohort suppression prevents statistical re-identification
- Audit trail provides accountability for sensitive access

**Negative:**
- Small teams (<5 people) receive no analytics — this is intentional
- Manager adoption may be lower if they expect richer individual reports
- Must be communicated clearly in employee data consent notices

## Related

- PRIVACY.md — full data access model documentation
- ADR-005 — LLMs cannot directly access other users' data
