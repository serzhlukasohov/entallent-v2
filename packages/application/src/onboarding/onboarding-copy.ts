import type { PrimaryOrgRole } from '../hierarchy/draft-person';
import type { AckKey, OnboardingAction } from './onboarding-state';

export interface IntroMessages {
  intro: string;
  trust: string;
  actions: Array<{ action: OnboardingAction; label: string }>;
}

// Transcribed verbatim from docs/onboarding-v2.md ("Final onboarding messages (English)").
const INTRO_BY_ROLE: Record<PrimaryOrgRole, IntroMessages> = {
  employee: {
    intro: "Hi! I'm Emma 👋 Your virtual colleague — someone who's here to listen, help you work through a situation, or give you space to vent.\n\nYou can message me anytime: about a difficult day, relationships with colleagues, something that makes you happy or worries you, or anything else you'd like to talk about. I'll listen and help you think things through if that's what you need.\n\nSometimes I'll also invite you to a short conversation about how things are going at work. These conversations help us understand what makes your work environment more comfortable and where support is needed.",
    trust: "Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to your manager on how to improve team management.\n\nYou decide which insights you're comfortable sharing. Without your approval, they won't be included in reports or recommendations.\n\nParticipation is voluntary: you can skip a question, postpone a conversation, or opt out. You can come back anytime — just message me as you would a familiar colleague.\n\nShall we talk about how things are going at work? You can also start by telling me what's on your mind.",
    actions: [
      { action: 'start', label: "Let's Talk" },
      { action: 'later', label: "Later" },
      { action: 'decline', label: "I Don't Want to Participate" },
    ],
  },
  team_lead: {
    intro: "Hi! I'm Emma 👋 Your virtual colleague and AI co-pilot for team management.\n\nYou can talk to me about your own experience at work, work through a situation, or simply vent. Message me anytime — about work or anything else that's on your mind.\n\nAs a Team Lead, you'll also receive shared signals about your team and recommendations. I'll help you choose your next step, prepare for a conversation, and reflect on what worked afterward. Managing a team becomes something you learn through practice.",
    trust: "Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to improve team management. Without your approval, they won't be included in reports or recommendations.\n\nThe same rules apply to your team's data: reports use only insights employees have approved, in a fully anonymized form. Conversations and individual responses are not shown to anyone, including you. Shared signals do not reveal who contributed a particular insight.\n\nYour personal participation is voluntary and does not affect your access to team reports. You can skip a question, postpone a conversation, or opt out, and return anytime.\n\nWould you like to start a personal conversation, or finish the introduction for now?",
    actions: [
      { action: 'start', label: "Start My Conversation" },
      { action: 'got_it', label: "Got It" },
      { action: 'later', label: "Later" },
      { action: 'decline', label: "No Personal Check-ins" },
    ],
  },
  manager: {
    intro: "Hi! I'm Emma 👋 Your AI co-pilot for team management.\n\nI'll help you notice where your team needs support, understand possible reasons, and choose practical actions. You can discuss a management situation with me, prepare your next step, and reflect on what worked afterward.\n\nManaging a team becomes something you learn by doing — one decision at a time.",
    trust: "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.\n\nYou receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.\n\nReady to get started?",
    actions: [
      { action: 'got_it', label: "Got It" },
    ],
  },
  hr: {
    intro: "Hi! I'm Emma 👋 I'll help you spot emerging challenges across the organization and identify where support is needed sooner.\n\nNumbers alone don't always explain what people are experiencing. Shared signals from conversations help you understand what concerns employees, what they're missing, and what's already working well.\n\nI'll help you make sense of this information and suggest practical steps to improve the work environment.",
    trust: "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.\n\nYou receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.\n\nReady to get started?",
    actions: [
      { action: 'got_it', label: "Got It" },
    ],
  },
  hrbp: {
    intro: "Hi! I'm Emma 👋 I'll help you spot emerging challenges in the teams you support and help their leaders choose what to do next.\n\nShared signals from conversations add context to the numbers: they help you understand what concerns people, where support is missing, and what's already working well.\n\nYou can work through these signals with me and quickly prepare recommendations for team leaders.",
    trust: "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.\n\nYou receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.\n\nReady to get started?",
    actions: [
      { action: 'got_it', label: "Got It" },
    ],
  },
  leadership: {
    intro: "Hi! I'm Emma 👋 I'll help you see the overall picture of the work environment within your area of responsibility: what helps teams work well, where challenges are emerging, and what needs attention.\n\nShared signals from conversations add context to the numbers and help you understand why things are happening. I'll help you identify priorities and suggest actions to improve management and support your teams.",
    trust: "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.\n\nYou receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.\n\nReady to get started?",
    actions: [
      { action: 'got_it', label: "Got It" },
    ],
  },
};

export function introMessages(role: PrimaryOrgRole): IntroMessages {
  return INTRO_BY_ROLE[role];
}

// Approved acknowledgements: docs/onboarding-v2-answers.md G2 table; already_complete from Q24.
export const ACK_COPY: Record<AckKey, string> = {
  later_before_reminder: "Of course. I’ll check back in two working days. You can message me anytime before then.",
  later_after_reminder: "Of course. Message me whenever you feel ready.",
  decline: "Understood. I won’t start conversations unless you message me first. You’re welcome to come back anytime.",
  got_it_team_lead: "You're all set. I'll invite you to conversations about how things are going at work. You can also message me anytime.",
  got_it_management: "You're all set. Message me whenever you’d like to discuss a situation or need support.",
  already_complete: "Introduction complete.",
};

export const STARTED_REPLACEMENT = "Let's talk.";

const REMINDER_COPY = {
  employee: "Hi! Just checking in — would you like to talk? You can share what's on your mind, or we can start with how things are going at work. No pressure — you can come back anytime. I won't send another onboarding reminder.",
  team_lead: "Hi! Would you like to finish our introduction? We can start a conversation about how things are going for you at work, or you can acknowledge the introduction for now. I won't send another onboarding reminder.",
} as const;

export function reminderCopy(track: 'employee' | 'team_lead'): string {
  return REMINDER_COPY[track];
}

export const EMPTY_BACKLOG_OPENER = "What’s on your mind today? We can talk about how things are going at work, or anything else you’d like to share.";
