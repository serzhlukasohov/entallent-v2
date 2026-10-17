# Onboarding v2 Dev Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a developer exercise the whole onboarding v2 flow locally from `pnpm chat`. No Slack, no OIDC, no Company Setup UI.

**Architecture:** This is dev-only tooling. API endpoints live under the existing `DevModule` (`apps/api/src/dev`), which is mounted only outside production (`shouldMountDevModule`). The worker handles one dev-only job kind, guarded by the same environment rule. The `dev` channel in message-send activates buttons the way a Slack delivery does. `scripts/chat.ts` gets slash commands. No production code path changes behaviour.

**Tech Stack:** NestJS, BullMQ, Drizzle, vitest, tsx.

**Spec:** `docs/onboarding-v2.md` and `docs/onboarding-v2-answers.md` (behaviour under test). Implementation plan: `docs/superpowers/plans/2026-10-07-onboarding-v2.md`.

## Global Constraints

- Dev-only. Every new endpoint is in `DevModule`. The worker's dev job kind is processed only when `shouldMountDevModule`-equivalent logic allows it (`NODE_ENV !== 'production'`, or `ENABLE_DEV_ENDPOINTS=true` outside production). In production the job is rejected or ignored and logged, and a test proves it.
- No change to production onboarding behaviour, copy, decider, or Slack paths. The dev channel branch in message-send is the only shared-path change, and it only runs for `channelType === 'dev'`.
- Clicks are simulated by enqueuing the same `OnboardingActionJob` (`kind: 'button'`) that the Slack interaction handler enqueues. They are never persisted as inbound messages.
- Text goes through the existing `dev/simulate-message` path, which uses the real orchestrator and the live classifier.
- The dev calendar is created only by an explicit `/onboard` call when the tenant has none. It uses Mon–Fri 09:00–18:00 in `Europe/Kyiv`, and the console prints it. This is dev tooling, not a product default.

---

### Task 1: Dev onboarding endpoints, dev channel buttons, chat commands

**Files:**
- Create: `apps/api/src/dev/dev-onboarding.controller.ts` (+ `.test.ts`), registered in `apps/api/src/dev/dev.module.ts`
- Modify: `packages/contracts/src/onboarding.ts`. Add a dev job variant `{ kind: 'dev_intro', tenantId, personId }` to the onboarding queue job union.
- Modify: `apps/worker/src/onboarding/onboarding-action.processor.ts` (+ test). Handle `dev_intro` only in non-production by calling `OnboardingIntroService.sendIntro` for the person's current role (fresh version).
- Modify: `apps/worker/src/message-send/message-send.processor.ts` (+ test). In the `dev` branch, after recording delivery of a message whose metadata is the trust part with actions:
  - log the buttons (`[DEV BUTTONS] Let's Talk | Later | ...`);
  - call `recordIntroDelivered(tenantId, personId, channelId = externalChannelId, messageTs = (Date.now()/1000).toFixed(6), at, roleChange flag)`, the same as the Slack path.
- Modify: `apps/worker/src/onboarding/onboarding-effects.service.ts` (+ test). `replaceIntroActions` for dev conversations (channel type `dev`) logs `[DEV BUTTONS REPLACED] <text>` and returns true, without calling Slack.
- Modify: `scripts/chat.ts`. Add slash commands; plain text keeps using `dev/simulate-message`.

**Endpoints (all under `/api/v1/dev/onboarding`):**
- `POST start {tenantId?, userId, userName?, role}`:
  - creates the tenant work calendar if missing;
  - ensures the dev user and conversation the same way `simulate-message` does;
  - ensures a `people` row (`id = users.id`) with `primary_role = role`, `pulse_participant` set by the role mapping, `lifecycle_status = 'active'`, `users.status = 'active'`, and a valid `customer_employee_id`/`work_email` (dev placeholders);
  - deletes any existing `onboarding_states` row for this person (dev reset);
  - enqueues `dev_intro`.
  - Returns `{ userId, personId, conversationId, calendarCreated }`.
- `POST click {tenantId?, userId, action}`: reads the state row; if `introActionsMessageTs` is null, returns 409 `buttons_not_delivered`. Otherwise enqueues `{kind:'button', tenantId, personId, action, actionTs: (Date.now()/1000).toFixed(6), messageTs, channelId}` with the standard action jobId builder.
- `POST remind-now {tenantId?, userId}`: when `reminder_status = 'scheduled'`, sets `reminder_due_at = now()` and enqueues `remind` with the canonical reminder jobId builder. Otherwise returns 409 with the current reminder status.
- `POST role {tenantId?, userId, role}`: updates `people.primary_role` and `pulse_participant` (mapping), then enqueues the system job `role_changed {from, to}` with a dev jobId (`onb-sys:${personId}:dev-${Date.now()}`), which must pass the BullMQ id test.
- `GET state/:userId?tenantId=`: returns the onboarding state row (track, introStatus, participation, reminderStatus, reminderDueAt, buttonsActive) plus `users.proactive_messaging_enabled`.

**Chat commands (`scripts/chat.ts`):**
- `/onboard <employee|team_lead|manager|hr|hrbp|leadership>` calls `start`, then polls and prints the two intro messages. Under the second message it prints the buttons from `metadata.onboardingActions` as `[Let's Talk] [Later] [I Don't Want to Participate]`.
- `/click <start|later|decline|got_it>` calls `click`, waits, prints new outbound messages and the state line. It also prints "buttons replaced: <text>" when `buttonsActive` flips to false (from the worker log text, or by computing it from the state).
- `/remind-now`, `/role <role>` and `/state` call their endpoints and print the result.
- `/help` lists the commands.
- Plain text works as today.

- [ ] Tests first for:
  - each endpoint, including the 409s;
  - dev reset;
  - the production guard for `dev_intro`;
  - the dev branch recording intro delivery only for a trust message with actions;
  - the dev `replaceIntroActions` not calling Slack;
  - the dev role jobId passing BullMQ validation.
- [ ] Implement.
- [ ] `pnpm typecheck`, then `pnpm --filter @entalent/api test` and `pnpm --filter @entalent/worker test` with the local DB/Redis env, then `pnpm harness:check -- --base <base>`.
- [ ] Commit: `feat(dev): onboarding v2 console for local testing`.
