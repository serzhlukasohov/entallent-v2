import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestLogger } from '@entalent/observability';
import { validateEnv } from '@entalent/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = validateEnv();
  const logger = new NestLogger('Worker');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  app.useLogger(logger);
  app.enableShutdownHooks();

  await app.listen(env.WORKER_PORT, '0.0.0.0');

  logger.log(`Worker listening on port ${env.WORKER_PORT}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  new NestLogger('Worker').error(
    `Fatal error during Worker bootstrap: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
    'Bootstrap',
  );
  process.exit(1);
});
