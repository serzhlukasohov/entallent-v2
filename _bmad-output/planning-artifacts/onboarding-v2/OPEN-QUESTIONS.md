---
title: Onboarding v2 — open questions for product clarification
document_type: decision-log
status: living — implementation NOT started; collecting questions first (Illia, 2026-10-04)
language: English (discussion in Ukrainian)
created: 2026-10-04
source_requirements: docs/onboarding-v2.md (branch codex/onboarding-v2, grill-agreed)
secondary_source: https://aipeoplelove.atlassian.net/wiki/spaces/APM/pages/186744838/EP-0+-+Onboarding
related: PR-9-REVIEW-NOTES.md (review of the reverted implementation)
---

# Onboarding v2 — open questions

## How to read this document

The grill document (`docs/onboarding-v2.md`) defines what each role sees and which buttons exist. It is precise about the happy path: a person reads the intro and presses a button. Almost every question below is about what happens **off** that path: when someone types instead of clicking, changes their mind, changes role, or was already talking to Emma before onboarding existed.

These are exactly the places where the first, reverted implementation went wrong, because it filled each gap with a guess. The goal of this list is to get a product answer for each gap before anyone writes code again.

Each question follows the same shape:

- **Context** — what the product does today on `main`, and what the grill document says.
- **Scenario** — a concrete situation that forces a decision.
- **Options** — realistic choices and what each one implies.
- **Decision needed** — the one thing product has to answer.

Confirmed context (2026-10-04): there are no legacy users. Every person enters through hierarchy setup and rollout, so nobody has conversation history, memory, or check-ins before onboarding.

"Grill L<n>" means line n of `docs/onboarding-v2.md`. "Today" means the current `main` branch, before any onboarding v2 code.

Status values: **decided**, **working assumption** (direction chosen, needs product confirmation), **open**, **grill-open** (the grill document itself lists it as unresolved). Priority: **P1** affects architecture or data model, **P2** affects what users experience, **P3** copy, ops, polish.

## Summary

| ID | Question in one line | Status | Priority |
| --- | --- | --- | --- |
| Q1 | Grill document or Confluence, which wins? | decided | P1 |
| Q2 | Can typed text count as pressing a button? | working assumption | P1 |
| Q2a | Does "ok, thanks" from a Manager count as Got It? | open | P2 |
| Q2b | Does telling Emma about a problem count as Let's Talk? | open | P2 |
| Q3 | What does Emma do with messages from people who have not opted in? | open | P1 |
| Q4 | How does an active participant opt out later, when there are no buttons? | open | P1 |
| Q5 | How does someone who declined come back? | open | P2 |
| Q6 | What happens when an old button is clicked? | open | P2 |
| Q8 | What happens when someone is promoted or demoted? | open | P1 |
| Q9 | What happens on deactivation and reactivation? | open | P2 |
| Q10 | Is a Team Lead who pressed Got It ever invited personally? | open | P2 |
| Q11 | Can Managers, HR, HRBP, Leadership have personal conversations? | open | P2 |
| Q12 | When exactly is "after two working days"? | open | P2 |
| Q13 | Does a second Later move the reminder? | open | P3 |
| Q14 | What does the reminder look like? | open | P3 |
| Q15 | Does chatting count as "silence"? | open | P2 |
| Q16 | Calendar changes and public holidays | open | P3 |
| Q17 | Who edits timezone, calendar, and language? | open | P1 |
| Q18 | Can rollout start without a configured calendar? | open | P2 |
| Q19 | Intro in company language, replies in the user's language? | open | P2 |
| Q20 | Can the customer see which named employee declined? | open | P1 |
| Q21 | Is closing internal access to conversations part of onboarding? | open | P1 |
| Q22 | Existing disclosure text promises the opposite of the intro | open | P2 |
| Q23 | One Slack message or two? | open | P3 |
| Q24 | What happens to buttons after a click? | open | P3 |
| Q25 | Is the first Pulse question written by the model or fixed? | open | P2 |
| Q26 | Do buttons work in production Slack today? | open | P1 |
| G1 | What if there is no backlog topic? | grill-open | P2 |
| G2 | Exact reminder time; acknowledgement and reminder texts | grill-open | P3 |
| G3 | Which languages, with which approved translations? | grill-open | P2 |
| G4 | How long is data kept; how is "no human access" verified? | grill-open | release blocker |
| G5 | Default working days and hours | grill-open | P2 |

---

## A. Free text and conversation

### Q1. Grill document or Confluence, which wins? — decided, P1

