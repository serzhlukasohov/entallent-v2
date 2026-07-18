import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { type AppLogger } from './logger';

export interface TracingOptions {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  logger?: AppLogger;
}

let sdk: NodeSDK | undefined;

export function initTracing(opts: TracingOptions): void {
  const { serviceName, serviceVersion = '0.1.0', otlpEndpoint, logger } = opts;

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
  });

  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = { resource };

  if (otlpEndpoint) {
    sdkConfig.traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
  }

  sdk = new NodeSDK(sdkConfig);

  sdk.start();

  logger?.info('OpenTelemetry tracing initialized', { serviceName, otlpEndpoint });

  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => logger?.info('Tracing shut down'))
      .catch((err: unknown) => logger?.error('Error shutting down tracing', { err }));
  });
}
