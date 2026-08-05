type NodeEnv = 'development' | 'test' | 'production' | string | undefined;

export interface DevEndpointEnv {
  NODE_ENV?: NodeEnv;
  ENABLE_DEV_ENDPOINTS?: string;
}

export function shouldMountDevModule(env: DevEndpointEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const devFlagEnabled = env.ENABLE_DEV_ENDPOINTS === 'true';

  if (nodeEnv === 'production') {
    if (devFlagEnabled) {
      throw new Error('ENABLE_DEV_ENDPOINTS=true is not allowed in production');
    }
    return false;
  }

  return true;
}
