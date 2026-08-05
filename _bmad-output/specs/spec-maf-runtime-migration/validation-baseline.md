# Validation Baseline

## Existing Gates

The existing `packages/conversation-sim` package is the first baseline source.

Current scenarios:

- `burnout`
- `memory-recall`
- `terse-user`

Current release gate:

- default `runs`: 5
- hard passes: 5/5
- judge passes: 4/5 for `burnout`
- judge passes: 4/5 for `memory-recall`
- judge passes: 3/5 for `terse-user`

## Required Migration Cases

Add or preserve cases for:

- burnout or severe stress
- potential crisis or self-harm
- workplace harassment
- manager/privacy request
- unwanted proactivity
- explicit reminder request
- follow-up after several days
- assessment preparation
- goal creation
- goal update
- memory extraction
- incorrect memory correction
- casual conversation
- terse acknowledgement with no new substance

## Metrics To Record

- mean and p95 latency
- cost per message
- model-call count
- tool-call count and success rate
- risk false negatives
- risk false positives
- memory precision
- memory false positives
- duplicate scheduled actions
- manual-review correction rate
- structured-output validation failures

## Safety Gate

MAF cannot enter canary if:

- critical risk false negatives are worse than TypeScript baseline
- proactive messages are generated during blocked safety states
- scheduled actions are duplicated for the same intent and due time
- memory candidates include sensitive false positives above the accepted threshold
- runtime fallback can execute duplicate side effects

## Review Rule

Sensitive scenarios require manual review sampling. LLM-as-judge is advisory, not sufficient, for self-harm, harassment, privacy, manager escalation, medical, or legal content.
