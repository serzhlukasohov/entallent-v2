# Production Dashboard Verifier

Status: done

## Context

The manager dashboard previously rendered stale/fallback data after deploy and
employee rows could regress to user IDs instead of profile display names. The
dashboard pages are now dynamic, but the invariant is only manually checked with
ad hoc curl commands.

## Goal

Add a repeatable production smoke verifier that checks the dashboard-admin path
after deployment:

- API health is reachable.
- Manager team endpoint returns employees with display names that are not UUID
  fallbacks.
- Manager trends endpoint returns a populated response envelope.
- Dashboard `/`, `/trends`, `/pulse`, and one `/pulse/{userId}` page return
  `200`.
- Dashboard `/` and `/trends` do not expose Next prerender/ISR headers and use
  no-cache rendering semantics.
- Dashboard HTML contains expected live data markers and does not render the
  data-load fallback.

## Non-Goals

- No Railway CLI deployment orchestration.
- No database access.
- No Slack or runtime-message regression scenarios.

## Implementation Plan

1. Add `scripts/verify-production-dashboard.ts`.
2. Add a root package script for the verifier.
3. Run typecheck and the verifier against production.

## Acceptance

- `pnpm run dashboard:prod:verify` exits `0` when configured with production
  `ADMIN_API_KEY` and tenant ID.
- The script prints a concise summary and never prints the admin key.
- Failure messages name the exact broken invariant.

## Verification

- `pnpm typecheck`
- `ADMIN_API_KEY=<redacted> TENANT_ID=7d1e0163-6d53-4713-bd24-254690cc5090 pnpm run dashboard:prod:verify`
