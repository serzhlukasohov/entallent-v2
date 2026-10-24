export interface DevJobsEnv {
  NODE_ENV?: string;
  ENABLE_DEV_ENDPOINTS?: string;
}

/**
 * Worker twin of the API's `shouldMountDevModule`: dev-console jobs run only where the dev endpoints can exist.
 * Production never runs them, even with ENABLE_DEV_ENDPOINTS=true (the API refuses to boot with that).
 */
export function devJobsEnabled(env: DevJobsEnv = process.env): boolean {
  return (env.NODE_ENV ?? 'development') !== 'production';
}
