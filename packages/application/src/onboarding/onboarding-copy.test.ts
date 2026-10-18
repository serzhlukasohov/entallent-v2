import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrimaryOrgRole } from '../hierarchy/draft-person';
import { ACK_COPY, BUTTON_REPLACEMENT_SHORT, EMPTY_BACKLOG_OPENER, STARTED_REPLACEMENT, introMessages, reminderCopy } from './onboarding-copy';

const ROLES: PrimaryOrgRole[] = ['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership'];

const EXPECTED_FULL: Record<PrimaryOrgRole, { intro: string[]; trust: string[] }> = {
  employee: {
    intro: [
      "Hi! I'm Emma 👋 Your virtual colleague — someone who's here to listen, help you work through a situation, or give you space to vent.",
      "You can message me anytime: about a difficult day, relationships with colleagues, something that makes you happy or worries you, or anything else you'd like to talk about. I'll listen and help you think things through if that's what you need.",
      "Sometimes I'll also invite you to a short conversation about how things are going at work. These conversations help us understand what makes your work environment more comfortable and where support is needed."
],
    trust: [
      "Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to your manager on how to improve team management.",
      "You decide which insights you're comfortable sharing. Without your approval, they won't be included in reports or recommendations.",
      "Participation is voluntary: you can skip a question, postpone a conversation, or opt out. You can come back anytime — just message me as you would a familiar colleague.",
      "Shall we talk about how things are going at work? You can also start by telling me what's on your mind."
],
  },
  team_lead: {
    intro: [
      "Hi! I'm Emma 👋 Your virtual colleague and AI co-pilot for team management.",
      "You can talk to me about your own experience at work, work through a situation, or simply vent. Message me anytime — about work or anything else that's on your mind.",
      "As a Team Lead, you'll also receive shared signals about your team and recommendations. I'll help you choose your next step, prepare for a conversation, and reflect on what worked afterward. Managing a team becomes something you learn through practice."
],
    trust: [
      "Your conversations and individual responses are not shown to anyone. If insights come up that could help improve the work environment, I'll ask for your permission to use them in a fully anonymized form — for a team report and recommendations to improve team management. Without your approval, they won't be included in reports or recommendations.",
      "The same rules apply to your team's data: reports use only insights employees have approved, in a fully anonymized form. Conversations and individual responses are not shown to anyone, including you. Shared signals do not reveal who contributed a particular insight.",
      "Your personal participation is voluntary and does not affect your access to team reports. You can skip a question, postpone a conversation, or opt out, and return anytime.",
      "Would you like to start a personal conversation, or finish the introduction for now?"
],
  },
  manager: {
    intro: [
      "Hi! I'm Emma 👋 Your AI co-pilot for team management.",
      "I'll help you notice where your team needs support, understand possible reasons, and choose practical actions. You can discuss a management situation with me, prepare your next step, and reflect on what worked afterward.",
      "Managing a team becomes something you learn by doing — one decision at a time."
],
    trust: [
      "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.",
      "You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.",
      "Ready to get started?"
],
  },
  hr: {
    intro: [
      "Hi! I'm Emma 👋 I'll help you spot emerging challenges across the organization and identify where support is needed sooner.",
      "Numbers alone don't always explain what people are experiencing. Shared signals from conversations help you understand what concerns employees, what they're missing, and what's already working well.",
      "I'll help you make sense of this information and suggest practical steps to improve the work environment."
],
    trust: [
      "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.",
      "You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.",
      "Ready to get started?"
],
  },
  hrbp: {
    intro: [
      "Hi! I'm Emma 👋 I'll help you spot emerging challenges in the teams you support and help their leaders choose what to do next.",
      "Shared signals from conversations add context to the numbers: they help you understand what concerns people, where support is missing, and what's already working well.",
      "You can work through these signals with me and quickly prepare recommendations for team leaders."
],
    trust: [
      "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.",
      "You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.",
      "Ready to get started?"
],
  },
  leadership: {
    intro: [
      "Hi! I'm Emma 👋 I'll help you see the overall picture of the work environment within your area of responsibility: what helps teams work well, where challenges are emerging, and what needs attention.",
      "Shared signals from conversations add context to the numbers and help you understand why things are happening. I'll help you identify priorities and suggest actions to improve management and support your teams."
],
    trust: [
      "Reports use only insights that employees have approved for use, and only in a fully anonymized form. Employees' conversations and individual responses are not shown to anyone, including you.",
      "You receive shared signals and recommendations within your area of responsibility. They do not reveal who contributed a particular insight.",
      "Ready to get started?"
],
  },
};

describe('ACK_COPY', () => {
  it('matches approved G2 / Q24 text exactly', () => {
    expect(ACK_COPY).toEqual({
      later_before_reminder: 'Of course. I’ll check back in two working days. You can message me anytime before then.',
      later_after_reminder: 'Of course. Message me whenever you feel ready.',
      decline: 'Understood. I won’t start conversations unless you message me first. You’re welcome to come back anytime.',
      got_it_team_lead: "You're all set. I'll invite you to conversations about how things are going at work. You can also message me anytime.",
      got_it_management: 'You\'re all set. Message me whenever you’d like to discuss a situation or need support.',
      already_complete: 'Introduction complete.',
    });
    expect(STARTED_REPLACEMENT).toBe("Let's talk.");
  });
  it('short button replacements for text choices are verbatim from Q24', () => {
    expect(BUTTON_REPLACEMENT_SHORT).toEqual({
      later_before_reminder: "We'll talk later.",
      later_after_reminder: "We'll talk later.",
      decline: "I won't start conversations unless you message me first.",
      got_it_team_lead: 'Introduction complete.',
      got_it_management: 'Introduction complete.',
      already_complete: 'Introduction complete.',
      started: "Let's talk.",
    });
  });
});

