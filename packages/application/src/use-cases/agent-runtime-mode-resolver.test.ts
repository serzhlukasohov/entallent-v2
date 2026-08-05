import { describe, expect, it, vi } from 'vitest';
import type { FeatureFlagContext } from '../ports/feature-flag.port';
import { RUNTIME_CONTROL_FLAGS } from '../ports/feature-flag.port';
import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import { AgentRuntimeModeResolver, type RuntimeControlFlagPort } from './agent-runtime-mode-resolver';

const REQUEST: ProcessMessageRequest = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  userId: 'user-1',
  tenantId: 'tenant-1',
  externalWorkspaceId: 'workspace-1',
  externalConversationId: 'channel-1',
  traceId: 'trace-1',
};

function flagReader(enabledKeys: string[] = [], denied = false): RuntimeControlFlagPort {
  return {
    isEnabled: vi.fn((key: string, _context: FeatureFlagContext) => Promise.resolve(enabledKeys.includes(key))),
    isUserDenylisted: vi.fn((_context: FeatureFlagContext) => Promise.resolve(denied)),
  };
}

describe('AgentRuntimeModeResolver', () => {
  it('keeps resolve compatible by returning only the runtime mode', async () => {
    const resolver = new AgentRuntimeModeResolver(flagReader());

    await expect(resolver.resolve(REQUEST)).resolves.toBe('typescript');
  });

  it('defaults to TypeScript when no runtime flags are enabled', async () => {
    const resolver = new AgentRuntimeModeResolver(flagReader());

    await expect(resolver.resolveDecision(REQUEST)).resolves.toEqual({
      mode: 'typescript',
      decisionSource: 'typescript_default',
    });
  });

  it('resolves maf_disabled when the global kill switch is enabled', async () => {
    const resolver = new AgentRuntimeModeResolver(
      flagReader([
        RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_DISABLED,
        RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_SHADOW,
        RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY,
      ]),
    );

    await expect(resolver.resolveDecision(REQUEST)).resolves.toEqual({
      mode: 'maf_disabled',
      decisionSource: 'global_kill_switch',
    });
  });

  it('lets denylist precedence win over shadow and canary modes', async () => {
    const resolver = new AgentRuntimeModeResolver(
      flagReader(
        [
          RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_SHADOW,
          RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY,
        ],
        true,
      ),
    );

    await expect(resolver.resolveDecision(REQUEST)).resolves.toEqual({
      mode: 'typescript',
      decisionSource: 'tenant_user_denylist',
    });
  });

  it('resolves shadow before canary when both rollout modes are enabled', async () => {
    const resolver = new AgentRuntimeModeResolver(
      flagReader([
        RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_SHADOW,
        RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY,
      ]),
    );

    await expect(resolver.resolveDecision(REQUEST)).resolves.toEqual({
      mode: 'maf_shadow',
      decisionSource: 'shadow_flag',
    });
  });

  it('resolves canary when canary is enabled without shadow', async () => {
    const resolver = new AgentRuntimeModeResolver(
      flagReader([RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY]),
    );

    await expect(resolver.resolveDecision(REQUEST)).resolves.toEqual({
      mode: 'maf_canary',
      decisionSource: 'canary_flag',
    });
  });

  it('propagates flag failures so the router can fail closed with warning context', async () => {
    const resolver = new AgentRuntimeModeResolver({
      isEnabled: vi.fn().mockRejectedValue(new Error('flag store unavailable')),
      isUserDenylisted: vi.fn().mockResolvedValue(false),
    });

    await expect(resolver.resolveDecision(REQUEST)).rejects.toThrow('flag store unavailable');
  });
});
