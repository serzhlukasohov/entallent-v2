import { describe, expect, it } from 'vitest';
import type { PrimaryOrgRole } from '../hierarchy/draft-person';
import { ACK_COPY, EMPTY_BACKLOG_OPENER, STARTED_REPLACEMENT, introMessages, reminderCopy } from './onboarding-copy';

const ROLES: PrimaryOrgRole[] = ['employee', 'team_lead', 'manager', 'hr', 'hrbp', 'leadership'];

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
