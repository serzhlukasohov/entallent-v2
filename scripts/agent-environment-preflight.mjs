#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

const BASELINE_ENV_KEYS = ['DATABASE_URL', 'REDIS_URL', 'FIELD_ENCRYPTION_KEY'];
const PROD_SMOKE_ENV_KEYS = [
  'ADMIN_API_KEY',
  'SLACK_SIGNING_SECRET',
  'INTERNAL_SERVICE_AUTH_SECRET',
];
const GATE_SCRIPTS = [
  ['gate-prepush', 'prepush'],
  ['gate-prepush-non-maf', 'prepush:non-maf'],
  ['gate-test-scripts-non-maf', 'test:scripts:non-maf'],
  ['gate-test-scripts-maf', 'test:scripts:maf'],
  ['gate-test-scripts', 'test:scripts'],
];

export function parseEnvFile(text) {
  const values = parseEnvValues(text);
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { present: value.trim().length > 0 }]),
  );
}

export function classifyCommandResult(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (/EPERM|EACCES|operation not permitted|permission denied/i.test(output)) {
    return {
      status: 'blocked',
      detail: `${result.command} is blocked by the local sandbox or permissions`,
    };
  }
  if (result.status === 0) {
    return { status: 'pass', detail: `${result.command} succeeded` };
  }
  return {
    status: 'fail',
    detail: `${result.command} exited ${result.status ?? 'unknown'}`,
  };
}

export function resolvePreflightOptions(args = []) {
  const options = { profile: 'local', allowBlocked: false };
  for (const arg of args) {
    if (arg === '--allow-blocked') {
      options.allowBlocked = true;
      continue;
    }
    if (arg.startsWith('--profile=')) {
      const profile = arg.slice('--profile='.length);
      if (profile !== 'local' && profile !== 'prod-smoke') {
        throw new Error(`Unsupported preflight profile: ${profile}`);
      }
      options.profile = profile;
    }
  }
  return options;
}

export async function buildPreflightReport(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const readTextFile = options.readTextFile ?? ((filePath) => readFile(filePath, 'utf8'));
  const exists = options.exists ?? pathExists;
  const runCommand = options.runCommand ?? runShellCommand;
  const checkTcp = options.checkTcp ?? checkTcpUrl;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const profile = options.profile ?? 'local';
  const allowBlocked = Boolean(options.allowBlocked);

  const checks = [];
  const packageJson = await readJson(readTextFile, path.join(rootDir, 'package.json'));
  const scripts = packageJson.scripts ?? {};

  checks.push(await checkNodeVersion({ rootDir, nodeVersion, readTextFile }));
  checks.push(await checkPnpmVersion({ packageManager: packageJson.packageManager, runCommand }));
  checks.push(await checkDependencyFiles({ rootDir, exists }));
  checks.push(...(await checkEnvironment({ rootDir, readTextFile, checkTcp, profile })));
  checks.push(await checkDocker(runCommand));
  checks.push(await checkTsxIpc(runCommand));
  checks.push(...checkGates(scripts));

  return {
    exitCode: checks.some((check) => check.status === 'fail')
      ? 1
      : checks.some((check) => check.status === 'blocked') && !allowBlocked
        ? 2
        : 0,
    checks,
    profile,
    allowBlocked,
  };
}

export function formatReport(report) {
  const rows = [
    'Agent environment preflight',
    `Profile: ${report.profile ?? 'local'}`,
    `Exit: ${report.exitCode}`,
    '',
    ...report.checks.map(
      (check) => `${symbolFor(check.status)} ${check.id}: ${check.status} - ${check.detail}`,
    ),
  ];
  return rows.join('\n');
}

async function checkNodeVersion({ rootDir, nodeVersion, readTextFile }) {
  const expected = await readExpectedNodeVersion(rootDir, readTextFile);
  if (!expected) {
    return {
      id: 'node-version',
      status: 'warn',
      detail: `current Node ${nodeVersion}; no CI pin found`,
    };
  }
  const actualMajor = nodeVersion.split('.')[0];
  const expectedMajor = expected.replace(/^v/, '').split('.')[0];
  if (actualMajor === expectedMajor) {
    return {
      id: 'node-version',
      status: 'pass',
      detail: `Node ${nodeVersion} matches ${expected}`,
    };
  }
  return {
    id: 'node-version',
    status: 'warn',
    detail: `current Node ${nodeVersion}; CI/repo expects ${expected}`,
  };
}

