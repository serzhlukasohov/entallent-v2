import { describe, expect, it } from 'vitest';
import { buildClassifySystemPrompt, buildClassifyUserPrompt } from './classify';

describe('buildClassifySystemPrompt', () => {
  it('treats the latest employee message as the authoritative dialogue act source', () => {
    const prompt = buildClassifySystemPrompt();

    expect(prompt).toContain('LATEST EMPLOYEE MESSAGE block');
    expect(prompt).toContain('older transcript turns');
    expect(prompt).toContain('social_checkin');
    expect(prompt).toContain('mentor/agent is doing');
  });
});

describe('buildClassifyUserPrompt', () => {
  it('renders the latest user turn in a separate block after the transcript', () => {
    const prompt = buildClassifyUserPrompt(
      [
        { role: 'user', content: 'сегодня тяжело собраться', timestamp: new Date('2026-08-13T12:00:00.000Z') },
        { role: 'assistant', content: 'Да, тяжёлый момент.', timestamp: new Date('2026-08-13T12:01:00.000Z') },
        { role: 'user', content: 'как ты?', timestamp: new Date('2026-08-13T12:02:00.000Z') },
      ],
      { userName: 'Serhii', now: '2026-08-13T12:02:00.000Z', timezone: 'Europe/Warsaw' },
    );

    expect(prompt).toContain('--- UNTRUSTED CONVERSATION TRANSCRIPT START ---');
    expect(prompt).toContain('Serhii: сегодня тяжело собраться');
    expect(prompt).toContain('Mentor: Да, тяжёлый момент.');
    expect(prompt).toContain('--- LATEST EMPLOYEE MESSAGE TO CLASSIFY ---\nкак ты?\n--- END LATEST EMPLOYEE MESSAGE ---');
  });
});
