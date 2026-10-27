import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runL2Stack, tenantFromSeedLog, workerEnvLines } from './l2-stack';

const PACKAGE_DIR = resolve(__dirname, '..', '..');
const TENANT = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
const SEED_LOG = [
  '> tsx packages/database/src/seed.ts',
  'Seeding database...',
  '✓ Created tenant: enTalent Dev',
  '',
  `Tenant ID: ${TENANT}`,
  `Set DEFAULT_TENANT_ID=${TENANT} in your .env for dev convenience.`,
  '',
].join('\n');

describe('tenantFromSeedLog', () => {
  it('returns the single tenant id', () => {
    expect(tenantFromSeedLog(SEED_LOG)).toBe(TENANT);
    expect(tenantFromSeedLog(`Tenant ID: ${TENANT.toUpperCase()}\r\n`)).toBe(TENANT);
  });

  it('names the problem for zero, two or a non-UUID line, never the value', () => {
    expect(() => tenantFromSeedLog('Seeding database...\n')).toThrow('no "Tenant ID:" line in the seed log');
    expect(() => tenantFromSeedLog(`${SEED_LOG}\nTenant ID: ${TENANT}\n`)).toThrow(/^2 "Tenant ID:" lines in the seed log, expected one/);
    let message = '';
    try {
      tenantFromSeedLog('Tenant ID: tenant-from-a-private-db\n');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('the "Tenant ID:" line does not hold a UUID');
    expect(message).not.toContain('tenant-from-a-private-db');
  });
});

describe('the seed producer line (packages/database/src/seed.ts)', () => {
  it('logs exactly one Tenant ID template line, which tenantFromSeedLog parses', () => {
    const source = readFileSync(resolve(PACKAGE_DIR, '..', 'database', 'src', 'seed.ts'), 'utf8');
    const producers = source.split('\n').filter((line) => /console\.\w+\(/.test(line) && line.includes('Tenant ID: ${tenantId}'));
    expect(producers).toHaveLength(1);
    const template = /`([^`]*Tenant ID: \$\{tenantId\}[^`]*)`/.exec(producers[0]!)![1]!;
    const rendered = template.replace('${tenantId}', TENANT).replace(/\\n/g, '\n');
    expect(tenantFromSeedLog(`Seeding database...\n${rendered}\n`)).toBe(TENANT);
  });
});

describe('runL2Stack', () => {
  let dir: string;
  let out: string[];
  let err: string[];
  const deps = () => ({ cwd: dir, packageDir: dir, log: (line: string) => out.push(line), error: (line: string) => err.push(line) });
  const committedConfig = () => JSON.parse(readFileSync(join(PACKAGE_DIR, 'suite.config.json'), 'utf8')) as Record<string, unknown>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-l2-stack-'));
    out = [];
    err = [];
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify(committedConfig()));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('tenant-from-seed prints only the UUID', () => {
    writeFileSync(join(dir, 'seed.log'), SEED_LOG);
    expect(runL2Stack(['tenant-from-seed', 'seed.log'], deps())).toBe(0);
    expect(out).toEqual([TENANT]);
    expect(err).toEqual([]);
  });

  it.each([
    ['zero', 'Seeding database...\n', '[suite] l2-stack: no "Tenant ID:" line in the seed log'],
    ['two', `${SEED_LOG}Tenant ID: ${TENANT}\n`, '[suite] l2-stack: 2 "Tenant ID:" lines in the seed log, expected one'],
    ['non-UUID', 'Tenant ID: not-a-uuid\n', '[suite] l2-stack: the "Tenant ID:" line does not hold a UUID'],
  ])('tenant-from-seed exits 1 on %s Tenant ID line(s), printing nothing to stdout', (_name, log, message) => {
    writeFileSync(join(dir, 'seed.log'), log);
    expect(runL2Stack(['tenant-from-seed', 'seed.log'], deps())).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toContain(message);
    expect(err[0]).not.toContain('not-a-uuid');
  });

  it('tenant-from-seed exits 1 on a missing log or a wrong argument count', () => {
    expect(runL2Stack(['tenant-from-seed', 'absent.log'], deps())).toBe(1);
    expect(err[0]).toBe('[suite] l2-stack: cannot read the seed log absent.log (ENOENT)');
    expect(runL2Stack(['tenant-from-seed'], deps())).toBe(1);
    expect(err[1]).toContain('tenant-from-seed takes exactly one seed log path');
    expect(out).toEqual([]);
  });

  it('worker-env writes l2.workerEnv as KEY=VALUE lines', () => {
    expect(runL2Stack(['worker-env', '--output', 'worker.env'], deps())).toBe(0);
    expect(readFileSync(join(dir, 'worker.env'), 'utf8')).toBe('PROACTIVE_SCAN_ENABLED=false\n');
    expect(out).toEqual(['[suite] l2-stack: wrote the worker env (PROACTIVE_SCAN_ENABLED) to worker.env']);
    expect(workerEnvLines({ A_B: '1', C: 'x' })).toBe('A_B=1\nC=x\n');
  });

  it('worker-env exits 1 when l2.workerEnv is absent, or without --output, writing nothing', () => {
    const config = committedConfig();
    delete config.l2;
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify(config));
    expect(runL2Stack(['worker-env', '--output', 'worker.env'], deps())).toBe(1);
    expect(err[0]).toBe(
      '[suite] l2-stack: worker-env: suite.config.json l2.workerEnv is absent; the L2 stack worker cannot be started with proactive scheduling off',
    );
    expect(existsSync(join(dir, 'worker.env'))).toBe(false);
    expect(runL2Stack(['worker-env'], deps())).toBe(1);
    expect(err[1]).toContain('worker-env: --output <file> is required');
  });

  it('refuses an unknown command', () => {
    expect(runL2Stack(['seed'], deps())).toBe(1);
    expect(err).toEqual(['[suite] l2-stack: usage: l2-stack.ts tenant-from-seed <seed-log> | worker-env --output <file>']);
  });

  it('runs in plain Node with tsx and prints only the tenant id on stdout', () => {
    writeFileSync(join(dir, 'seed.log'), SEED_LOG);
    const result = spawnSync(process.execPath, ['--import', 'tsx', join(PACKAGE_DIR, 'src', 'suite', 'l2-stack.ts'), 'tenant-from-seed', join(dir, 'seed.log')], {
      cwd: PACKAGE_DIR,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${TENANT}\n`);
  });
});

describe('l2-stack imports', () => {
  it('imports Node builtins and loadSuiteConfig only: no executor, database or network module', () => {
    const source = readFileSync(join(__dirname, 'l2-stack.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports.filter((name) => !name!.startsWith('node:'))).toEqual(['./config']);
    expect(source).not.toMatch(/require\(|fetch\(|process\.env\.[A-Z]/);
  });
});
