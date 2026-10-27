import { readFileSync } from 'node:fs';
import { SuiteConfigSchema, type SuiteConfig } from './schema';

/** Reads and validates `suite.config.json`; every error is `[suite] config: <path>: <message>`. */
export function loadSuiteConfig(path: string): SuiteConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`[suite] config: ${path}: cannot read (${(error as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[suite] config: ${path}: invalid JSON (${(error as Error).message})`);
  }
  const parsed = SuiteConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(`[suite] config: ${path}: ${where}${issue?.message ?? 'invalid config'}`);
  }
  return parsed.data;
}
