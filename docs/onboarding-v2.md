# Onboarding v2

The company rollout creates durable first-contact intents after hierarchy and Slack identities are ready. The worker sends reviewed role-specific introductions for Employee, Team Lead, Manager, HR, HRBP, and Leadership. English is the default; the Company Admin can choose English, Russian, or Ukrainian and configure the company timezone, working days, and opening and closing hours.

## Participation and actions

| Role | Available actions | Completion |
| --- | --- | --- |
| Employee | Let's Talk, Later, I Don't Want to Participate | Explicitly starts a personal conversation |
| Team Lead | Start My Conversation, Got It, Later, No Personal Check-ins | Starts personal participation or acknowledges the management introduction |
| Manager, HR, HRBP, Leadership | Got It | Acknowledges the introduction |

The start action selects the first available Pulse backlog topic. If no topic is configured yet, Emma opens a general work conversation. Free-text equivalents of the named actions are supported; ambiguous answers do not silently enroll anyone. Ordinary messages still use the TypeScript safety and response pipeline. Declined users may initiate conversations without re-enabling recurring invitations.

Onboarding completion never authorizes insight use. Approval of the exact anonymized summary remains in the existing confirmation flow. No report examples, report-view buttons, icebreaker, style selection, name customization, or avatar customization are included in this PR.

## Durable state and reminder

The versioned onboarding state lives under `users.communication_preferences.onboarding`; it tracks personal participation separately from the management introduction. `onboarding_status` is a summary, not a reporting permission. The existing rollout delivery intent and outbound Slack receipt remain separate from completion. Existing JSON columns are used; no migration is required.

After Later or unanswered first contact, send at most one reminder at the beginning of the second subsequent configured working day. Read the latest company calendar at dispatch; respect timezone, weekends, custom workweeks, and DST. A deferral starts the two-working-day interval again, but never resets the one-reminder budget. Explicit decline cancels personal invitations and reminders. Team Lead reporting rights are unchanged by their personal choice. Returning users can explicitly start participation again.

Signed Slack HTTP interactions use `/api/v1/channel/slack/actions`; Socket Mode also handles `block_actions`. HTTP requires the raw request body and a valid workspace signature. Actor, tenant, DM, original outbound message, role, and onboarding version are checked before mutation. Action replies are persisted in the same transaction as the decision. Stable message and BullMQ job IDs support replay without duplicate Pulse starts.

## Privacy boundary

Admin debug exposes delivery metadata only, never message previews, memory, goals, risk reasoning, or survey responses. Individual insight reads are denied. Development inspection is restricted to synthetic dev conversations. New v2 participants are excluded from identifiable internal manager and Pulse views; existing endpoints and legacy reporting remain available. No additional reporting capabilities are granted by onboarding.

Database and infrastructure access controls remain an operational responsibility. Application privacy tests do not certify that no database operator can read stored data. Anonymized reporting and sample report publication remain owned by the reporting workstream and must be verified before product release.

## Verification

Use `pnpm harness:check -- --base <main-sha>` to select active tests. Do not run the unfiltered application test suite: it also invokes archived MAF fixtures. On this desktop runtime, expose bundled Node and `packages/eslint-config/node_modules/.bin` on PATH and set `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false` after dependency installation to avoid repeated auto-installation.

The deterministic tests cover role/action boundaries, optional examples being absent, no insight approval from onboarding, DST and custom workweeks, signed-action normalization, outbox replay, and private-data views. The existing PostgreSQL/BullMQ integration uses mocked Slack and requires both local targets to pass `pnpm harness:preflight`; it is skipped when those dependencies are unavailable. No production or real Slack payload is needed for this PR.
