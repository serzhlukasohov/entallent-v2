import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRuntimeContract } from './runtime-contract-validation';

type ValidFixture = {
  schemaName: string;
  path: string;
};

type InvalidFixture = ValidFixture & {
  expectedErrorCategory: string;
};

type FixtureManifest = {
  valid: ValidFixture[];
  invalid: InvalidFixture[];
};

const runtimeRoot = join(process.cwd(), 'runtime');
const schemaDocument = readJson('openapi.json');
const manifest = readJson('fixtures/manifest.json') as FixtureManifest;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(runtimeRoot, relativePath), 'utf8'));
}

describe('Runtime contract fixtures', () => {
  it.each(manifest.valid)('accepts valid $path', (fixture) => {
    const result = validateRuntimeContract({
      schemaDocument,
      schemaName: fixture.schemaName,
      value: readJson(`fixtures/${fixture.path}`),
    });

    expect(result).toEqual({ ok: true });
  });

  it.each(manifest.invalid)(
    'rejects invalid $path with $expectedErrorCategory',
    (fixture) => {
      const result = validateRuntimeContract({
        schemaDocument,
        schemaName: fixture.schemaName,
        value: readJson(`fixtures/${fixture.path}`),
      });

      expect(result).toMatchObject({
        ok: false,
        errorCategory: fixture.expectedErrorCategory,
      });
    },
  );
});
