# Safety Escalation Channel (ADR-013 G8 / R5) — Design Proposal

**Status:** Proposed, awaiting approval. Nothing here is built yet.
**Date:** 2026-10-13
**Replaces:** `apps/worker/src/safety/escalation-stub.service.ts` (audit entry plus warning log only; no human is notified)
**Constraints:** ADR-008 (never the employee's manager), ADR-005 (the LLM proposes, TypeScript decides and audits), ADR-002 (Postgres is the source of truth, BullMQ only delivers), R5 (the `critical` / `immediateResponseRequired` threshold stays unchanged until this channel exists and has false-positive data).

## Problem

`MustEscalate` (`packages/application/src/utils/risk-policy.ts`) fires for `critical` or `immediateResponseRequired`. As of Wave 1 it also fires when the provider moderation tripwire raises severity, including when Azure refuses a self-harm transcript (`400 content_filter`). Today that decision only writes `audit_logs.action = 'escalation.raised'`. Nobody receives it.

Measured on the Azure dev deployment (`gpt-5.4-mini`, 2026-10-13). The Azure content filter is an inconsistent signal:
- "thinking about ending my life" is rejected with `content_filter` (`self_harm: medium`) as a bare prompt and inside the 3-turn risk prompt. Then `detectRisk` yields `ModerationSignalError`, and the tripwire makes the turn `critical` and escalates.
- The same message inside a longer live conversation (local Slack E2E) was **not** blocked. The model assessed it `critical` itself, escalation fired, and the crisis reply was delivered to Slack.
- "I want to kill myself tonight. I already have the pills ready." is annotated `self_harm: safe`.

So the filter can neither be relied on for recall nor ruled out as a turn breaker. When it does block, classification and generation fail too, and the employee gets no reply. On those turns the escalation is the only safety action left.

## Requirements

1. **Delivery:** a designated safety or HR reviewer per tenant is notified within 1 minute of the decision.
2. **Never the manager (ADR-008):** the recipient is resolved from an explicit reviewer list. It is never derived from the reporting hierarchy, and a reviewer who is the employee's manager in `company_hierarchy` is skipped.
3. **Acknowledgment:** the reviewer acknowledges explicitly. If nobody acknowledges within the SLA, the alert re-notifies and then goes to a secondary reviewer.
4. **Audit:** every transition is recorded in `audit_logs` with the policy version: raised, delivered, delivery failed, acknowledged, re-notified, resolved.
5. **Data minimization:** the notification carries no message text, only who, severity, risk type, time, and a link. Context is visible only in an audited reviewer view.
6. **Idempotency:** one escalation per source message. BullMQ retries and repeated `orchestrate` attempts (a failed turn is retried) must not notify twice. The stub already uses the key `risk:<messageId>`.
7. **Fail loud:** a tenant with no reviewer configured raises an ops alert (Sentry error plus a dashboard banner). It is never silently dropped.

## Recommended design

**Recommendation: Slack DM to designated reviewers, with acknowledgment through a Slack button.** It is backed by a Postgres escalation record and a BullMQ delivery job.

```
orchestrator ── MustEscalate ──► EscalationPort.raise(event)
                                     │  (worker adapter: SafetyEscalationService)
                                     ▼
                     INSERT safety_escalations (unique tenant_id+source_message_id)
                     audit: escalation.raised
                                     │ enqueue (jobId = escalation id)
                                     ▼
                  BullMQ `safety-escalation` job ──► resolve reviewers (tenant config, minus manager)
                                     │                   └─ none → Sentry + audit escalation.unrouted
                                     ▼
                  Slack chat.postMessage (DM to reviewer, Block Kit: severity, type, <@employee>, time,
                  [Acknowledge] button, link to reviewer view) ── audit escalation.delivered
                                     │
           ack button ──► API /slack/interactivity (signature-verified) ──► status=acknowledged, audit
                                     │
           delayed job at +SLA (default 15 min): still unacknowledged → re-notify + secondary reviewer,
           audit escalation.renotified; after the 2nd SLA → ops on-call (Sentry critical)
```

### Components

- **Schema (new forward migration):** `safety_escalations` with `id`, `tenant_id`, `user_id`, `source_message_id` (unique with the tenant), `severity`, `risk_type`, `assessed`, `tripwire_raised`, `policy_version`, `status` (`pending|delivered|acknowledged|resolved|unrouted`), `acknowledged_by`, `acknowledged_at`, and timestamps. Reviewer config goes in `tenant_safety_reviewers` with `tenant_id`, `channel_account_id`, `role` (`primary|secondary`), and `active`. It is configured through an admin endpoint with an audit trail.
- **Port:** `EscalationPort.raise` keeps its signature, so the orchestrator does not change. `SafetyEscalationService` replaces `EscalationStubService` in `conversation.module.ts`, plus the follow-up and proactive wiring if they inject it.
- **Delivery:** reuse the existing Slack bot token and `channel-slack` adapter. Add a `chat:write` DM to a user. `im:write` is already needed for employee DMs, so this should not need a new scope; to be verified.
- **Ack:** Slack interactivity needs the app's Interactivity Request URL to point at the API, signed with `SLACK_SIGNING_SECRET`. This changes Slack app config, so it needs your approval. Fallback: an "Acknowledge" action in the internal dashboard, which is already admin-key protected.
- **Reviewer view:** an admin-only page showing the escalation and the minimal context (risk evidence quotes from `detectRisk`). Each view writes `admin.safety_escalation_viewed`.

### Why Slack DM

| Option | Latency | New dependencies | Acknowledgment | Fit |
|---|---|---|---|---|
| **Slack DM to designated reviewers (recommended)** | seconds | none (bot already installed) | Slack button | Reviewers already live in Slack; reuses the delivery path and token |
| Email (SES/SendGrid) | seconds–minutes | new provider, secrets, DNS/SPF | link to dashboard | Works outside Slack, but adds a dependency and is easy to miss |
| Tenant webhook (PagerDuty/Opsgenie/Teams) | seconds | per-tenant config | provider-native | Best for tenants with on-call tooling; do it as a second adapter behind the same port |
| Dashboard queue only | pull | none | dashboard | Fails the core requirement, because nobody is notified |

The webhook adapter is a natural phase 2 behind the same `safety_escalations` record.

## Out of scope (by R5)

- No change to the escalation threshold. `high` still does not escalate. That decision is made with the reviewer after this channel has run and the D7 safety eval has false-positive numbers.
- No employee-facing change. The crisis reply when generation is content-filtered is a separate follow-up, and its text needs product/clinical sign-off.

## Decisions needed before building

1. **Delivery mechanism:** Slack DM to designated reviewers (recommended), or email or webhook first?
2. **Reviewer identity:** who is the primary and secondary reviewer for the pilot tenant? An HR/People safety contact? Should enTalent ops be the final fallback?
3. **Notification content:** is it OK to name the employee (`<@U…>`) in the DM? Duty of care needs it, and the message text stays out of the DM.
4. **SLA:** 15 minutes to acknowledge before re-notifying, then the secondary reviewer, then ops?
5. **Slack app change:** enable Interactivity (Request URL to the API) for the Acknowledge button, or use dashboard-only acknowledgment first?

## Verification plan (when built)

- Unit: reviewer resolution excludes the manager; idempotent on `source_message_id`; unrouted raises an alert.
- Worker: delivery retries with backoff; the SLA job re-notifies only while unacknowledged.
- API: the interactivity endpoint rejects bad signatures and acks are tenant-scoped.
- `pnpm test:integration` for the migration and unique constraint; `pnpm harness:preflight` before any Slack smoke to a test reviewer.
