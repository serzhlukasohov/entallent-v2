import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural checks of the scheduled `suite-l1` job in `.github/workflows/conversation-sim.yml`
 * (architecture AD-15, Story 13.7). The package has no YAML dependency, so blocks are cut by
 * indentation; the story's verification command also parses the file as YAML.
 */
const WORKFLOW = resolve(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'conversation-sim.yml');
/** Pinned literally, so a later addition to `CREDENTIAL_NAMES` cannot widen the no-new-secret check. */
const ALLOWED_SECRETS: readonly string[] = [
  'OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_API_VERSION',
  'AZURE_OPENAI_TESTING_DEPLOYMENT',
];

/**
 * sha256 of the `authorize` and `simulate` job blocks (trailing blank lines dropped) at commit
 * 651401d3319f7af44cc77655a6fee51345f6c04f, before the scheduled L1 job was added.
 * A deliberate edit to `authorize` or `simulate` must update these pins: recompute each as the
 * sha256 hex of `block(block(lines, 'jobs', 0), '<job>', 2).join('\n')` (the extraction below),
 * for example by temporarily logging it from this test.
 */
const PRE_STORY_SHA256 = {
  authorize: '618547129304163435bd4d790387d786eb976ec7aef5f200789f6d67d758bb93',
  simulate: '054fad435cc12f89999cd344af5ec433df4eb14b2a44037fff383e7ad8382cc1',
};

const text = readFileSync(WORKFLOW, 'utf8');
const lines = text.split('\n');

const indentOf = (line: string) => line.length - line.trimStart().length;
const meaningful = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');

/**
 * The lines of the mapping entry `key:` at `indent` inside `within` (key line included, trailing
 * blank lines dropped). Any non-blank line at or above `indent`, a comment included, ends it.
 */
function block(within: readonly string[], key: string, indent: number): string[] {
  const start = within.findIndex((line) => indentOf(line) === indent && line.trimStart().startsWith(`${key}:`) && meaningful(line));
  if (start < 0) throw new Error(`no ${key}: at indent ${indent}`);
  const result = [within[start]!];
  for (const line of within.slice(start + 1)) {
    if (line.trim() !== '' && indentOf(line) <= indent) break;
    result.push(line);
  }
  while (result.length > 1 && result.at(-1)!.trim() === '') result.pop();
  return result;
}