describe('reminders and empty-backlog opener', () => {
  it('reminder copy is verbatim from Q14', () => {
    expect(reminderCopy('employee')).toBe("Hi! Just checking in — would you like to talk? You can share what's on your mind, or we can start with how things are going at work. No pressure — you can come back anytime. I won't send another onboarding reminder.");
    expect(reminderCopy('team_lead')).toBe("Hi! Would you like to finish our introduction? We can start a conversation about how things are going for you at work, or you can acknowledge the introduction for now. I won't send another onboarding reminder.");
  });
  it('empty backlog opener is verbatim from G1', () => {
    expect(EMPTY_BACKLOG_OPENER).toBe('What’s on your mind today? We can talk about how things are going at work, or anything else you’d like to share.');
  });
});

describe('introMessages', () => {
  const first = (s: string) => s.split('\n\n')[0];
  const last = (s: string) => s.split('\n\n').at(-1)!;

  it('employee first/last sentences, split boundary and buttons', () => {
    const m = introMessages('employee');
    expect(m.intro.startsWith("Hi! I'm Emma 👋 Your virtual colleague — someone who's here to listen")).toBe(true);
    expect(m.intro.endsWith('where support is needed.')).toBe(true);
    expect(m.trust.startsWith('Your conversations and individual responses are not shown to anyone.')).toBe(true);
    expect(m.trust.endsWith("You can also start by telling me what's on your mind.")).toBe(true);
    expect(last(m.trust)).toContain('Shall we talk about how things are going at work?');
    expect(m.intro).not.toContain('not shown to anyone');
    expect(m.actions).toEqual([
      { action: 'start', label: "Let's Talk" },
      { action: 'later', label: 'Later' },
      { action: 'decline', label: "I Don't Want to Participate" },
    ]);
  });

  it('team lead first/last sentences, split boundary and buttons', () => {
    const m = introMessages('team_lead');
    expect(m.intro.startsWith("Hi! I'm Emma 👋 Your virtual colleague and AI co-pilot for team management.")).toBe(true);
    expect(m.intro.endsWith('Managing a team becomes something you learn through practice.')).toBe(true);
    expect(m.trust.startsWith('Your conversations and individual responses are not shown to anyone.')).toBe(true);
    expect(m.trust.endsWith('or finish the introduction for now?')).toBe(true);
    expect(m.actions).toEqual([
      { action: 'start', label: 'Start My Conversation' },
      { action: 'got_it', label: 'Got It' },
      { action: 'later', label: 'Later' },
      { action: 'decline', label: 'No Personal Check-ins' },
    ]);
  });

  it.each(['manager', 'hr', 'hrbp', 'leadership'] as const)('%s: trust boundary, last line and single Got It button', (role) => {
    const m = introMessages(role);
    expect(m.intro.startsWith("Hi! I'm Emma 👋")).toBe(true);
    expect(m.trust.startsWith('Reports use only insights')).toBe(true);
    expect(m.trust.endsWith('Ready to get started?')).toBe(true);
    expect(m.intro).not.toContain('Reports use only insights');
    expect(m.actions).toEqual([{ action: 'got_it', label: 'Got It' }]);
  });

  it('management intros end with their own last sentences', () => {
    expect(introMessages('manager').intro.endsWith('one decision at a time.')).toBe(true);
    expect(introMessages('hr').intro.endsWith('suggest practical steps to improve the work environment.')).toBe(true);
    expect(introMessages('hrbp').intro.endsWith('prepare recommendations for team leaders.')).toBe(true);
    expect(introMessages('leadership').intro.endsWith('support your teams.')).toBe(true);
  });

  it('the four management trust blocks are identical while intros differ', () => {
    const trusts = new Set(['manager', 'hr', 'hrbp', 'leadership'].map((r) => introMessages(r as PrimaryOrgRole).trust));
    const intros = new Set(['manager', 'hr', 'hrbp', 'leadership'].map((r) => introMessages(r as PrimaryOrgRole).intro));
    expect(trusts.size).toBe(1);
    expect(intros.size).toBe(4);
  });

  it('every role has non-empty intro and trust with paragraphs joined by blank lines', () => {
    for (const role of ROLES) {
      const m = introMessages(role);
      expect(first(m.intro).length).toBeGreaterThan(0);
      expect(m.trust.length).toBeGreaterThan(0);
      expect(m.intro).not.toMatch(/Actions?:|\*\*/);
    }
  });
});

describe('full intro copy for every role', () => {
  const docText = readFileSync(resolve(__dirname, '../../../../docs/onboarding-v2.md'), 'utf8');
  it.each(ROLES)('%s: intro and trust equal the approved paragraphs joined by blank lines', (role) => {
    const m = introMessages(role);
    expect(m.intro).toBe(EXPECTED_FULL[role].intro.join('\n\n'));
    expect(m.trust).toBe(EXPECTED_FULL[role].trust.join('\n\n'));
  });
  it.each(ROLES)('%s: every paragraph exists verbatim in docs/onboarding-v2.md', (role) => {
    const m = introMessages(role);
    for (const para of [...m.intro.split('\n\n'), ...m.trust.split('\n\n')]) {
      expect(docText).toContain(para);
    }
  });
});
