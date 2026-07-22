import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // API
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Worker
  WORKER_PORT: z.coerce.number().int().positive().default(3001),

  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgresql:// URL'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid redis:// URL'),

  // OpenAI (direct) — required when not using Azure
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ORG_ID: z.string().optional(),

  // Azure OpenAI — alternative to direct OpenAI
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().optional(),
  // Deployment name used for all tasks when Azure is active
  OPENAI_MODEL_BALANCED: z.string().optional(),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),

  // Encryption
  FIELD_ENCRYPTION_KEY: z.string().min(64, 'FIELD_ENCRYPTION_KEY must be a 32-byte hex string'),

  // Auth & Access
  ADMIN_API_KEY: z.string().optional(), // Required in production; protects admin + sensitive user endpoints
  DEFAULT_TENANT_ID: z.string().uuid().optional(), // Dev convenience — used when tenant context is not derived from auth

  // Proactive check-in scheduler
  PROACTIVE_SCAN_INTERVAL_MIN: z.coerce.number().int().positive().default(60), // how often the scan runs
  PROACTIVE_MIN_SILENCE_DAYS: z.coerce.number().int().positive().default(3), // silence before a check-in is considered
  PROACTIVE_MIN_GAP_DAYS: z.coerce.number().int().positive().default(3), // min days between proactive contacts
  PROACTIVE_BATCH_LIMIT: z.coerce.number().int().positive().default(50), // max users contacted per scan

  // Observability (optional)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().optional(),
});

const envSchemaRefined = envSchema.superRefine((data, ctx) => {
  const hasOpenAI = Boolean(data.OPENAI_API_KEY);
  const hasAzure = Boolean(data.AZURE_OPENAI_ENDPOINT && data.AZURE_OPENAI_API_KEY && data.AZURE_OPENAI_API_VERSION);
  if (!hasOpenAI && !hasAzure) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Either OPENAI_API_KEY or (AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY + AZURE_OPENAI_API_VERSION) must be set',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function validateEnv(raw?: Record<string, string | undefined>): Env {
  const result = envSchemaRefined.safeParse(raw ?? process.env);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) {
    return validateEnv();
  }
  return _env;
}
