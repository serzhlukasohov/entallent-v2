# Feature Regression Matrix

Every product-level row is MAF-primary. Legacy `ConversationOrchestrator` coverage is fallback or rollback only.

| Feature | User promise | MAF path to cover | Deterministic checks | Simulation / judge checks | Gate |
| --- | --- | --- | --- | --- | --- |
| Slack AI mentor | Employee gets a useful Slack reply | Slack event or API event reaches worker and calls MAF primary | HMAC, idempotency, inbound persisted, job queued, outbound persisted, send queued, trace/runtime evidence recorded | Reply is useful, concise, natural, no extra questions | PR for Slack/runtime changes |
| Long-term memory | Mentor remembers durable user context | Worker loads memory into `runtimeContext.memoryItems` before MAF call | Active memory only, ordered/limited, deleted/conflicted excluded, export/delete behavior | Uses relevant memory without creepy over-sharing | Feature PR + sim |
| Conversational Pulse | Engagement is measured through natural conversation | MAF receives reply policy/probe context and returns survey metadata | Window creation, probe eligibility, cooldown, evidence extraction, assessment scoring | Probe is subtle, one question max, skipped in bad moments | Feature PR + sim gate |
| Proactive check-ins | Mentor reaches out on cadence | Check-in job calls MAF with `requestPurpose='proactive_check_in'` | Eligibility, quiet hours, risk suppression, feature flag, selected probe recorded only if used | Warm short outreach, avoids banned reminder language | Feature PR + live smoke |
| Safety / risk | Risky situations are handled safely | MAF classifies risk and TS persists/enforces side effects | Risk signal persisted, survey/proactive suppressed, escalation audit for critical/immediate | Crisis/harassment/burnout responses pass safety judge | Required before release |
| Style adaptation | Mentor gradually adapts tone | Style/profile context is available to MAF when present | Profile update threshold, blending, no sentinel turns | Tone adapts without mimicry or unsafe patterns | Feature PR + judged eval |
| Profile hydration | Timezone enables correct timing | Hydrated timezone affects MAF/proactive context and quiet-hours logic | Slack timezone persisted, lookup failure non-fatal, quiet hours use timezone | Proactive eligibility changes correctly after hydration | Targeted PR |
| Manager Pulse dashboard | Managers see privacy-safe pulse state | MAF-created survey state appears in admin/dashboard read model | Cohort boundaries, statuses, backlog, no raw text/memory/risk reasoning | UI renders real API data | Dashboard/API PR |
| Manager Trends | Managers see aggregate trends | MAF-created messages/evidence feed trend aggregates | Daily buckets, polarity counts, funnel, days bounds, tenant scope | Trend UI charts render expected data | Dashboard/API PR |
| Admin console | Operators can inspect and recover system state | MAF runs are visible in queues, llm/runtime logs, audit | Queue list/retry, feature flags, audit, user debug sanitized | N/A unless live ops workflow changes | Ops/API PR |
| GDPR / privacy | User can export/delete data safely | Deleted data must not re-enter MAF context | Export allowlist, deletion anonymizes messages, clears memory, cancels actions, resolves risks | Post-deletion conversation has no stale context | Privacy PR |
| MAF rollout | Runtime can be rolled out and rolled back | Runtime flags control MAF disabled/shadow/canary/primary/denylist | Mode resolver, fallback barrier, invalid result rejected, `runtime_attempts` phase/failure | Live smoke proves primary path works | Runtime PR + release |

## First Story Slice

Start with Slack AI mentor because every other row depends on inbound event handling, worker routing, MAF primary execution, TypeScript persistence, outbound delivery, audit, and `runtime_attempts`.
