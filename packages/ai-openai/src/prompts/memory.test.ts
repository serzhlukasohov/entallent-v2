import { describe, expect, it } from 'vitest';
import { buildMemorySystemPrompt, buildMemoryUserPrompt } from './memory';

describe('memory extraction source fidelity', () => {
  it('treats mentor suggestions as context instead of employee facts or goals', () => {
    const prompt = buildMemorySystemPrompt();

    expect(prompt).toContain('Employee messages are the only source of facts, goals, preferences');
    expect(prompt).toContain('Mentor messages are context only');
    expect(prompt).toContain(
      'The latest Employee message is the only source of new or changed memory in this extraction run',
    );
    expect(prompt).toContain('Never turn a Mentor suggestion, example, question, or forced-choice option');
    expect(prompt).toContain('unless a later Employee message explicitly adopts it');
    expect(prompt).toContain('"I don\'t know" to a Mentor\'s choice or question is not adoption');
    expect(prompt).toContain('Create a goal only from an explicit Employee intention');
    expect(prompt).toContain('Asking for advice or answering a Mentor question is not automatically a durable goal');
    expect(prompt).toContain('A closing or rejection such as "forget it"');
    expect(prompt).toContain('never create a goal to forget or pause a discussion');
    expect(prompt).toContain('Keep facts about a bot, product, test setup, or target persona as project_context');
    expect(prompt).toContain("Do not turn \"an HR mentor bot\" into the employee's own role");
  });

  it('makes explicit corrections supersede rejected interpretations', () => {
    expect(buildMemorySystemPrompt()).toContain(
      'An Employee correction or rejection overrides earlier interpretations',
    );
  });

  it('labels transcript roles so the extraction boundary is enforceable', () => {
    const prompt = buildMemoryUserPrompt(
      [
        { role: 'assistant', content: 'Would you pressure-test belonging?', timestamp: new Date() },
        { role: 'user', content: 'No, I only want answer-quality criteria.', timestamp: new Date() },
      ],
      { items: [], goals: [] },
    );

    expect(prompt).toContain('Mentor [context only]: Would you pressure-test belonging?');
    expect(prompt).toContain(
      'Employee [LATEST — ONLY SOURCE OF NEW MEMORY]: No, I only want answer-quality criteria.',
    );
  });

  it('structurally excludes the just-generated mentor reply from memory evidence', () => {
    const prompt = buildMemoryUserPrompt(
      [
        { role: 'assistant', content: 'Which block is hardest?', timestamp: new Date() },
        { role: 'user', content: "I don't know.", timestamp: new Date() },
        {
          role: 'assistant',
          content: 'Belonging is probably the hardest block.',
          timestamp: new Date(),
        },
      ],
      { items: [], goals: [] },
    );

    expect(prompt).toContain('Mentor [context only]: Which block is hardest?');
    expect(prompt).toContain("Employee [LATEST — ONLY SOURCE OF NEW MEMORY]: I don't know.");
    expect(prompt).not.toContain('Belonging is probably the hardest block.');
  });
});
