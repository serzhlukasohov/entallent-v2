# Reference

## Hard checks

Menu v1 (`packages/conversation-sim/qa-tests/README.md`). The draft has one reply, so `turn` is `1` or omitted.

| Bug QA reports | Hard check | Expected line to pair with it |
|---|---|---|
| Bot asked a question when it should not have | `{ "check": "no-question" }` | "The reply does not end with a question" |
| Bot pushed a pulse/check-in/survey question at a bad moment | `{ "check": "no-pulse-question" }` | "The reply does not ask a pulse topic or survey question" |
| Bot forgot or did not save something the employee said | `{ "check": "memory-contains", "text": "<distinctive words>" }` | "The reply acknowledges <the fact>" |
| Bot escalated a harmless message, or missed a risky one | `{ "check": "escalation", "raised": false }` or `true` | "The reply stays supportive without treating it as a safety risk" |
| Reply too long | `{ "check": "reply-under", "chars": 600 }` | "The reply is short and answers only what was asked" |

`memory-contains` passes on precondition memory too: pick text the precondition does not already hold.
Anything else (tone, wrong topic, wrong facts, ignored request) goes into `expected` only; the judge checks it.

Good `expected` lines: one behavior each, observable in the reply text, phrased positively where possible.

- Good: "The reply answers the question about the deadline before anything else"
- Bad: "classifier returns primaryIntent=question" (internal), "the reply is good" (not checkable),
  "doesn't do X and Y" (two behaviors: split it)

## Refusals

| CLI stderr shows | Meaning | Tell QA |
|---|---|---|
| `403 ... not_test_tenant` | tenant lacks the `conversation_trace_test_tenant` flag | only test tenants may become fixtures; an admin marks it (README, "A test from a traced production turn") |
| `403 ... traced_before_test_mark` | turn traced before the tenant was marked | reproduce the bug again in Slack, then repeat |
| `404 ... trace_not_found` | id not in this tenant | wrong tenant, or the trace was purged (30 days) |
| `409 ... trace_state_not_captured` | turn traced before state capture existed, or cut to fit | reproduce the bug again in Slack |
| `409 ... trace_payload_unreadable` | cannot decrypt or parse | report to a developer |
| `409 ... trace_user_message_missing` | no employee text in the trace | cannot become a test |
| `404` on every call / `cannot reach` | admin routes off or API down | API needs `CONVERSATION_TRACE_ADMIN_ENABLED=true`; check `TRACE_API_BASE` |
| `401`/`403` without a code | wrong or missing admin key | set `ADMIN_API_KEY` in `.env` (do not paste it in chat) |
