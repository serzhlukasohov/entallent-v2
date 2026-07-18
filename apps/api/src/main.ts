import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestLogger } from '@entalent/observability';
import { validateEnv } from '@entalent/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = validateEnv();
  const logger = new NestLogger('API');

  const adapter = new FastifyAdapter({ logger: false });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.useLogger(logger);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // init() registers NestJS's own 'application/json' parser; call it first
  // so we can safely replace it with our version that captures the raw body.
  await app.init();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fastify = app.getHttpAdapter().getInstance() as any;
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: unknown, body: Buffer, done: (err: Error | null, body?: unknown) => void) => {
      (req as Record<string, unknown>)['rawBody'] = body.toString('utf-8');
      try {
        done(null, JSON.parse(body.toString('utf-8')));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  await app.listen(env.API_PORT, '0.0.0.0');

  logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during API bootstrap:', error);
  process.exit(1);
});
