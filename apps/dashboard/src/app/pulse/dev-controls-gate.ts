export function devControlsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.DASHBOARD_DEV_CONTROLS_ENABLED === 'true';
}
