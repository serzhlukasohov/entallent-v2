# SDD ledger — plan: docs/superpowers/plans/2026-10-07-onboarding-v2.md

Spec: docs/onboarding-v2.md + docs/onboarding-v2-answers.md (answers win). Scope rule from Illia: implement ONLY onboarding per spec+answers; no push; local commits only.
Assumptions A1–A9 agreed by Illia 2026-10-07. Eligibility change for management roles removed from scope (separate task chip).

## Preflight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1 self | tests vs impl | Kyiv offsets checked (+03 until 2026-10-25, +02 after); Lisbon +01; consistent |
| T1→T2,T4,T8 | WorkCalendar, reminderDueAt, nextWorkingTime(at,cal,tz) | consistent |
| T2 self | Interfaces say get() returns `WorkCalendar & {language}`; code returns WorkCalendar | conflict |
| T2→T8 | OnboardingReminderRecalculator port; T8 says API calls worker via queue `recalculate` | queue names never assigned to a task |
| T3 self | tests vs decideOnboarding code | transitions traced row by row; consistent |
| T3→T4..T9 | OnboardingState/Event/Effect, ACK_COPY, introMessages(role) | consistent after introMessages(role) fix |
| T4→T5,T6,T7,T8 | OnboardingService.apply, OnboardingTurnPort | consistent |
| T4/T7/T8 | `stableId` used in T7,T8 but never created | gap |
| T5→T4 | message-send applies intro_delivered via OnboardingService | T5 after T4: ok |
| T5↔T7 | T5 expects trust metadata `onboardingIntroPart`; T7 produces it | consistent |
| T6 self | survey-evidence gate reads post-apply state | consistent |
| T8↔T9 | both modify proactive-scan sweep | sequential, ok |
| T10 self | aggregates only, folds declined | consistent with Q20 |
| T11 | verification only | ok |

Ruling: CompanyCalendarService.get returns `WorkCalendar | null` (language column fixed 'en', not exposed) — G3 says English only — cost if wrong: trivial type widening later.
Ruling: QUEUE_NAMES.ONBOARDING_ACTION ('onboarding-action') and ONBOARDING_REMINDER ('onboarding-reminder') are added in Task 4 (first enqueuer); worker registers them there — cost if wrong: rename.
Ruling: `stableId(...parts): string` (sha256 → RFC4122-shaped uuid) is created in Task 4 at apps/worker/src/onboarding/stable-id.ts with a unit test; T7/T8 consume it — cost if wrong: none.

