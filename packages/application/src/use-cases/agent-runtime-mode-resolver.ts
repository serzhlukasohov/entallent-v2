import type { ProcessMessageRequest } from '../ports/agent-runtime.port';
import type { FeatureFlagContext, RuntimeControlFlagKey } from '../ports/feature-flag.port';
import { RUNTIME_CONTROL_FLAGS } from '../ports/feature-flag.port';
import type { AgentRuntimeMode } from './agent-runtime-router';

export interface RuntimeControlFlagPort {
  isEnabled(key: RuntimeControlFlagKey, context: FeatureFlagContext): Promise<boolean>;
  isUserDenylisted?(context: FeatureFlagContext): Promise<boolean>;
}

export class AgentRuntimeModeResolver {
  constructor(private readonly runtimeControls: RuntimeControlFlagPort) {}

  async resolve(request: ProcessMessageRequest): Promise<AgentRuntimeMode> {
    const context = toFeatureFlagContext(request);

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_DISABLED, context)) {
      return 'maf_disabled';
    }

    if (await this.isDenylisted(context)) {
      return 'typescript';
    }

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_SHADOW, context)) {
      return 'maf_shadow';
    }

    if (await this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_CANARY, context)) {
      return 'maf_canary';
    }

    return 'typescript';
  }

  private async isDenylisted(context: FeatureFlagContext): Promise<boolean> {
    if (this.runtimeControls.isUserDenylisted) {
      return this.runtimeControls.isUserDenylisted(context);
    }

    return this.runtimeControls.isEnabled(RUNTIME_CONTROL_FLAGS.MAF_RUNTIME_USER_DENYLIST, context);
  }
}

function toFeatureFlagContext(request: ProcessMessageRequest): FeatureFlagContext {
  return {
    tenantId: request.tenantId,
    userId: request.userId,
  };
}
