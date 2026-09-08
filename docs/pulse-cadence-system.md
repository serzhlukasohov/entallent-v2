# Pulse Cadence System — Product Owner Guide

## What it is

The system automatically messages every employee once every 3 days — one short Slack message with an embedded question. Questions come from the employee's personal backlog and cover four themes: autonomy, belonging, growth, purpose.

The goal is to collect data across all four themes over the quarter without overloading the employee.

---

## What an employee's backlog looks like

Each employee has **12 questions** per quarter in a fixed order:

```
Autonomy (3 questions) → Belonging (3) → Growth (3) → Purpose (3)
```

The system works through them one at a time. The next question is only surfaced after the previous one is closed or ignored.

Plus **3 engagement questions** that activate in the last 14 days of the quarter.

---

## Question lifecycle

```
Pending → Sent → Closed
              ↓
         (48h with no reply)
              ↓
         Pending (moves to the back of the queue)
```

A question is considered **closed** in two cases:
- The employee **answered** the question in a conversation with the AI — the system records this itself
- The employee **raised the topic themselves** in any conversation without a proactive question (cross-pollination)

It is considered **ignored** if 48 hours pass with no message at all. The question moves to the back of the queue.

---

## How to test via Slack

### What you need before starting

- A test user connected to the Slack workspace
- API access (Postman / curl)
- The dashboard open at `/pulse`
- The `tenantId` of the test company

---

### Scenario 1: A proactive message arrives and the employee replies

**Step 1 — Trigger a check-in right now**

Instead of waiting 3 days, run the scheduler manually:

```http
POST /dev/simulate-proactive-scan
Content-Type: application/json

{ "tenantId": "<company id>" }
```

Within a few seconds the test employee receives a message in Slack from the AI mentor.

**Step 2 — Read and reply in Slack**

Open Slack as the test employee. A message roughly like this should arrive:

> *"Hey! I wanted to ask — how much do you get to choose how you approach your tasks? Do you feel you can work in the way that suits you best?"*

Reply in some detail, 2–3 sentences. The system should recognize the reply as relevant.

**Step 3 — Check the dashboard**

Open `/pulse`, find the test employee. Within 10–20 seconds of the reply:
- The `closed` counter should increase by 1
- `Next question` should change to the next one in the queue

**What we're checking:**
- ✅ The message arrived in Slack
- ✅ The message contains a concrete question (not a generic greeting)
- ✅ After the reply, progress updated on the dashboard
- ✅ The next question is from the same group or the next one in order

---

### Scenario 2: The employee ignores it (ignore flow)

**Step 1** — Trigger a check-in (as in Scenario 1), confirm the message arrived.

**Step 2** — Don't reply. Ask a developer to move `proactive_sent_at` 49 hours into the past in the DB for the test user.

**Step 3** — Run it again:

```http
POST /dev/simulate-proactive-scan
{ "tenantId": "<company id>" }
```

The scheduler will allow the ignore and pick up the next question.

**Step 4** — Within a few seconds a new message arrives — with a different question.

**What we're checking:**
- ✅ A second question arrived, not the same one
- ✅ On the dashboard: `ignored: 1`
- ✅ The first question is still in the queue (it moved to the back, but didn't disappear)

---

### Scenario 3: The employee raises the topic themselves (cross-pollination)

The employee messages the AI mentor on their own, without a proactive question, but talks about something related to a theme from the backlog.

**Step 1** — Message in Slack as the test employee, something like:

> *"Listen, lately I feel like I don't really understand why I'm doing this work at all. Lost the meaning a bit."*

This touches the **purpose** theme.

**Step 2** — Wait 15–20 seconds.

**Step 3** — Check the dashboard:

**What we're checking:**
- ✅ If a `purpose` question was in the backlog → it is marked `closed` without a proactive message
- ✅ The `closed` counter increased
- ✅ The AI replied in Slack (showed it heard, didn't ignore)

---

### Scenario 4: Multiple employees, each with their own progress

Trigger a check-in twice with different `tenantId`s, or make sure one company has several employees.

**What we're checking:**
- ✅ Each employee has their own counter on the dashboard
- ✅ Questions may differ (depends on where each of them is in the backlog)
- ✅ One employee's reply doesn't affect another's progress

---

### Scenario 5: End of quarter — engagement questions

This scenario needs a developer to move the quarter-end date closer. Engagement eligibility is fixed to the inclusive final 14 days of the survey window.

**What should happen:**
- Regular questions stop being sent
- 3 engagement questions arrive as direct 0–10 rating questions about engagement and intent to stay

**What we're checking:**
- ✅ The question topic differs from the regular ones (more direct, about a sense of belonging to the company)
- ✅ After the 3 engagement questions the system returns to the regular ones (if any are pending)

---

## Acceptance checklist

| # | What to check | How to trigger | Expected result |
|---|--------------|--------------|---------------------|
| 1 | Message arrives in Slack | `simulate-proactive-scan` | A message with a question in Slack |
| 2 | Question matches the group | Look at the text in Slack | A question about autonomy, if it's the first |
| 3 | A reply closes the question | Reply in Slack | Dashboard: +1 closed |
| 4 | Ignore → next question | Don't reply for 48h → scan | New question, `ignored: 1` |
| 5 | Cross-pollination | Write about the topic without a question | Question closed automatically |
| 6 | Theme order | 3 check-ins in a row | autonomy → belonging → ... |
| 7 | Backlogs are independent | Two employees | Different counters for each |

---

## Per-company settings

| Parameter | Default | Description |
|----------|-------------|----------|
| `ignoreWindowHours` | 48 hours | How long to wait for a reply before counting it as ignored |

To change this — ask a developer to update `proactive_messaging_policy` for the company in question. The engagement window is a fixed product rule and is not tenant-configurable.

---

## What to do if something's off

**Message didn't arrive in Slack** — check that the test user has an active survey window and a connected Slack workspace. Without an active window the backlog isn't initialized.

**A generic greeting arrived without a question** — the backlog probably wasn't initialized. Ask a developer to check `pulse_backlog` in the DB for this user.

**Progress isn't updating on the dashboard** — make sure the survey window is active (`status = 'active'`). The backlog is only shown on the dashboard for the active quarter.

**The same question keeps arriving** — the ignore window (48h) hasn't passed, the system is still waiting. Ask a developer to move `proactive_sent_at` back.