async function readExpectedNodeVersion(rootDir, readTextFile) {
  try {
    const nodeVersion = (await readTextFile(path.join(rootDir, '.node-version'))).trim();
    if (nodeVersion) return nodeVersion;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  try {
    const workflow = await readTextFile(path.join(rootDir, '.github/workflows/ci.yml'));
    return workflow.match(/NODE_VERSION:\s*['"]?([^'"\n]+)['"]?/)?.[1]?.trim() ?? null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function checkPnpmVersion({ packageManager, runCommand }) {
  const result = await runCommand('pnpm -v');
  const classified = classifyCommandResult(result);
  if (classified.status !== 'pass') {
    return { id: 'pnpm-version', ...classified };
  }
  const expected = packageManager?.match(/^pnpm@(.+)$/)?.[1];
  const actual = result.stdout.trim();
  if (!expected) {
    return {
      id: 'pnpm-version',
      status: 'warn',
      detail: `pnpm ${actual}; packageManager is not pinned`,
    };
  }
  if (actual === expected) {
    return { id: 'pnpm-version', status: 'pass', detail: `pnpm ${actual} matches packageManager` };
  }
  return {
    id: 'pnpm-version',
    status: 'warn',
    detail: `pnpm ${actual}; packageManager expects ${expected}`,
  };
}

async function checkDependencyFiles({ rootDir, exists }) {
  const hasNodeModules = await exists(path.join(rootDir, 'node_modules'));
  const hasLockfile = await exists(path.join(rootDir, 'pnpm-lock.yaml'));
  if (hasNodeModules && hasLockfile) {
    return {
      id: 'dependencies',
      status: 'pass',
      detail: 'node_modules and pnpm-lock.yaml are present',
    };
  }
  if (!hasLockfile) {
    return { id: 'dependencies', status: 'fail', detail: 'pnpm-lock.yaml is missing' };
  }
  return {
    id: 'dependencies',
    status: 'warn',
    detail: 'node_modules is missing; run pnpm install',
  };
}

async function checkEnvironment({ rootDir, readTextFile, checkTcp, profile }) {
  let envText = '';
  try {
    envText = await readTextFile(path.join(rootDir, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [{ id: 'env-file', status: 'fail', detail: '.env is missing' }];
  }

  const env = parseEnvValues(envText);
  const checks = [
    { id: 'env-file', status: 'pass', detail: '.env is present' },
    ...BASELINE_ENV_KEYS.map((key) =>
      env[key]?.trim()
        ? { id: `env-${key}`, status: 'pass', detail: `${key}=set` }
        : { id: `env-${key}`, status: 'fail', detail: `${key}=missing` },
    ),
    checkModelProvider(env),
    ...(profile === 'prod-smoke'
      ? PROD_SMOKE_ENV_KEYS.map((key) => checkProdSmokeKey(key, env))
      : []),
  ];

  checks.push(await checkServiceUrl('postgres', env.DATABASE_URL, checkTcp));
  checks.push(await checkServiceUrl('redis', env.REDIS_URL, checkTcp));
  return checks;
}

function checkModelProvider(env) {
  const hasOpenAi = Boolean(env.OPENAI_API_KEY?.trim());
  const hasAzure = Boolean(
    env.AZURE_OPENAI_ENDPOINT?.trim() &&
    env.AZURE_OPENAI_API_KEY?.trim() &&
    env.AZURE_OPENAI_API_VERSION?.trim(),
  );
  if (hasOpenAi || hasAzure) {
    return {
      id: 'env-model-provider',
      status: 'pass',
      detail: hasAzure ? 'Azure OpenAI provider env is set' : 'OpenAI provider env is set',
    };
  }
  return {
    id: 'env-model-provider',
    status: 'fail',
    detail: 'OPENAI_API_KEY or complete Azure OpenAI env is missing',
  };
}

function checkProdSmokeKey(key, env) {
  if (env[key]?.trim()) {
    return { id: `env-${key}`, status: 'pass', detail: `${key}=set` };
  }
  return {
    id: `env-${key}`,
    status: 'fail',
    detail: `${key}=missing; required for prod-smoke profile`,
  };
}

async function checkServiceUrl(id, rawUrl, checkTcp) {
  if (!rawUrl?.trim()) {
    return { id: `${id}-tcp`, status: 'fail', detail: `${id.toUpperCase()} URL is missing` };
  }
  const result = await checkTcp(rawUrl);
  return { id: `${id}-tcp`, ...result };
}

async function checkDocker(runCommand) {
  const result = await runCommand('docker compose ps');
  return { id: 'docker-compose', ...classifyCommandResult(result) };
}

async function checkTsxIpc(runCommand) {
  const result = await runCommand('pnpm exec tsx -e "console.log(\'tsx-ok\')"');
  return { id: 'tsx-ipc', ...classifyCommandResult(result) };
}

function checkGates(scripts) {
  return GATE_SCRIPTS.map(([id, scriptName]) => {
    if (scripts[scriptName]) {
      return { id, status: 'pass', detail: `${scriptName}: ${scripts[scriptName]}` };
    }
    return { id, status: 'warn', detail: `${scriptName} script is missing` };
  });
}

function parseEnvValues(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = stripQuotes(match[2].trim());
  }
  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readJson(readTextFile, filePath) {
  return JSON.parse(await readTextFile(filePath));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runShellCommand(command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      timeout: 10_000,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ command, status: 127, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (status) => {
      resolve({ command, status, stdout, stderr });
    });
  });
}

function checkTcpUrl(rawUrl) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      resolve({ status: 'fail', detail: 'configured URL is invalid' });
      return;
    }

    const port = Number(url.port || (url.protocol === 'postgresql:' ? 5432 : 6379));
    const socket = net.connect(port, url.hostname);
    socket.setTimeout(2_000);
    socket.on('connect', () => {
      resolve({ status: 'pass', detail: `${url.protocol}//${url.hostname}:${port} is reachable` });
      socket.end();
    });
    socket.on('timeout', () => {
      resolve({ status: 'fail', detail: `${url.protocol}//${url.hostname}:${port} timed out` });
      socket.destroy();
    });
    socket.on('error', (error) => {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        resolve({
          status: 'blocked',
          detail: `${url.protocol}//${url.hostname}:${port} is blocked by sandbox networking`,
        });
        return;
      }
      resolve({ status: 'fail', detail: `${url.protocol}//${url.hostname}:${port} ${error.code}` });
    });
  });
}

function symbolFor(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  if (status === 'blocked') return 'BLOCKED';
  return 'FAIL';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = resolvePreflightOptions(process.argv.slice(2));
  const report = await buildPreflightReport(options);
  console.log(formatReport(report));
  process.exitCode = report.exitCode;
}
