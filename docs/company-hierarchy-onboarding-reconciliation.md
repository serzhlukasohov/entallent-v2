# Company hierarchy first-contact reconciliation

Rollout stores one durable first-contact intent per Person. A `sending` intent means the worker claimed it before calling Slack. If the Slack call or receipt write was interrupted, sending the message again may duplicate an accepted DM.

## Read-only inventory

Identify the tenant and database environment before running the command. Keep its JSON output with restricted access; it includes Person and delivery IDs and may include a Slack timestamp. It does not include message text or credentials.

```sh
TENANT_ID=<tenant-uuid> DATABASE_URL=<target-database-url> \
  pnpm --filter @entalent/api company-onboarding:reconcile \
  > /secure/location/onboarding-sending-report.json
```

The command reads a consistent snapshot. `db_receipt_ready` means the outbound message has the same delivery ID, tenant, Person, Slack conversation, onboarding marker, persisted send time, and Slack message timestamp. `manual_slack_verification_required` means those database facts are incomplete. This classification does not query Slack.

## Reconcile a persisted receipt

Review the target database and dry-run output first. The apply command updates only `db_receipt_ready` intents to `delivered`, preserves the recorded timestamp, and writes an operator audit event in the same transaction. It does not resend messages or alter intents that lack proof.

```sh
TENANT_ID=<tenant-uuid> DATABASE_URL=<target-database-url> \
  OPERATOR_ID=<operator-id> CONFIRM_ONBOARDING_RECONCILIATION=<tenant-uuid> \
  pnpm --filter @entalent/api company-onboarding:reconcile --apply \
  > /secure/location/onboarding-reconciliation-apply.json
```

Re-run the read-only inventory after apply. A repeat apply should report `applied: 0` for already reconciled rows.

## Missing database receipt

Leave `manual_slack_verification_required` in `sending`. Inspect the exact DM and Slack delivery history with an authorized operator before deciding whether a message was accepted. The current script has no override or retry for this case. Record the Slack evidence and decide the follow-up with the customer; never reset `sending` to `pending` on the basis of a timeout alone.
