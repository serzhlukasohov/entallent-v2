---
name: qa-screenshot-to-test
description: Turns a Slack screenshot of a bad enTalent bot reply into a reproducible sim QA test. Finds the traced conversation and turn through the admin API (pnpm trace:export), shows why the bot answered that way (classification, reply plan, inputs, writes, queues, warnings), extracts the precondition and test draft, and helps QA write expected results and hard checks. Use when QA shares a screenshot of a Slack conversation with the bot, or says "screenshot to test", "bug from Slack", "why did the bot answer this", "скріншот", "баг з слаку", "бот відповів не так", "зроби тест зі скріншота", "чому бот так відповів".
allowed-tools: Read(packages/conversation-sim/qa-tests/**), Read(packages/conversation-sim/preconditions/traced/**), Read(runs/trace-exports/**), Edit(packages/conversation-sim/qa-tests/drafts/**), Bash(pnpm -s trace:export:*), Bash(pnpm -s sim:qa:promote:*)
---

# Screenshot to QA test

QA gives a Slack screenshot (and maybe a pointer to the bad reply). You find that turn in the production
trace, explain it, and leave a finished test in `packages/conversation-sim/qa-tests/`. QA supplies no ids.
Talk to QA in their language (usually Ukrainian); files stay in English unless QA writes the expected
results in another language.

## Hard rules

- Trace data comes **only** from `pnpm -s trace:export -- ...` (admin API: tenant-scoped, audited). Never
  `psql`, Drizzle, SQL, `DATABASE_URL`, `curl` to the API, or reading `.env`. Never run `env`, `printenv`,
  `echo $ADMIN_API_KEY` or anything that prints a key. If the CLI says a variable is missing, tell QA which
  one to set; do not look for its value.
- Never run `pnpm sim`, `sim:gate`, `sim:record --live`, `harness:check` or any vitest scenario: they call
  the model. Give QA the run command instead.
- Always pass `-s` to pnpm and `--json` to the CLI: stdout is then exactly one JSON document. A non-zero
  exit means a usage error, an API refusal or an unreachable API; its stderr line is the answer to relay.
- Never pass `--out` or `--qa-tests`: the defaults keep files where they belong.
- Quote fragments with single quotes; write an apostrophe as `'\''`.
- `runs/trace-exports/` holds conversation text: never copy it elsewhere or commit it.

## 1. Tenant

`TRACE_TENANT_ID` is the default tenant. If the CLI answers `--tenant <uuid> (or TRACE_TENANT_ID) is
required`, ask QA once for the tenant id and add `--tenant <uuid>` to every later call in the session.

## 2. Read the screenshot

Transcribe every visible message in order as `bot:` / `employee:` with its text (the bot is the app with
the APP badge). Note which bot reply QA marked (arrow, circle, highlight, or their words). Do not ask yet.

## 3. Find the conversation

Pick 2-3 fragments (always at least 2, so the answer is grouped), employee messages first: 3-8 consecutive words each (at least 3 characters, or the API rejects the whole call), from different messages, no emoji,
names, numbers, links or quote marks (OCR and Slack formatting change them). Then:

```bash
pnpm -s trace:export -- --json --search 'fragment one' --search 'fragment two' --search 'fragment three'
```

The answer ranks `conversations` by `fragmentsHit`. Decide:

- One conversation hit by all or most fragments, clearly ahead (`conversations[0].tiedWithNext` is false): the candidate.
- Several tied (`tiedWithNext` true): show each (last match time, snippets) and ask QA which one; never pick silently.
- None: retry once with shorter fragments, a bot-reply fragment and `--days 30`. Still none: stop and explain
  the likely causes: tracing (`conversation_trace` flag) was off for the tenant then, the turn is older than
  the 30-day retention, the tenant is wrong, or the API runs without `CONVERSATION_TRACE_ADMIN_ENABLED`.
- `complete: false` means a scan was cut (`scanStopped`): say so. On `match_limit` rerun with `--limit 50`, since a
  generic fragment can crowd out the right conversation; on `row_limit`/`time_limit` narrow with `--days`.

## 4. Confirm and pick the turn

```bash
pnpm -s trace:export -- --json --no-html --conversation <conversationId>
```

`turns[]` lists traced turns oldest first with `employee`, `bot`, `traceRowId`. Confirm the screenshot's
messages appear in the same order (allow OCR differences; turns before tracing was enabled are absent). If
older screenshot messages are missing, rerun with `--turns 200` first (the export keeps the latest 100
turns). If they still do not line up, go back to step 3 with other fragments or ask QA.

The turn is the one whose `bot` text is the reply QA marked. If QA marked none, or two turns fit, list the
bot replies from the screenshot as a numbered list and ask which one is wrong. Refer to turns by their bot text or `traceRowId`, not by `step` (the HTML labels count differently). A turn
with `traceRowId: null` cannot be extracted; one with `missing: true` may still be: try step 6 and relay
the API's refusal if it comes.

## 5. Show the trace

```bash
pnpm -s trace:export -- --json --conversation <conversationId> --turn <traceRowId>
```

Give QA the `reportHtml` path (the full conversation page, same as a sim report; `open <path>` on macOS) and
summarise `detail` for the chosen turn in a few lines each: what the classifier understood, conversation and
pulse-cycle state, reply plan (move, question policy, forbidden moves), response inputs (memory, goals,
topic or probe question), writes and queued jobs, warnings, errors and badges. Then say, as a hypothesis
labelled as such, which input or decision most likely produced the bad reply. Values cut with
`[cut; ...]` are complete in `reportJson`; read only the part you need from there.

## 6. Extract the test draft

```bash
pnpm -s trace:export -- --json --extract <traceRowId>
```

It writes `preconditionPath` (`preconditions/traced/trace-<id>.json`) and `draftPath`
(`qa-tests/drafts/trace-<id>.json`) and returns `gaps`: state the precondition could not hold. Tell QA the
gaps that matter for this bug. Refusals: see [reference.md](reference.md#refusals). If the files already
exist, ask QA before rerunning with `--force`.

## 7. Finish the draft with QA

Read the draft. Keep `schemaVersion`, `precondition` and `replies` as they are. Then, with QA:

- `title`: the expected behavior, one line.
- `expected`: propose 1-3 lines from QA's complaint, each one observable behavior of the reply, phrased as
  what should happen (the bug's opposite), no internal terms. QA confirms or rewrites; use their words.
- `hardChecks`: propose only checks that catch this bug, from the menu in
  [reference.md](reference.md#hard-checks); omit the field when none fits.
- `jira`, `story`, `tags`: ask once; omit what QA does not give.

Write the edits into the draft, show the final JSON, and when QA agrees:

```bash
pnpm -s sim:qa:promote packages/conversation-sim/qa-tests/drafts/<name>.json
```

It validates the test like the runner does and moves it to `qa-tests/<name>.json`; on an error, fix the
draft and rerun. Finish by giving QA the printed run command (it calls the model, so QA runs it) and
reminding them the test should fail while the bug exists. The precondition and test files are test-tenant
fixtures meant for a PR; the export under `runs/` is not.
