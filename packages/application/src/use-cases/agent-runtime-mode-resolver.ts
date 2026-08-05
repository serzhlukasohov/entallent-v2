import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import type { FeatureFlagContext, RuntimeControlFlagKey } from '../ports/feature-flag.port';
import { RUNTIME_CONTROL_FLAGS } from '../ports/feature-flag.port';
import type { AgentRuntimeDecision, AgentRuntimeMode } from './agent-runtime-router';

export interface RuntimeControlFlagPort {
  isEnabled(key: RuntimeControlFlagKey, context: FeatureFlagContext): Promise<boolean>;
  isUserDenylisted(context: FeatureFlagContext): Promise<boolean>;
}

export class AgentRuntimeModeResolver {
  constructor(private readonly runtimeControls: RuntimeControlFlagPort) {}

  async resolve(request: ProcessMessageRequest): Promise<AgentRuntimeMode> {
    return (await this.resolveDecision(request)).mode;
  }

  async resolveDecision(request: ProcessMessageRequest): Promise<AgentRuntimeDecision> {
    const context = toFeatureFlagContext(request);

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_DISABLED, context)) {
      return {
        mode: 'maf_disabled',
        decisionSource: 'global_kill_switch',
      };
    }

    if (await this.isDenylisted(context)) {
      return {
        mode: 'typescript',
        decisionSource: 'tenant_user_denylist',
      };
    }

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_SHADOW, context)) {
      return {
        mode: 'maf_shadow',
        decisionSource: 'shadow_flag',
      };
    }

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY, context)) {
      return {
        mode: 'maf_canary',
        decisionSource: 'canary_flag',
      };
    }

    return {
      mode: 'typescript',
      decisionSource: 'typescript_default',
    };
  }

  private async isDenylisted(context: FeatureFlagContext): Promise<boolean> {
    return this.runtimeControls.isUserDenylisted(context);
  }
}

function toFeatureFlagContext(request: ProcessMessageRequest): FeatureFlagContext {
  return {
    tenantId: request.tenantId,
    userId: request.userId,
  };
}