**Context.** Two sources describe onboarding. The Confluence page EP-0 (edited 2026-10-04) has a "View Sample Report" button for every role, mentions the five-member minimum inside the onboarding texts, and has a longer Team Lead text. The grill document explicitly says not to include sample reports yet (L183), because no real report can exist at company launch.

**Decision (2026-10-04).** The grill document is the source of truth for behaviour and copy. No Sample Report. The five-member rule stays a reporting rule (L28), not onboarding copy. Confluence describes the later vision.

### Q2. Can typed text count as pressing a button? — working assumption, P1

**Context.** The grill document defines buttons only (L63, L81, L97 and so on). It never says what to do when someone types instead. In Slack, many people answer in words rather than clicking. The reverted implementation handled this with a fixed list of phrases ("later", "not now", "давай"...) and exact matching. That caused three bugs: short replies from active users were silently swallowed, "давай" re-enrolled people who had declined, and a natural sentence like "я зараз зайнятий, давай пізніше" was not recognised at all.

**Scenario.** Emma sends the intro on Monday. On Tuesday the employee writes "I'm swamped this week, let's do it later". Nobody pressed Later.

**Options.**

1. *Buttons only.* Text never changes onboarding state. Emma replies like a normal colleague and shows the buttons again. Safest and simplest, but "let's do it later" does not reschedule the reminder; it fires on the original schedule.
2. *Asymmetric (working assumption).* The AI classifies what the person meant. Actions that reduce contact (Later, Decline) can be applied from text when the AI is confident. The action that enrols someone (Let's Talk, Start My Conversation) always needs a click; Emma answers and re-offers the button. Rationale: if the AI is wrong about "later", the person gets one fewer message; if it is wrong about "start", the person is enrolled without consent, which contradicts L17, L20, L161.
3. *Everything from text.* Including enrolment. Most conversational, highest consent risk.

**Decision needed.** Confirm option 2, and whether Emma should confirm before applying ("Got it, I'll check back on Wednesday, OK?") or apply silently.

### Q2a. Does "ok, thanks" from a Manager count as Got It? — open, P2

**Context.** Managers, HR, HRBP, and Leadership only have Got It (L97-L143). Got It enrols nobody in anything; it only marks the introduction as read.

**Scenario.** A Manager reads the intro and replies "ok, thanks, looks useful". No button pressed. Under Q2 option 2, this would be safe to treat as Got It, because it does not grant anything. Without it, the Manager gets a reminder in two days for an intro they clearly read.

**Decision needed.** Can Got It be inferred from an acknowledging reply, or must it be the button?

### Q2b. Does telling Emma about a problem count as Let's Talk? — open, P2

**Context.** Grill L149 says Let's Talk should "allow the employee to bring their own topic instead". Confluence adds "if the employee has already shared a situation, respond to it first". Neither says what happens if the employee shares a situation **without** pressing Let's Talk.

**Scenario.** The intro arrives. Instead of clicking, the employee writes "honestly my lead keeps changing priorities and I'm exhausted". Emma obviously responds supportively. The question is the state afterwards.

**Options.**

1. *Still undecided.* Emma helps with the situation, then gently re-offers Let's Talk. The person is not in recurring check-ins until they click. Consistent with Q2's "enrolment needs a click".
2. *Counts as started.* The person engaged, so onboarding is complete and check-ins begin. Natural, but nobody explicitly agreed to recurring invitations.

**Decision needed.** Is starting a real conversation the same as agreeing to be invited regularly?

### Q3. What does Emma do with messages from people who have not opted in? — open, P1

**Context.** Grill L16 and L161: anyone may message Emma anytime, including after declining. Today every message goes through several processes, each switched on by a feature flag:

- **risk detection** looks for signs of crisis or burnout;
- **private memory** remembers facts the person shared, so Emma does not ask the same things again;
- **Pulse survey evidence** extracts answers to the work-climate questions that later feed anonymised team reports;
- **follow-ups and reminders** let Emma check back on something the person mentioned.

The grill document defines participation as being invited to Pulse conversations, but does not say which of these processes apply to someone who has not opted in.

**Scenario.** An employee pressed "I Don't Want to Participate". A month later they write to vent about a conflict and mention they are not sleeping. Should Emma detect the risk? Remember the conflict next time? Record anything for Pulse? Offer to check in tomorrow if asked?

**Options.**

1. *Risk and memory always; Pulse evidence only after opt-in* (suggested starting point). Safety is a duty of care; memory is private and makes Emma a real colleague (L15); Pulse is the thing they declined.
2. *Risk only until opt-in.* Emma replies but forgets everything between conversations.
3. *Everything except proactive invitations.* Participation only controls whether Emma writes first.

**Decision needed.** Which of the four processes run for undecided people, and which for people who declined? Are those two groups treated the same?

### Q4. How does an active participant opt out later? — open, P1

**Context.** Grill L17: people may decline personal participation and return anytime. Buttons exist only in the intro and the reminder. Once someone pressed Let's Talk, there is no visible way to stop check-ins. The reverted implementation kept the phrase list active forever for this reason, which is what made Emma go silent on "not now".

**Scenario.** An employee joined in October. In December they write "please stop sending me these check-ins". Or, more ambiguous: "I don't really want to do these anymore".

**Options.**

1. *Classified intent.* The AI recognises a wish to stop; Emma confirms with a button ("Stop personal check-ins?"); the click applies it. Consistent with Q2.
2. *A command or settings message.* For example, "settings" returns a message with participation buttons. Predictable, but people must know about it.
3. *Ask a human.* No self-service; support turns it off. Simple, but conflicts with "voluntary, anytime".

**Decision needed.** What is the supported way to stop check-ins after joining?

### Q5. How does someone who declined come back? — open, P2

**Context.** Grill L161: "Accept an incoming conversation anytime; do not require another full introduction. Keep any renewed personal participation explicit." So writing to Emma is fine, but rejoining check-ins needs an explicit act. The document does not say what that act is.

**Scenario.** An employee declined in October. In November they write "actually, can we try those check-ins?". Separately, another declined employee just writes to vent, with no interest in check-ins.

**Options.**

1. *Only on request.* The AI recognises a wish to rejoin, Emma shows a Let's Talk button, the click re-enrols. Nobody who just vents is nudged.
2. *Offer once.* The first time a declined person writes, Emma offers Let's Talk once after replying. Never again.
3. *Offer every time.* Risks feeling pushy, contradicts L17's tone.

**Decision needed.** When, if ever, does Emma offer rejoining to someone who declined?

### Q6. What happens when an old button is clicked? — open, P2

**Context.** Slack keeps old messages and their buttons. Grill L162: "do not duplicate a first conversation or reminder, or silently broaden consent; preserve the corresponding decision." It does not say whether a later click can change an earlier decision.

**Scenarios.**

- The employee pressed Let's Talk on Monday, then on Wednesday scrolls up and presses Later on the same message.
- The employee declined, then presses Let's Talk on the reminder that was already sent.
- The employee pressed Let's Talk, then a week later presses "I Don't Want to Participate" on the intro.
- Double click on the same button.

**Options.** For each: ignore silently, reply "you're already set", or apply the newer click as a change of mind. A reasonable split is: any click that reduces participation is a valid change of mind; a click that enrols after a decline is valid only if it is explicit (Q5); Later after Let's Talk is ignored with a short note; duplicates are ignored silently.

**Decision needed.** Which old clicks count as a change of mind?

## B. State and lifecycle

### Q8. What happens when someone is promoted or demoted? — open, P1

**Context.** The hierarchy supports promoting an Employee to Team Lead and a Team Lead to Manager, and moving people back. Onboarding content is role-specific: a Team Lead's intro explains team reports, a Manager is management-only (L11). The grill document only covers the first onboarding.

**Scenarios.**

- An Employee who joined Pulse in October is promoted to Team Lead in December. They never saw the management introduction.
- A Team Lead who participates personally is promoted to Manager, who in MVP has no personal participation.
- A Manager is moved back to Employee.

**Decision needed.** Does a role change trigger the new role's intro? Does personal participation survive a promotion to Manager, and if not, are their check-ins stopped?

### Q9. What happens on deactivation and reactivation? — open, P2

**Context.** Deactivating a person already cancels their pending first message. Nothing defines what happens if they come back, for example after parental leave or a re-hire.

**Scenario.** An employee declined in October, left in November, was re-hired in March.

**Options.** Keep the old decision; run onboarding again; send a short "welcome back" with the buttons.

**Decision needed.** Does a returning person start onboarding from scratch?

### Q10. Is a Team Lead who pressed Got It ever invited personally? — open, P2

**Context.** A Team Lead has four buttons: Start My Conversation, Got It, Later, No Personal Check-ins. Grill L153 and L171: Got It completes the management part and implies no personal opt-in, and the Team Lead counts as fully onboarded, so the single reminder (L160) does not apply to them.

**Scenario.** A busy Team Lead presses Got It to acknowledge the team-report part and moves on. They never declined personal check-ins; they just did not start them.

**Consequence.** As written, that Team Lead is never invited to personal check-ins again unless they write to Emma first. Their personal state stays "undecided" forever.

**Decision needed.** Is that intended, or should there be one later personal invitation for Team Leads who only pressed Got It?

### Q11. Can Managers, HR, HRBP, Leadership have personal conversations? — open, P2

**Context.** Grill L11: "Manager sees management onboarding only in the MVP." The Manager intro still says "you can discuss a management situation with me". Today, anyone with a Slack link can message Emma, and proactive check-ins go to everyone who has them switched on.

**Scenario.** A Manager writes to Emma about their own burnout, not about their team.

**Decision needed.** For these four roles: may they use Emma for personal support? Do they ever receive proactive check-ins? Is anything they say ever Pulse evidence?

## C. Reminder

### Q12. When exactly is "after two working days"? — open, P2

**Context.** Grill L150, L160: one reminder after two company working days, within working hours. The exact arithmetic is not defined, and G2 says the time of day is not decided either.

**Scenarios.**

- Intro delivered Monday 15:00. Is the reminder Wednesday at opening, Wednesday 15:00, or Thursday?
- Intro delivered Saturday (non-working day). Does the count start Monday?
- Later pressed Thursday 17:55, five minutes before closing. Does Thursday count?
- Is the clock started by delivery of the intro or by the Later click? (L150 suggests Later; L160 suggests delivery for silence.)

**Decision needed.** A precise rule, ideally with two or three worked examples that become test cases.

### Q13. Does a second Later move the reminder? — open, P3

**Context.** Grill L164: one reminder per onboarding, not one per Later click. It does not say whether pressing Later again before the reminder reschedules it.

**Scenario.** Later on Monday (reminder due Wednesday). Later again on Tuesday. Is the reminder now Thursday?

**Decision needed.** Yes, reschedule; or no, keep the first date.

### Q14. What does the reminder look like? — open, P3

**Context.** The reminder text is not finalised (G2). The structure is not defined either.

**Decision needed.** Does it repeat the full intro or just a short nudge? Does it carry the same buttons as the intro?

### Q15. Does chatting count as "silence"? — open, P2

**Context.** Grill L160 says the reminder follows "Silence". It does not address someone who is actively talking to Emma but never pressed a button (see Q2b).

**Scenario.** The employee has been chatting with Emma about a project on Tuesday and Wednesday, never clicked anything. On Wednesday morning a scheduled reminder arrives: "Would you like to continue the introduction?". That feels robotic in the middle of a conversation.

**Decision needed.** Should any conversation cancel or postpone the reminder?

### Q16. Calendar changes and public holidays — open, P3

**Context.** Reminders follow the company calendar (L38-39). Nothing covers changes or holidays.

**Scenarios.** The admin changes working days after reminders were scheduled. A reminder falls on a national holiday.

**Decision needed.** Recalculate scheduled reminders when the calendar changes? Ignore public holidays for MVP?

## D. Company configuration

### Q17. Who edits timezone, calendar, and language? — open, P1

**Context.** Grill L36-38: "Our team enters company data ... Configured in the admin panel." Today there are two admin surfaces:

- the **Company Setup UI**, used by the customer's own Company Admin, who signs in with corporate SSO; it already handles hierarchy import, Slack linking, rollout;
- the **internal dashboard**, used by enTalent staff with an admin key, read-only today and not meant for customers.

**Decision needed.** Who sets these values: our team, the customer's Company Admin, or both? This decides where the settings screen is built and how changes are audited.

### Q18. Can rollout start without a configured calendar? — open, P2

**Context.** G5: there are no default working days or hours. Reminders depend on them.

**Options.** Block rollout until timezone and calendar are set; allow rollout and hold reminders until configured; or agree defaults (which is G5).

**Decision needed.** What happens if someone presses Rollout before configuring the calendar?

### Q19. Intro in company language, replies in the user's language? — open, P2

**Context.** Grill L40-41: the company has a default language, English unless changed; changing the agent's language later is a separate requirement. Today Emma already switches to the language the person writes in.

**Scenario.** The company default is English. An employee answers the English intro in Ukrainian.

**Options.** Emma replies in Ukrainian (today's behaviour) while buttons and the reminder stay English; or Emma stays in English until the separate language requirement exists.

**Decision needed.** Does today's automatic language adaptation stay on during onboarding?

## E. Privacy and access

### Q20. Can the customer see which named employee declined? — open, P1

**Context.** The Company Setup UI already shows the customer's Company Admin a table of first messages with each person's name and delivery status. Grill L177 requires onboarding completion to be distinguishable from delivery, deferral, refusal, and consent, but does not say who can see that. Grill L24 promises conversations are private from managers, HR, and administrators.

**Scenario.** The customer's HR director opens the setup screen and sees "Oleksii — declined", "Maria — deferred twice".

**Why it matters.** Whether someone declined is itself personal information. If a manager can see it, people may feel pressured to join, which undermines "participation is voluntary" (L17).

**Options.** Per-person status visible only to enTalent staff; customer sees only aggregate counts (e.g. "42 joined, 7 deferred, 3 declined"); or per-person for everyone.

**Decision needed.** Who may see individual onboarding decisions?

### Q21. Is closing internal access to conversations part of onboarding? — open, P1

**Context.** Grill L24: conversations and individual responses are not shown to anyone, "including support and administrators", and this must be enforced by access rules, not just written in copy. L30 and G4 say it must be verified before release. Today several internal tools show exactly that data:

- the admin debug view shows the last 50 messages (first 120 characters), private memory, goals, risk signals, and survey answers for any person;
- the per-user insights endpoint shows survey scores and evidence summaries;
- development endpoints show full message history;
- the internal dashboard has a per-person Pulse page built on the insights endpoint.

The reverted implementation closed these inside the onboarding change, which broke the dashboard page.

**Options.**

1. *Inside onboarding.* One change, but it mixes a privacy redesign with a conversation feature.
2. *Separate access-control workstream* that must land before release. Cleaner scope; the onboarding copy must not reach real users until it lands.

**Decision needed.** Where does this work belong, and does onboarding wait for it?

### Q22. Existing disclosure text promises the opposite of the intro — open, P2

**Context.** When Emma asks permission to use an insight today, her explanation says: "Audited internal admin and debugging access is limited to authorized staff." The new intro will say conversations are "not shown to anyone". Both cannot be true at the same time.

**Decision needed.** Change the existing explanation now, or at the same moment as Q21's access change, so text and reality never disagree?

## F. Slack experience

### Q23. One Slack message or two? — open, P3

**Context.** Confluence splits each role's text into "Message Intro" and "Message Trust + Start"; the grill document shows one block. The Employee text is about 200 words.

**Decision needed.** One long message with buttons at the end, or a short intro followed by a second message with the trust part and the buttons?

### Q24. What happens to buttons after a click? — open, P3

**Context.** Slack buttons stay clickable forever unless the message is edited.

**Options.** Replace the buttons with "You chose: Later"; grey them out; leave them (and rely on Q6 rules).

**Decision needed.** Pick one. It also reduces how often Q6 situations happen.

### Q25. Is the first Pulse question written by the model or fixed? — open, P2

**Context.** Grill L149: Let's Talk starts with the first available backlog topic. Today Pulse questions are written by the AI each time, guided by the topic's instructions, so the wording varies.

**Decision needed.** Is an AI-written first question acceptable right after onboarding, or should the very first question be fixed, reviewed copy?

### Q26. Do buttons work in production Slack today? — open, P1

**Context.** Buttons need Slack "interactivity" switched on in the Slack app settings. Production receives Slack events through Socket Mode (see `docs/agent-task-log.md`, 2026-08-28). No button has ever been sent by enTalent, so interactivity has never been tested in production.

**Decision needed.** Who checks and, if needed, changes the Slack app configuration, and when? Any Railway variable change needs explicit approval (AGENTS.md).

## G. Items the grill document itself left open (L189-196)

### G1. What if there is no backlog topic? — grill-open, P2

**Context.** Let's Talk starts with the first available backlog topic (L149). A new company may have none configured.

**Decision needed.** What Emma does instead. The reverted implementation invented "How are things going for you at work?"; that was a guess, not an approved answer.

### G2. Exact reminder time; acknowledgement and reminder texts — grill-open, P3

**Context.** After Later, Decline, or Got It, Emma replies with a short acknowledgement; the reminder has its own text. None of these are written. Overlaps Q12 and Q14.

**Decision needed.** Final copy for each acknowledgement and the reminder, and the time of day the reminder is sent.

### G3. Which languages, with which approved translations? — grill-open, P2

**Context.** Only English copy exists. The admin can choose a default language (L40), but no list is agreed. The reverted implementation invented Russian and Ukrainian paraphrases.

**Decision needed.** The supported list for MVP and who provides approved translations.

### G4. How long is data kept; how is "no human access" verified? — grill-open, release blocker

**Context.** L26: conversations and insights are kept in temporary storage for MVP; duration and deletion are not agreed. L24 and L30: the no-access promise must be verified before release. Related to Q21 and Q22.

**Decision needed.** Retention period, deletion mechanism, and how the access promise is verified (audit, test, external review).

### G5. Default working days and hours — grill-open, P2

**Context.** L43: initial calendar defaults are not specified and must not be inferred. Related to Q18.

**Decision needed.** Either agree defaults or require configuration before rollout.
