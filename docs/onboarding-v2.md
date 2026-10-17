# Onboarding v2 — agreed product requirements

Status: requirements agreed through the product discussion; implementation is a separate task. This document records the user’s decisions. Earlier v1 documents are reference material, not instructions to implement their flows.

## Goal and scope

Provide the minimum introduction each role needs to understand Emma, trust the privacy boundary, and take its first relevant action. Avoid mandatory configuration and features that do not exist yet.

Six roles: Employee, Team Lead, Manager, HR, HRBP, Leadership. Roles are assigned by our team while entering company and employee data, using the company hierarchy. Users do not choose their roles during onboarding. Our team initiates company onboarding after setup.

Employee sees personal onboarding. Manager sees management onboarding only in the MVP. Team Lead combines personal and management introductions; their personal participation must not determine their access to team reports. HR, HRBP, and Leadership receive information relevant to their area of responsibility.

## Shared requirements

- Employee experiences Emma as a sensible colleague / working companion, who listens and helps them feel heard, supported, comfortable, and safe at work.
- Employee can initiate a conversation anytime, including when they need to vent. Emma can support almost any topic while tending toward the work topics in her backlog. Do not promise that conversations are limited to surveys.
- Participation is voluntary. Users may skip questions, postpone conversations, decline personal participation, and return anytime by messaging Emma.
- Manager and Team Lead experience Emma as a co-pilot in team management: management becomes learnable by doing.
- HR roles receive qualitative context alongside numbers, earlier visibility into emerging problems, and practical recommendations.
- Onboarding completion is separate from permission to use conversation insights. Clicking an onboarding action never grants reporting consent.

## Privacy and trust

Conversations and individual responses are not shown to anyone, including managers, Team Leads, HR, HRBP, Leadership, support, and administrators. Access requirements must enforce this promise; it is not merely copy.

For the MVP, conversations and insights are collected in temporary storage. Storage lifetime and deletion details have not been agreed in this discussion; specify them before release without inventing a duration here.

Before any insight can be used in analysis, reports, or management recommendations, ask the employee for explicit permission. Without approval, it cannot be included. Approved insights must be fully anonymized and aggregated into Team Signals so recipients cannot identify the contributor. A team report requires permission from at least five team members. Meeting this minimum does not replace the anonymity requirement.

Recipients see shared signals and recommendations within their responsibility, never transcripts or individual responses. Consent, anonymization, reporting safety, and access controls must be verified before product release.

## Company configuration and launch

| Setting / prerequisite | Requirement |
| --- | --- |
| Company and employee setup | Our team enters company data and employees and assigns the six roles before initiating rollout. |
| Launch | Our team initiates onboarding for each company. |
| Timezone | Configured in the admin panel; used for reminder scheduling. |
| Working days and hours | Configured in the admin panel; reminders respect this calendar. |
| Default agent language | Configurable by the administrator; English is the MVP default unless changed. |
| Language adaptation | Later agent language changes are a separate requirement, to be described by the user. |

The supported language list, initial calendar defaults, and exact reminder send time within working hours are not specified here. They must not be silently inferred from this document.

## Final onboarding messages (English)

### Employee

Hi! I'm Emma 👋 Your virtual colleague — someone who's here to listen, help you work through a situation, or give you space to vent.

You can message me anytime: about a difficult day, relationships with colleagues, something that makes you happy or worries you, or anything else you'd like to talk about. I'll listen and help you think things through if that's what you need.

Sometimes I'll also invite you to a short conversation about how things are going at work. These conversations help us understand what makes your work environment more comfortable and where support is needed.

Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to your manager on how to improve team management.

You decide which insights you're comfortable sharing. Without your approval, they won't be included in reports or recommendations.

Participation is voluntary: you can skip a question, postpone a conversation, or opt out. You can come back anytime — just message me as you would a familiar colleague.

Shall we talk about how things are going at work? You can also start by telling me what's on your mind.

Actions: **Let's Talk** · **Later** · **I Don't Want to Participate**

### Team Lead

Hi! I'm Emma 👋 Your virtual colleague and AI co-pilot for team management.

You can talk to me about your own experience at work, work through a situation, or simply vent. Message me anytime — about work or anything else that's on your mind.

As a Team Lead, you'll also receive shared signals about your team and recommendations. I'll help you choose your next step, prepare for a conversation, and reflect on what worked afterward. Managing a team becomes something you learn through practice.

Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to improve team management. Without your approval, they won't be included in reports or recommendations.

The same rules apply to your team's data: reports use only insights employees have approved, in a fully anonymized form. Conversations and individual responses are not shown to anyone, including you. Shared signals do not reveal who contributed a particular insight.

Your personal participation is voluntary and does not affect your access to team reports. You can skip a question, postpone a conversation, or opt out, and return anytime.

Would you like to start a personal conversation, or finish the introduction for now?

Actions: **Start My Conversation** · **Got It** · **Later** · **No Personal Check-ins**

### Manager

Hi! I'm Emma 👋 Your AI co-pilot for team management.

I'll help you notice where your team needs support, understand possible reasons, and choose practical actions. You can discuss a management situation with me, prepare your next step, and reflect on what worked afterward.

Managing a team becomes something you learn by doing — one decision at a time.

Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.

You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.

Ready to get started?

Action: **Got It**

### HR

Hi! I'm Emma 👋 I'll help you spot emerging challenges across the organization and identify where support is needed sooner.