## Progress
Task 1: dispatched (BASE dedcd1b, model haiku)
Task 1: implementer DONE 4b76697; review dispatched (sonnet)
Task 1: minor (deferred): fromLocal roll-forward for nonexistent DST time untested
Task 1: minor (deferred): doc comment that calendar.timezone is ignored by nextWorkingTime/reminderDueAt (caller passes tz)
Task 1: minor (deferred): nextWorkingTime throws on empty workingDays (schema guards)
Task 1: complete (commits dedcd1b..4b76697, review clean)
Task 2: dispatched (BASE 4b76697, model sonnet)
Task 2: implementer DONE 4485368; review dispatched (sonnet)
Task 2: minor (deferred): CLI arg() accepts a following --flag as value
Task 2: minor (deferred): CLI lacks --apply/confirm step unlike rollout-legacy-employee.ts
Task 2: minor (deferred): configure tx not serializable; concurrent first configure -> two before:null audit rows
Task 2: minor (deferred): no package.json script entry for CLI
Task 2: ⚠️ integration/migration evidence verified from implementer report (4/4 integration, 0026 applied locally)
Task 2: complete (commits 4b76697..4485368, review clean)
Ruling: Task 3 copy — trust split starts at "Your conversations and individual responses…" (employee, team lead) and "Reports use only…" (manager/hr/hrbp/leadership); button-replacement text = ACK_COPY[key], 'started' = "Let's talk." (Q24 says prefer G2 copy) — cost if wrong: copy edit
Task 3: dispatched (BASE 4485368, model sonnet)
Task 3: implementer DONE 201b951; review dispatched (opus)
Task 3: review Needs fixes — 3 Important (dup Later re-ack Q6; Later-after-reminder leaves buttons Q24; promoted TL Got It dead Q8)
Ruling: stale vs deliberate is decided by buttonsActive — a button-sourced action while buttonsActive=false is stale: start/later/decline/got_it apply Q6 rules only (decline still applies, start after refusal still resumes per Q6 table; later/got_it/start-while-active → no effects). Text-sourced later while deferred still reschedules (Q13). — why: Q6/Q24 together; buttons are removed on every accepted choice — cost if wrong: one ack message more/less.
Ruling: intro_delivered on a non-pending intro (role-change intro) sets buttonsActive=true without scheduling; TL got_it while active & managementAckAt null & buttonsActive → set ack, remove buttons, ack got_it_team_lead; start while active & buttonsActive → remove_buttons('started') + start_conversation (fresh intro, not a duplicate). — Q8 "with Got It" + Q24 — cost if wrong: small.
Ruling: role_changed carries `from`; management→management role change (e.g. hr→manager) emits send_intro('management') (Q8 "other role changes", A7); intro service resolves copy by current role. — cost: one extra intro message.
Ruling: substantive_turn resuming a declined user also sets introStatus 'completed' and completedAt if null (Q2b/Q5 consistency for counts). — cost: none.
Ruling: copy tests assert full strings (minor 6 adopted). Minors 7/8 deferred (Task 8 guards reminder_sent; later-from-declined ack acceptable).
Task 3: minor (deferred): reminder_sent sets 'sent' in any state — Task 8 must guard
Task 3: minor (deferred): Later from declined user acks later_after_reminder (not in Q6 table)
Task 3: minor (deferred): undecided employee promoted to TL keeps old reminder (valid, within budget)
Ruling: stale 'later' while active still emits already_complete — Q6 row 1 explicitly requires the brief explanation — cost if wrong: one short message
Task 3: fix round 1/5 (6 addressed, 0 open; commits 201b951..3f6bfd0)
Task 3: minor (deferred): intro_delivered on non-pending re-arms buttons — callers must emit it only after a message WITH buttons was posted (carry into Task 5/7/9)
Task 3: complete (commits 4485368..3f6bfd0, review clean)
Ruling: Task 4 executes effects through an injected `OnboardingEffectsPort` { replaceIntroActions, sendAcknowledgement, startConversation, scheduleReminder }; Task 4 implements sendAcknowledgement (persist outbound + enqueue message-send), startConversation (enqueue conversation 'check-in' job with onboardingStart:true; processor support lands in Task 7), scheduleReminder (enqueue onboarding-reminder delayed job; processor in Task 8); replaceIntroActions concrete Slack impl lands in Task 5 (Task 4 ships a logging no-op). — why: Slack update port needs Task 5 contract change — cost if wrong: rewire one provider.
Task 4: dispatched (BASE 3f6bfd0, model sonnet)
Task 4: implementer DONE_WITH_CONCERNS 7255659; review dispatched (opus)
Task 4: review Needs fixes — Important: mgmt Got It ack dropped by pulse eligibility in message-send; stop_requested ack double-send; OnboardingModule↔ConversationModule cycle
Ruling: onboarding-originated outbound messages (messageType onboarding_ack, and later onboarding_intro/onboarding_reminder) use an onboarding delivery eligibility in message-send (user active, person lifecycle active, not deleted; no pulse requirement) — G2 management ack is onboarding behaviour, not the general eligibility change that was ruled out of scope — cost if wrong: managers receive onboarding acks only.
Ruling: service sends acks only for events with source 'button' (and system events); all turn-originated events (text actions, stop_requested, substantive_turn) return acks to the orchestrator — Q4 single acknowledgement — cost: none.
Ruling: OnboardingModule must not import ConversationModule; inject MESSAGE_SEND and CONVERSATION queues directly and persist the ack via its own repository; revert OutboxService export if no longer needed — Task 6 makes ConversationModule import OnboardingModule — cost: small duplication of enqueue call.
Ruling: start dedupe key uses `${personId}:${version}`; fix misleading cancel_reminder comment (reminder processor in Task 8 compares dueAt/status).
Task 4: parked — effects are not durable across a crash between commit and effect execution (ack/start lost; reminders recovered by Task 8 sweep) — Ruling: accepted for MVP, documented in code comment — cost if wrong: rare lost ack/start after a worker crash.
Task 4: minor (deferred): ack-only no-ops bump version and write an audit row with from==to
Task 4: minor (deferred): missing conversation/channel account → logged skip only
Task 4: minor (deferred): integration tests skip unless DATABASE_URL exported
Task 4: fix round 1/5 (6 addressed, 0 open; commits 7255659..68cb1dc)
Task 4: minor (deferred): effects service test fakes query chain; module DI test uses hand-built TestModule
Task 4: complete (commits 3f6bfd0..68cb1dc, review clean)
Ruling: Task 5 implements the concrete OnboardingEffectsPort.replaceIntroActions via SlackAdapter.updateMessage (worker), resolving bot token the same way message-send does; message-send applies intro_delivered only for a sent message whose persisted metadata has onboardingIntroPart==='trust' AND non-empty onboardingActions (Task 3 minor) — cost: none.
Task 5: dispatched (BASE 68cb1dc, model sonnet)
Task 5: implementer DONE_WITH_CONCERNS 5e5a90d; controller found: contracts queue.test.ts broken by Task 4 queue additions (pins all queue names) — must be fixed in Task 5 fix round; review dispatched (opus)
Task 5: review Needs fixes — Important: retry-path recordIntroDelivered re-arms buttons / restores old ts; contracts queue.test.ts red
Ruling: recordIntroDelivered runs in one transaction with the state lock: no-op if stored introActionsMessageTs === messageTs; no-op if stored ts is newer (Slack ts numeric compare, same DM channel); otherwise store channel/ts and apply intro_delivered — Q6/Q24 — cost if wrong: none.
Ruling: fix contracts queue.test.ts expected lists (Task 4 regression) in this fix round; add tsx to channel-slack devDependencies; scope the form-urlencoded parser to the interactions route if Fastify allows, otherwise keep global and comment it.
Task 5: minor (deferred): verifyRequest no future-timestamp bound (pre-existing)
Task 5: minor (deferred): updateMessage always sends blocks
Task 5: minor (deferred): no test for linked different-person click
Task 5: fix round 1/5 (4 addressed, 0 open; commits 5e5a90d..5f55f85)
Task 5: minor (deferred): form-urlencoded parser global (commented)
Task 5: complete (commits 68cb1dc..5f55f85, review clean)
Ruling: for turn-originated events the OnboardingService must NOT execute start_conversation (would double-message with the orchestrator reply); it returns `replyStart: true` and the orchestrator opens with the first backlog topic via the existing probe path, or EMPTY_BACKLOG_OPENER verbatim when no topic and the user brought no substance (G1, Q25) — cost if wrong: one missing/extra opener.
Task 6: dispatched (BASE 5f55f85, model opus)
Task 6: implementer DONE_WITH_CONCERNS a81e0eb; review dispatched (opus)
Task 6: review Needs fixes — (g) onboarding failures break reply; (f) active substantive stop → clarify (Q4 violation); declined non-substantive start resumes; opener hint "has not messaged you"; active ambiguous never clarified
Ruling: onboarding read/apply failures degrade to "no onboarding context / no state change, normal reply" with a warning log — reply path must not depend on onboarding — cost: a missed state change on DB error.
Ruling: active + stop_participation → stop_requested regardless of substantive (Q4).
Ruling: declined + start (non-substantive) KEEPS resuming and opening — Q2 ("a clearly equivalent text reply may perform the same action, including starting participation") + Q6 (Let's Talk after refusal resumes) + Q5; A2 covers greetings only, which the classifier labels none; PR-9 bug 1.2 was a context-free regex, here the classifier sees the conversation — cost if wrong: a declined user re-enrolled on a misread "давай"; mitigated by Emma's reply and Q4 stop path.
Ruling: active + ambiguous → clarify (Q2, Q4 "may mean only ending today's conversation, Emma clarifies").
Ruling: text-start opener uses a hint variant reflecting that the user just agreed to start (same probe plumbing); substantive text start suppresses the reactive speculativeProbe on that turn (Q25).
Task 6: minor (deferred): retry after apply commit loses replyStart/replyAck (normal reply instead)
Task 6: minor (deferred): onboardingSignal missing → undefined (handled with ??)
Ruling: substantive active stop → generated reply + "

" + ACK_COPY.decline (Q4 acknowledge) — cost: slightly longer reply
Ruling: substantive Got It (TL/management) also gets its G2 ack appended — G2: 'same responses apply to accepted textual equivalents' — cost: none
Task 6: fix round 1/5 (7 addressed, 0 open; commits a81e0eb..edfe1ec)
Task 6: minor (deferred): errorMessage helper detached a JSDoc from describeLocalTime
Task 6: minor (deferred): ack may follow a confirmation question on the same turn (rare)
Task 6: minor (deferred): live sim gate not run for classifier labels (Task 11)
Task 6: complete (commits 5f55f85..edfe1ec, review clean)
Ruling: Task 7 intro = 2 outbound messages: intro part uses id = org_onboarding_deliveries.id (keeps existing claim/complete/reconciliation logic), messageType onboarding_intro; trust part id = stableId('onb-intro', personId, String(version), 'trust'), messageType onboarding_intro, metadata {onboardingIntroPart:'trust', onboardingActions}, enqueued only after the intro part is delivered (ordering, Q23) — cost: small chaining code in message-send.
Ruling: button start check-in uses the Task 6 `afterUserStart` hint and same opener rules (backlog probe or EMPTY_BACKLOG_OPENER verbatim; disclosure append unchanged per A9).
Task 7: dispatched (BASE edfe1ec, model sonnet)
Task 7: implementer DONE 4f053a6; review dispatched (opus)
Task 7: review Needs fixes — start check-in not retry-idempotent; opener skips disclosure (A9 deviation); no participation re-check at job time; stranded trust message no recovery
Ruling: A9 holds — EMPTY_BACKLOG_OPENER stays verbatim as the message body but the existing reporting-disclosure append rule applies after it (both button path and Task 6 text path) — A9 agreed by Illia — cost: longer first message for Pulse users without a delivered disclosure.
Ruling: onboardingStart check-in idempotent via deterministic outbound id stableId('onb-start', personId, dedupeKey) with existing-message short-circuit; re-check onboarding participation === 'active' at execution, else skip.
Ruling: dispatch tick also sweeps "intro part sent, trust part unsent" (per-row try/catch) and enqueues the trust via enqueueTrustAfterIntro — Q23 buttons must appear — cost: one extra query per tick.
Task 7: minor (deferred): no-MAF regression is a source-text regex
Task 7: minor (deferred): dev channel never activates buttons (no Slack ts)
Task 7: minor (deferred): dispatchPending intro enqueue has no jobId (claim makes it harmless)
Task 7: minor (deferred): BullMQ ':' jobId fragility — consider shared helper
Task 7: fix round 1/5 (4 addressed, 0 open; commits 4f053a6..5728251)
Ruling: trust-recovery sweep must only release the trust of the person's NEWEST onboarding_intro (no newer intro message exists) — superseded intro must never resend old-role buttons — cost: none. Participation guard on sweep not added (undecided people need their buttons) — parked as minor.
Task 7: minor (deferred): sweep may send buttons to someone who declined by text before trust delivery (stale clicks are no-ops)
Task 7: fix round 2/5 (1 addressed, 0 open; commits 5728251..2a2c32b)
Task 7: minor (deferred): supersession ordering by app-clock occurred_at; newer unsent intro also supersedes
Task 7: complete (commits edfe1ec..2a2c32b, review clean)
Ruling: reminder message id = stableId('onb-reminder', personId, introActionsMessageTs ?? 'none') — one reminder per onboarding (per intro), A6 fresh budget after manager→employee — cost: none.
Ruling: API provides ONBOARDING_REMINDER_RECALCULATOR as a BullMQ producer adding job 'recalculate' {tenantId} to ONBOARDING_REMINDER; the worker reminder processor handles both 'remind' and 'recalculate'.
Task 8: dispatched (BASE 2a2c32b, model sonnet)
Task 8: implementer DONE_WITH_CONCERNS 7cea54b; review dispatched (opus)
Task 8: review Needs fixes — sweep canonical jobId deduped against retained original (recovery ineffective, plan-mandated); configure surfaces recalc queue error after commit
Ruling: postpone/requeue moves the row's reminder_due_at (compare-and-set on old value) to the next attempt time and enqueues the canonical id for the NEW dueMs; sweep enqueues with `onb-rem:${pid}:${dueMs}:sweep:${hourBucket}` (≥1 extra job/hour per stuck row; row lock guarantees one send) — supersedes earlier "canonical jobId" ruling — cost: hourly retry noise for stuck rows.
Ruling: configure catches recalculator errors after commit: logs, returns success with `recalculation: 'failed'`; CLI prints a warning and exits 0 — cost: operator must re-run to recalc.
Ruling: message-send re-check for onboarding_reminder also requires track !== 'management' (promotion race).
Task 8: minor (deferred): non-durable send enqueue after reminder_sent commit (same as acks)
Task 8: minor (deferred): no-conversation no-op only logged
Ruling: CLI is the only operator path (A4) — it must wire BullOnboardingReminderRecalculator (REDIS_URL) so Q16 recalculation happens; fix round 2 — cost: CLI needs Redis reachable (warning if not)
Task 8: fix round 1/5 + round 2/5 (4 addressed, 0 open; commits 7cea54b..aa416fb)
Task 8: minor (deferred): recalculation resets postponeCount
Task 8: complete (commits 2a2c32b..aa416fb, review clean)
Ruling: Task 9 system events reuse QUEUE_NAMES.ONBOARDING_ACTION with a discriminated job `{ kind:'system', tenantId, personId, event:{type:'role_changed',from,to} | {type:'deactivated'} }` (button jobs get `kind:'button'`, default when missing for backward compat); jobId `onb-sys:${personId}:${auditLogId}` (≥2 ':' for BullMQ); send_intro effect executed by the worker service via OnboardingIntroService.sendIntro(role = people.primary_role, version = post-commit version); reconciliation sweep compares trackForRole(people.primary_role) with state.track only (management↔management role changes not reconciled — acceptable).
Task 9: dispatched (BASE aa416fb, model sonnet)
Task 9: implementer DONE 1d134c6; review dispatched (opus)
Task 9: review Needs fixes — sweep/job race sends duplicate management intro; reviewer found Task 8 regression: reminder sweep jobId has 5 ':' segments → BullMQ rejects every sweep enqueue
Ruling: role_changed apply guard under row lock: skip when stored track already equals trackForRole(to) AND trackForRole(from) !== trackForRole(to) (already applied); sweep re-checks mismatch under lock (beforeDecide) — cost: none.
Ruling: fix Task 8 sweep jobId inside Task 9 fix round (cross-task): use a BullMQ-valid id (exactly 3 ':' segments or none) and add one test asserting every onboarding job-id builder passes BullMQ's real custom-id validation; add ORDER BY to the role-reconcile sweep.
Task 9: fix round 1/5 (2 addressed, 0 open; commits 1d134c6..3c9e032)
Task 9: minor (deferred): @Optional OnboardingEventPublisher could silently drop events on wiring regression
Task 9: minor (deferred): role intro persisted (not delivered) for person deactivated right after role change
Task 9: complete (commits aa416fb..3c9e032, review clean)
Task 10: dispatched (BASE 3c9e032, model sonnet)
Task 10: implementer DONE 2662b48; review dispatched (sonnet)
Task 10: minor (deferred): summary tests mapping-only (membership, inactive exclusion, dedupe, exact-5 boundary untested)
Task 10: minor (deferred): completed=0 / completed=size in a unit of 5 is informative (accepted by A5 as written)
Task 10: complete (commits 3c9e032..2662b48, review clean)
Task 11: dispatched (BASE 2662b48, model sonnet)
Task 11: implementer DONE_WITH_CONCERNS 46e3582..8d3dcf7 — live sim gate found REAL regression from Task 6: pulse-capture-exact-message fails 3/3 at HEAD, passes 3/3 at base (classifier puts pulse_capture_explanation into dialogueAct → schema parse failure; suspect classify.ts schema block edit). memory-recall, annna-intent-fidelity, terse-user fail at base too (pre-existing).
Ruling: regression is load-bearing (our change broke an existing classifier path) → fix now via Task 6 implementer (owns classify.ts change), verify with the live scenario 3x at HEAD; release checklist blocker line removed once fixed.
Task 6/11: regression fixed 762d347 (pulse-capture 12/12 live). Ruling: run a live classifier check WITH onboarding context before final review (the real user path) — via a live sim scenario consistent with existing live scenarios — cost: a few model calls.
Task 6/11: live onboarding classifier check 10/10 x2 after label-definition tuning (d62431a, 86d9fe6); pulse-capture 3/3
Task 11: minor (deferred): declined "дякую" labelled acknowledge (outcome still no state change; test accepts none|acknowledge)
Note: survey-evidence.use-case.test.ts intermittent — pre-existing (base fixture fix 25ef21a was reverted in 860515d); outside onboarding scope
Task 11: review dispatched (range 2662b48..HEAD, sonnet)
Task 11: minor (deferred): docs/agent-task-log.md Task 11 row stale (says regression open) — fix in final wave
Task 11: complete (commits 2662b48..86d9fe6, review clean)
Final review: dispatched (opus, range dedcd1b..86d9fe6)
Final review: With fixes — Critical: role change to management keeps reminderStatus 'sent' → DB CHECK violation (Q8 broken, reconcile sweep clogged). Important: intro dispatch without calendar → dead buttons + failing loop; adopted users w/o participation still get proactive check-ins; ack shown twice (replacement + message).
Ruling: role change into management sets reminderStatus = pending ? 'cancelled' : 'none'; decider + PG test.
Ruling: dispatchPending holds (skips) deliveries for tenants without a work calendar; `schedule_reminder` with no calendar logs error and schedules nothing instead of throwing (defence).
Ruling: proactive scheduler also requires (no onboarding_states row OR participation = 'active') — participation invariant holds regardless of the users flag.
Ruling: ack duplication — Q24 "replace [buttons] with a short acknowledgement… use G2 copy where applicable": button click → buttons replaced with the G2 ack, NO separate ack message; text choice → Emma's reply is the G2 ack and the buttons are replaced with the short Q24 phrase ("We'll talk later." / "I won't start conversations unless you message me first." / "Introduction complete." / started: "Let's talk.") — cost if wrong: copy change only; flagged to Illia.
Ruling: intro_delivered on a non-pending state re-arms buttons only for role-change intros (trust metadata flag); TL Later while active with buttons armed also removes buttons; ORDER BY in reminder sweep (reminder_due_at) ; fix misplaced JSDoc; update agent-task-log rows.
Final review: deferred (not fixed): replacement uses current role in a short window (Task 9 race); duplicate ack for text Later right after button Later (Q13 defensible); all other ledger minors per reviewer triage "can wait".
Final fix wave: dispatched (opus, BASE 86d9fe6)
Final fix wave: DONE 86d9fe6..2ae20db; scoped re-review dispatched (sonnet)
Final fix wave: re-review all 9 addressed; complete
# SDD ledger — plan: docs/superpowers/plans/2026-10-08-onboarding-dev-console.md
Approved by Illia 2026-10-08 (dev tooling for local testing). Preflight: single task, no cross-task interfaces; clean.
Task 1: dispatched (BASE 14f419e, model opus)
Task 1: implementer DONE 7ac3644 (smoke ok); review dispatched (opus)
Task 1: minor (deferred): replaceIntroActions dev branch not env-gated; ':' in userId → 500 on /click; epoch-second version (int4 until 2038); eligibility ternary maps non-dev to slack; smoke residue on local tenant
Task 1: complete (commits 14f419e..7ac3644, review clean)
