# Onboarding v2 release checklist

Local implementation only. Nothing here has been deployed, and no Railway or Slack configuration has been changed.

## Release blockers

- [ ] Q21/Q22 privacy workstream is merged. The onboarding copy promises "not shown to anyone"; do not launch to a client until that is true.
- [ ] G4 retention is a separate workstream and is not part of this release.

## Database

- [ ] Migration `0026` is applied to the target database before the API/worker are deployed.
- [ ] Pre-deploy: no `pending`/`failed` `org_onboarding_deliveries` in tenants without a work calendar (the worker holds them and logs `onboarding deliveries held` every tick until the calendar is configured):
  `SELECT d.tenant_id, d.status, count(*) FROM org_onboarding_deliveries d WHERE d.status IN ('pending','failed') AND NOT EXISTS (SELECT 1 FROM tenant_work_calendars wc WHERE wc.tenant_id = d.tenant_id) GROUP BY 1, 2;` returns no rows.

## Operator steps

- [ ] Configure the company calendar: `apps/api/scripts/configure-company-calendar.ts --operator`. Rollout stays blocked until this is done (reminders need a work calendar).

## Q26 owner checklist (Slack app, owning developer)

- [ ] Interactivity is enabled in the Slack app.
- [ ] Socket Mode delivers `interactive` envelopes (if Socket Mode is used).
- [ ] If HTTP mode is used, the interactions Request URL is `/api/v1/channel/slack/interactions`.
- [ ] Double-clicking a button produces exactly one action.
- [ ] Buttons are replaced by the acknowledgement text after a choice.

## Not verified locally

- Live Slack behaviour (no local Slack tokens): button delivery, interactive envelopes, message replacement.

## Rules

- No Railway or Slack configuration change without explicit approval.
- Prefer GitHub auto-deploy from `main`; see `docs/superpowers/railway-deploy.md`.
