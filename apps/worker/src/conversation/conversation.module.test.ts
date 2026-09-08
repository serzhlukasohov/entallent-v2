import { MODULE_METADATA } from '@nestjs/common/constants';
import { AGENT_RUNTIME_PORT } from '@entalent/application';
import { describe, expect, it } from 'vitest';
import { ConversationModule } from './conversation.module';

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
});
