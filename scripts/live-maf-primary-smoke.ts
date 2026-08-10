import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  resolveMafShadowLiveSmokeEnv,
} from '../packages/application/src/use-cases/maf-shadow-live-smoke';
import {
  runMafPrimaryLiveSmoke,
} from '../packages/application/src/use-cases/maf-primary-live-smoke';

const repoRoot = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, '');
const agentServiceDir = join(repoRoot, 'agent-service');
const pythonPath = join(agentServiceDir, '.venv', 'bin', 'python');
const serviceHost = '127.0.0.1';
const healthTimeoutMs = 15_000;
const healthProbeTimeoutMs = 1_000;
const SECRET_LIKE_PATTERN = /(api[_-]?key|bearer|password|secret|token|xox[abprs]-|sk-[A-Za-z0-9_-]+)/i;
let activeChild: ReturnType<typeof spawn> | undefined;

async function main(): Promise<void> {
  registerShutdownHandlers();
  const envResolution = resolveMafShadowLiveSmokeEnv(process.env);
  if (envResolution.missingConfigKeys.length > 0 || envResolution.invalidConfigKeys) {
    printEvidence({
      status: envResolution.invalidConfigKeys ? 'configuration_invalid' : 'configuration_missing',
      validationStatus: 'not_run',
      missingConfigKeys: envResolution.missingConfigKeys,
      ...(envResolution.invalidConfigKeys ? { invalidConfigKeys: envResolution.invalidConfigKeys } : {}),
    });
    process.exitCode = 2;
    return;
  }

  if (!existsSync(pythonPath)) {
    printEvidence({
      status: 'configuration_missing',
      validationStatus: 'not_run',
      missingConfigKeys: ['agent-service/.venv/bin/python'],
    });
    process.exitCode = 2;
    return;
  }

  const port = await reserveLoopbackPort();
  const serviceUrl = `http://${serviceHost}:${port}`;
  const child = spawnAgentService(port, envResolution.env);
  activeChild = child;

  try {
    await waitForHealth(serviceUrl, child);
    const evidence = await runMafPrimaryLiveSmoke({
      serviceUrl,
      timeoutMs: 30_000,
    });
    printEvidence(evidence);
    process.exitCode = evidence.status === 'valid' ? 0 : 1;
  } catch (error) {
    printEvidence({
      status: 'invalid',
      validationStatus: 'not_run',
      failureReason: safeFailureReason(error),
    });
    process.exitCode = 1;
  } finally {
    await stopChild(child);
    activeChild = undefined;
  }
}

function spawnAgentService(port: number, smokeEnv: Record<string, string>) {
  const child = spawn(
    pythonPath,
    [
      '-m',
      'uvicorn',
      'agent_service.main:create_app',
      '--factory',
      '--host',
      serviceHost,
      '--port',
      String(port),
      '--log-level',
      'warning',
    ],
    {
      cwd: agentServiceDir,
      env: {
        ...process.env,
        ...smokeEnv,
        PYTHONPATH: join(agentServiceDir, 'src'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  child.stderr?.on('data', () => {
    // Drain stderr so uvicorn/provider warnings cannot block the child or leak.
  });
  return child;
}

function registerShutdownHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const child = activeChild;
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
      process.exitCode = 130;
      setTimeout(() => process.exit(130), 250).unref();
    });
  }
}

async function waitForHealth(serviceUrl: string, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + healthTimeoutMs;
  let childExited = false;
  let childFailed = false;
  child.once('exit', () => {
    childExited = true;
  });
  child.once('error', () => {
    childFailed = true;
  });

  while (Date.now() < deadline) {
    if (childFailed || childExited) {
      throw new Error('agent_service_failed_to_start');
    }

    try {
      const response = await fetchWithTimeout(`${serviceUrl}/health/ready`, healthProbeTimeoutMs);
      const body = await response.json().catch(() => undefined);
      if (
        response.ok
        && typeof body === 'object'
        && body !== null
        && 'service' in body
        && body.service === 'agent-service'
      ) {
        return;
      }
    } catch {
      // Service is still booting.
    }

    await delay(250);
  }

  throw new Error('agent_service_health_timeout');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, serviceHost, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('loopback_port_unavailable')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(3_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

function safeFailureReason(error: unknown): string {
  if (
    error instanceof Error
    && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.message)
    && !SECRET_LIKE_PATTERN.test(error.message)
  ) {
    return error.message;
  }

  return 'live_primary_smoke_failed';
}

function printEvidence(evidence: unknown): void {
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error: unknown) => {
  printEvidence({
    status: 'invalid',
    validationStatus: 'not_run',
    failureReason: safeFailureReason(error),
  });
  process.exitCode = 1;
});
