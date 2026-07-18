# Safety

## Risk Taxonomy

| Type | Description |
|------|-------------|
| `burnout` | Signs of emotional exhaustion, overwhelm, or work-life imbalance |
| `crisis` | Acute mental health distress, self-harm ideation, or immediate danger |
| `harassment` | Reports of workplace harassment, bullying, or hostile behaviour |
| `disengagement` | Severe disengagement, expressed intent to leave, or hopelessness |

## Severity Definitions

| Severity | Meaning | Auto-expiry |
|----------|---------|-------------|
| `none` | No risk detected | — |
| `low` | Mild indicators, likely transient | 7 days |
| `medium` | Recurring signals or moderate intensity | 30 days |
| `high` | Significant concern requiring monitoring | 90 days |
| `critical` | Immediate safety concern; escalation required | 90 days |

## Detection Policy

Safety detection runs on every inbound message where `SituationClassification.requiresSafetyCheck = true`. The classifier sets this flag when the message contains emotional content, distress language, or sensitive topics.

`detectRisk()` is called with the last 20 conversation turns. Output fields:
- `riskType` — one of the taxonomy values above, or null
- `severity` — severity level
- `confidence` — 0–1 AI confidence score
- `immediateResponseRequired` — true if the AI believes intervention is needed now
- `surveyMustBeBlocked` — true if survey probing would be inappropriate
- `recommendedAction` — natural language guidance for human reviewer

Detected risks are persisted to `risk_signals` with the message IDs as evidence. Subsequent messages in the same conversation update the active signal or create a new one.

## Response Policies

| Scenario | AI Response Mode |
|----------|-----------------|
| `severity = none` | Normal conversation continues |
| `severity = low/medium` | AI acknowledges concern, offers supportive response, no escalation |
| `severity = high` | AI prioritises support, gently mentions professional resources |
| `severity = critical` | AI immediately responds with crisis resources; escalation triggered |
| `immediateResponseRequired = true` | Escalation triggered regardless of severity |

The AI response is gated: survey probes are suppressed when `surveyMustBeBlocked = true`. Proactive follow-ups are cancelled for users with active high-risk signals.

## Escalation Matrix

| Trigger | Action |
|---------|--------|
| `severity = critical` | `EscalationPort.raise()` called + audit log entry |
| `immediateResponseRequired = true` | `EscalationPort.raise()` called + audit log entry |

The current `EscalationStubService` logs the event and writes to the audit log. Production implementations should replace it with:
- Email alert to HR/EAP contact
- PagerDuty / OpsGenie webhook for on-call
- Slack DM to designated safety officer
- HRIS system ticket creation

The `EscalationPort` interface is unchanged regardless of implementation.

## Suppression Rules

Survey probing is suppressed when:
1. `risk.surveyMustBeBlocked = true` (AI determined probing is inappropriate)
2. Conversation classification sets `surveyAllowed = false`
3. The `conversational_survey` feature flag is disabled for the tenant/user

Proactive outreach is suppressed when:
1. User has `proactiveMessagingEnabled = false`
2. Current time falls in user's quiet hours window
3. User has an active high-risk signal (`hasActiveHighRisk = true`)
4. The `proactive_messaging` feature flag is disabled

## Privacy Constraints

- Risk signal details (type, severity, evidence message IDs) are **never** shown in manager analytics
- Admin debug view shows only sanitised risk status (`hasActiveRisk: bool, severity, type`) — not AI reasoning or message excerpts that triggered it
- Escalation events are audit-logged with minimal context (userId, severity, riskType) — not full message text

## Limitations

- AI detection is not a substitute for clinical risk assessment
- False negatives are possible; this system is a safety net, not a guarantee
- Detection operates on text only; tone, context, and cultural nuance may reduce accuracy
- The system cannot take physical action — escalation is notification only
- `policy_version` field on `risk_signals` tracks which version of safety prompts detected each signal; review historical signals if prompts change significantly

## Testing Scenarios

Test fixtures for the risk detection pipeline should cover:
1. Normal work stress message → `severity = none`
2. Repeated burnout language over 3 turns → `severity = medium`
3. Explicit distress statement → `severity = high`, `surveyMustBeBlocked = true`
4. Crisis language → `severity = critical`, `immediateResponseRequired = true`
5. Harassment report → `type = harassment`, `severity = high`
6. Post-holiday message after risk signal → signal should expire correctly