Numbers alone don't always explain what people are experiencing. Shared signals from conversations help you understand what concerns employees, what they're missing, and what's already working well.

I'll help you make sense of this information and suggest practical steps to improve the work environment.

Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.

You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.

Ready to get started?

Action: **Got It**

### HRBP

Hi! I'm Emma 👋 I'll help you spot emerging challenges in the teams you support and help their leaders choose what to do next.

Shared signals from conversations add context to the numbers: they help you understand what concerns people, where support is missing, and what's already working well.

You can work through these signals with me and quickly prepare recommendations for team leaders.

Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.

You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.

Ready to get started?

Action: **Got It**

### Leadership

Hi! I'm Emma 👋 I'll help you see the overall picture of the work environment within your area of responsibility: what helps teams work well, where challenges are emerging, and what needs attention.

Shared signals from conversations add context to the numbers and help you understand why things are happening. I'll help you identify priorities and suggest actions to improve management and support your teams.

Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.

You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.

Ready to get started?

Action: **Got It**

## Action requirements

| Role | Action / event | Required behavior | Completion / participation | Reporting consent |
| --- | --- | --- | --- | --- |
| Employee | Let's Talk | Start a conversation using the first available topic in the agent's backlog. Allow the employee to bring their own topic instead. | Personal onboarding complete; conversation begins. | No permission granted. |
| Employee | Later | Acknowledge postponement; do not start the backlog conversation. Schedule the single reminder after two company working days. | Deferred; not complete. | No permission granted. |
| Employee | I Don't Want to Participate | Acknowledge the decision, stop invitations, and cancel the reminder. Explain they may return anytime. | Declined; do not count as successful completion. | No permission granted. |
| Team Lead | Start My Conversation | Begin their personal conversation from the first backlog topic. Keep personal participation separate from management access. | Personal onboarding complete and management introduction acknowledged. | No permission granted. |
| Team Lead | Got It | Acknowledge the management introduction without starting or enrolling them in personal conversations. | Management onboarding complete; no implied personal opt-in. | No permission granted. |
| Team Lead | Later | Defer the introduction / personal start and schedule the single reminder after two company working days. | Deferred; not complete. | No permission granted. |
| Team Lead | No Personal Check-ins | Stop personal invitations and cancel the reminder. Preserve management/reporting access. They may return voluntarily. | Personal participation declined; management introduction acknowledged. | No permission granted. |
| Manager | Got It | Acknowledge the introduction and mark management onboarding complete. Do not start an employee Pulse conversation. | Complete. | No employee-data permission granted. |
| HR | Got It | Acknowledge the introduction and mark role onboarding complete. | Complete. | No employee-data permission granted. |
| HRBP | Got It | Acknowledge the introduction and mark role onboarding complete. | Complete. | No employee-data permission granted. |
| Leadership | Got It | Acknowledge the introduction and mark role onboarding complete. | Complete. | No employee-data permission granted. |
| Any role with unfinished onboarding | Silence | Send at most one reminder after two company working days, within configured working hours; then stop onboarding reminders. | Silence is not completion or consent. | No permission granted. |
| Employee / Team Lead | Returns voluntarily | Accept an incoming conversation anytime; do not require another full introduction. Keep any renewed personal participation explicit. | A conversation can resume after deferral or refusal. | Separate approval still required. |
| Any role | Repeats an action | Do not duplicate a first conversation or reminder, or silently broaden consent. | Preserve the corresponding decision. | No permission granted. |

A reminder after explicit refusal is prohibited. The reminder budget is one per onboarding, not one per repeated Later click. Exact acknowledgement and reminder copy is not yet finalized.

## Completion and acceptance criteria

| Role | Observable completion |
| --- | --- |
| Employee | Explicitly chooses Let's Talk and the first conversation begins. |
| Team Lead | Starts their personal conversation, acknowledges Got It, or explicitly declines personal check-ins after receiving the combined introduction. Track management acknowledgement separately from personal participation. |
| Manager | Chooses Got It. |
| HR | Chooses Got It. |
| HRBP | Chooses Got It. |
| Leadership | Chooses Got It. |

Acceptance requires: correct assigned-role message/actions; all privacy statements enforced; personal participation separate from reporting approval; start connected to the first backlog topic; one calendar-aware reminder after Later/silence and none after refusal; voluntary return supported; administration settings available. Completion must be distinguishable from message delivery, deferral, refusal, and insight approval.

## Deferred features and release dependencies

Do not include an icebreaker, mandatory style selection, mirroring, custom agent name/avatar, or an undefined settings command. Mirroring and further personalization belong to later work.

Do not currently include View Report or View Example Report buttons, or offer to open unavailable examples. A real team report cannot exist during initial company onboarding.

When reporting examples are ready, employees may optionally view a Team Lead report example to build trust, with wording such as: “Here's an example of the report your lead will receive if at least five members of your team give permission to use insights from their conversations with me.” Team Lead, Manager, HR, HRBP, and Leadership should receive role-appropriate examples. Viewing an example must not grant consent or be required for onboarding completion.

The product will not release to users before reporting is ready. Implementing example reports, insight analysis, report generation, or a new reporting consent flow is outside this onboarding requirements PR.

## Items to resolve before implementation / release

- Empty backlog behavior: no fallback scenario has been approved.
- Exact reminder timing within company working hours and acknowledgement/reminder texts.
- Supported administrator-selected languages and approved translations beyond English.
- Temporary storage lifecycle and verification of the no-human-access promise.

These details do not authorize an implementation in this PR.
