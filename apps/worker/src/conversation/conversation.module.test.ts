import { MODULE_METADATA } from '@nestjs/common/constants';
import { AGENT_RUNTIME_PORT } from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { ConversationOrchestrator } from '@entalent/application';
import { AiService } from './ai.service';
import { ConversationModule } from './conversation.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

describe('ConversationModule runtime boundary', () => {
  it('does not register an agent runtime router or client', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConversationModule) as Array<
      | unknown
      | { provide?: unknown }
    >;

    expect(providers.some((provider) => (
      typeof provider === 'object'
      && provider !== null
      && 'provide' in provider
      && provider.provide === AGENT_RUNTIME_PORT
    ))).toBe(false);
  });

  it('routes the always-on safety assessment through the TypeScript AiService only (ADR-013 G1)', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConversationModule) as Array<
      | unknown
      | { provide?: unknown; inject?: unknown[] }
    >;
    const orchestrator = providers.find((provider) => (
      typeof provider === 'object'
      && provider !== null
      && 'provide' in provider
      && provider.provide === ConversationOrchestrator
    )) as { inject: unknown[] } | undefined;

    expect(orchestrator?.inject[1]).toBe(AiService);
    expect(orchestrator?.inject).not.toContain(AGENT_RUNTIME_PORT);
    const injectedNames = orchestrator!.inject.map((token) => (typeof token === 'function' ? token.name : String(token)));
    expect(injectedNames.filter((name) => /maf|agent.?service|agent.?runtime/i.test(name))).toEqual([]);
  });

  it('imports OnboardingModule so the orchestrator receives the onboarding turn port', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, ConversationModule) as unknown[];
    expect(imports).toContain(OnboardingModule);
  });
});