/** Sequence items (`- ...`) at `indent` inside `within`. */
function items(within: readonly string[], indent: number): string[][] {
  const result: string[][] = [];
  for (const line of within) {
    if (meaningful(line) && indentOf(line) === indent && line.trimStart().startsWith('- ')) result.push([line]);
    else if (result.length > 0 && (!meaningful(line) || indentOf(line) > indent)) result.at(-1)!.push(line);
  }
  return result;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const jobs = block(lines, 'jobs', 0);
const jobNames = jobs.filter((line) => indentOf(line) === 2 && meaningful(line)).map((line) => line.trim().replace(/:.*$/, ''));
const suiteJob = block(jobs, 'suite-l1', 2);
const suiteSteps = items(block(suiteJob, 'steps', 4), 6);
const stepNamed = (name: string) => {
  const step = suiteSteps.find((entry) => entry.some((line) => line.trim() === `name: ${name}` || line.trim() === `- name: ${name}`));
  if (!step) throw new Error(`no step ${name}`);
  return step.join('\n');
};
const credentialsStep = stepNamed('Check L1 credentials');
const runStep = stepNamed('Suite L1 scheduled run and merge-base diff');
const uploadStep = stepNamed('Upload suite runs');
const linkStep = stepNamed('Link suite runs');

describe('conversation-sim.yml suite-l1 job', () => {
  it('keeps the on: block: workflow_dispatch, both crons and no pull_request', () => {
    const on = block(lines, 'on', 0).join('\n');
    expect(on).toContain('  workflow_dispatch:');
    expect(on).toContain("    - cron: '17 2 * * *'");
    expect(on).toContain("    - cron: '23 3 * * 0'");
    expect(on).not.toMatch(/pull_request|push:/);
    expect(block(lines, 'permissions', 0).map((line) => line.trim())).toEqual(['permissions:', 'contents: read']);
  });

  it('has the jobs authorize, simulate and suite-l1', () => {
    expect(jobNames).toEqual(['authorize', 'simulate', 'suite-l1']);
  });

  it('leaves the authorize and simulate jobs byte-identical to the pre-story text', () => {
    expect(sha256(block(jobs, 'authorize', 2).join('\n'))).toBe(PRE_STORY_SHA256.authorize);
    expect(sha256(block(jobs, 'simulate', 2).join('\n'))).toBe(PRE_STORY_SHA256.simulate);
  });

  it('suite-l1 needs authorize and runs only when should_run is true', () => {
    expect(suiteJob).toContain('    name: Suite L1 scheduled run');
    expect(suiteJob).toContain('    needs: authorize');
    expect(suiteJob).toContain("    if: needs.authorize.outputs.should_run == 'true'");
    expect(suiteJob).toContain('    timeout-minutes: 180');
    expect(suiteJob.join('\n')).not.toMatch(/^ {4}permissions:/m);
  });

  it('runs its steps in order: checkout, setup, install, build, credentials, run, upload, link', () => {
    const index = (needle: string) => suiteSteps.findIndex((step) => step.join('\n').includes(needle));
    const order = [
      index('actions/checkout@'),
      index('pnpm/action-setup@'),
      index('actions/setup-node@'),
      index('pnpm install --frozen-lockfile'),
      index('pnpm turbo run build --filter=@entalent/conversation-sim^...'),
      suiteSteps.findIndex((step) => step.join('\n') === credentialsStep),
      suiteSteps.findIndex((step) => step.join('\n') === runStep),
      suiteSteps.findIndex((step) => step.join('\n') === uploadStep),
      suiteSteps.findIndex((step) => step.join('\n') === linkStep),
    ];
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const checkout = suiteSteps[0]!.join('\n');
    expect(checkout).toContain('fetch-depth: 0');
    expect(checkout).toContain('persist-credentials: false');
    const node = suiteSteps[2]!.join('\n');
    expect(node).toContain("node-version: '24'");
    expect(node).toContain('cache: pnpm');
  });

  it('the credentials check reads presence booleans only and fails closed with an error annotation', () => {
    expect(credentialsStep).toContain('working-directory: packages/conversation-sim');
    expect(credentialsStep).toContain('node --import tsx src/suite/l1-gate.ts credentials');
    expect(credentialsStep).toContain('echo \'::error::');
    expect(credentialsStep).toContain('exit 1');
    for (const name of ALLOWED_SECRETS) expect(credentialsStep).toContain(`HAS_${name}: \${{ secrets.${name} != '' }}`);
    const refs = [...credentialsStep.matchAll(/\$\{\{[^}]*secrets\.[^}]*\}\}/g)].map((match) => match[0]);
    expect(refs).toHaveLength(ALLOWED_SECRETS.length);
    for (const ref of refs) expect(ref).toMatch(/^\$\{\{ secrets\.[A-Z_]+ != '' \}\}$/);
  });

  it('the run step calls run-live ci with the authorize runs, --include-unbaselined and --live-model', () => {
    expect(runStep).toContain('working-directory: packages/conversation-sim');
    expect(runStep).toContain('RUNS: ${{ needs.authorize.outputs.runs }}');
    expect(runStep).toContain(
      'run: node --import tsx src/suite/run-live.ts ci --level L1 --runs "$RUNS" --include-unbaselined --live-model --summary "$GITHUB_STEP_SUMMARY"',
    );
    expect(runStep).toContain('OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}');
    expect(runStep).toContain("LANGWATCH_API_KEY: ''");
    for (const name of ALLOWED_SECRETS) expect(runStep).toContain(`${name}: \${{ secrets.${name} }}`);
    // A single command: the step exits with the ci exit code.
    expect(runStep).not.toMatch(/set \+e|\|\| true|exit 0/);
  });

  it('within suite-l1 only the run step carries secret values, and --live-model appears only there', () => {
    const job = suiteJob.join('\n');
    const rawRefs = (value: string) => value.split(/\$\{\{ secrets\.[A-Z_]+ \}\}/).length - 1;
    expect(rawRefs(runStep)).toBe(ALLOWED_SECRETS.length + 1);
    expect(rawRefs(job)).toBe(rawRefs(runStep));
    expect(suiteJob.filter(meaningful).join('\n').split('--live-model').length - 1).toBe(1);
    expect(runStep).toContain('--live-model');
  });

  it('every secrets.<NAME> in the workflow is one of the allowed five', () => {
    const names = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ALLOWED_SECRETS).toContain(name);
    expect(text).not.toMatch(/secrets\s*:\s*inherit|toJSON\(secrets\)/);
  });

  it('uploads runs/suites/** always, for 14 days, and links the artifact when present', () => {
    expect(uploadStep).toContain('actions/upload-artifact@');
    expect(uploadStep).toContain('id: upload');
    expect(uploadStep).toMatch(/if: always\(\)$/m);
    expect(uploadStep).toContain('name: suite-l1-scheduled-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(uploadStep).toContain('path: packages/conversation-sim/runs/suites/**');
    expect(uploadStep).toContain('if-no-files-found: ignore');
    expect(uploadStep).toContain('retention-days: 14');
    expect(linkStep).toContain("if: always() && steps.upload.outputs.artifact-url != ''");
    expect(linkStep).toContain('ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}');
    expect(linkStep).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });
});
