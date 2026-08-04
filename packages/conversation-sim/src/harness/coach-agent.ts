import { AgentRole, type AgentAdapter, type AgentInput } from '@langwatch/scenario';
import { CoachHarness, type CoachHarnessOptions } from './coach-harness';

/**
 * Exposes the harness as a Scenario agent. The simulated user only ever hands us
 * its latest message — conversation history stays where production keeps it, in
 * the conversation repository, so the real 20-message window is exercised.
 */
export function createCoachAgent(options: CoachHarnessOptions = {}): {
  agent: AgentAdapter;
  harness: CoachHarness;
} {
  const harness = new CoachHarness(options);

  const agent: AgentAdapter = {
    role: AgentRole.AGENT,
    call: async (input: AgentInput) => harness.send(lastUserMessage(input)),
  };

  return { agent, harness };
}

function lastUserMessage(input: AgentInput): string {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const message = input.messages[i];
    if (message.role !== 'user') continue;
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
    if (text.trim()) return text;
  }
  throw new Error('Simulated user produced no text message for the coach to answer.');
}
