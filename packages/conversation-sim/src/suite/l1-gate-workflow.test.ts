import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { L1_GATE_VARIABLE } from './l1-gate';

/**
 * Structural checks of `.github/workflows/conversation-suite-l1-pr.yml` (architecture AD-15).
 * The package has no YAML dependency, so blocks are cut by indentation; the file is also
 * parsed as YAML by the story's verification command.
 */
const WORKFLOW = resolve(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'conversation-suite-l1-pr.yml');
const ALLOWED_SECRETS = ['OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_API_VERSION', 'AZURE_OPENAI_TESTING_DEPLOYMENT'];

const text = readFileSync(WORKFLOW, 'utf8');
const lines = text.split('\n');

const indentOf = (line: string) => line.length - line.trimStart().length;
const meaningful = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');

/** The lines of the mapping entry `key:` at `indent` inside `within` (the key line included). */
function block(within: readonly string[], key: string, indent: number): string[] {
  const start = within.findIndex((line) => indentOf(line) === indent && line.trimStart().startsWith(`${key}:`) && meaningful(line));
  if (start < 0) throw new Error(`no ${key}: at indent ${indent}`);
  const result = [within[start]!];
  for (const line of within.slice(start + 1)) {
    if (meaningful(line) && indentOf(line) <= indent) break;
    result.push(line);
  }
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

const jobs = block(lines, 'jobs', 0);
const changesJob = block(jobs, 'changes', 2);
const l1Job = block(jobs, 'l1', 2);
const l1Steps = items(block(l1Job, 'steps', 4), 6);
const changesSteps = items(block(changesJob, 'steps', 4), 6);
const stepNamed = (steps: string[][], name: string) => {
  const step = steps.find((entry) => entry.some((line) => line.trim() === `name: ${name}` || line.trim() === `- name: ${name}`));
  if (!step) throw new Error(`no step ${name}`);
  return step.join('\n');
};
const liveStep = stepNamed(l1Steps, 'Suite L1 run and merge-base diff');

describe('conversation-suite-l1-pr.yml', () => {
  it('triggers on pull_request to main and develop with default types and no paths filter', () => {
    const on = block(lines, 'on', 0).join('\n');
    expect(on).toContain('  pull_request:');
    expect(on).toContain('branches: [main, develop]');
    expect(on).not.toMatch(/types:/);
    expect(on).not.toMatch(/push:|schedule:|workflow_dispatch:|pull_request_target:/);
    expect(text).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it('reads contents only and cancels superseded runs per pull request', () => {
    expect(block(lines, 'permissions', 0).map((line) => line.trim())).toEqual(['permissions:', 'contents: read', '']);
    const concurrency = block(lines, 'concurrency', 0).join('\n');
    expect(concurrency).toContain('${{ github.event.pull_request.number }}');
    expect(concurrency).toContain('cancel-in-progress: true');
  });

  it('has a changes job and an l1 job with fixed names; l1 always runs after changes', () => {
    expect(changesJob).toContain('    name: Suite L1 changes');
    expect(l1Job).toContain('    name: Suite L1 gate');
    expect(l1Job).toContain('    needs: changes');
    expect(l1Job).toContain("    if: ${{ !cancelled() }}");
    expect(l1Job.join('\n')).not.toMatch(/^ {4}if: always\(\)/m);
    expect(l1Job).toContain('    timeout-minutes: 120');
    expect(block(l1Job, 'permissions', 4).map((line) => line.trim())).toEqual(['permissions:', 'contents: read', 'pull-requests: read']);
    const outputs = block(changesJob, 'outputs', 4).join('\n');
    for (const name of ['changed', 'decision', 'message']) expect(outputs).toMatch(new RegExp(`^      ${name}: \\$\\{\\{ steps\\.`, 'm'));
  });

  it('the changes job runs the tested path filter and decision, with presence booleans only', () => {
    const job = changesJob.join('\n');
    expect(job).toContain('src/suite/l1-gate.ts changes --base "$BASE_SHA" --head "$HEAD_SHA" --output "$GITHUB_OUTPUT"');
    expect(job).toContain('src/suite/l1-gate.ts decide --changed "$CHANGED" --output "$GITHUB_OUTPUT"');
    expect(job).toContain(`L1_GATE_ENABLED: \${{ vars.${L1_GATE_VARIABLE} }}`);
    expect(job).toContain('L1_GATE_FORK: ${{ github.event.pull_request.head.repo.full_name != github.repository }}');
    for (const name of ALLOWED_SECRETS) expect(job).toContain(`HAS_${name}: \${{ secrets.${name} != '' }}`);
    const secretRefs = [...job.matchAll(/\$\{\{[^}]*secrets\.[^}]*\}\}/g)].map((match) => match[0]);
    expect(secretRefs).toHaveLength(ALLOWED_SECRETS.length);
    for (const ref of secretRefs) expect(ref).toMatch(/^\$\{\{ secrets\.[A-Z_]+ != '' \}\}$/);
  });

  it('every checkout fetches full history without persisted credentials', () => {
    const checkouts = [...changesSteps, ...l1Steps].filter((step) => step[0]!.includes('actions/checkout@'));
    expect(checkouts).toHaveLength(2);
    for (const step of checkouts) {
      const body = step.join('\n');
      expect(body).toContain('fetch-depth: 0');
      expect(body).toContain('persist-credentials: false');
    }
  });

  it('the first l1 step fails closed on a failed changes job and an error decision, and passes a skip with a notice', () => {
    const first = l1Steps[0]!.join('\n');
    expect(first).toContain('name: Gate decision');
    expect(first).toContain("if [ \"$CHANGES_RESULT\" != 'success' ]; then");
    expect(first).toContain('CHANGES_RESULT: ${{ needs.changes.result }}');
    expect(first).toContain('echo "::notice::$MESSAGE"');
    expect(first).toContain('echo "::error::$MESSAGE"');
    expect(first).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(first).not.toMatch(/secrets\./);
    expect(first).toMatch(/run\)\n\s+echo "\$MESSAGE"\n\s+echo 'run=true' >> "\$GITHUB_OUTPUT"/);
    expect(first).toMatch(/\*\)\n(\s+echo .*\n)?\s+exit 1/);
    // Every later step runs only on a run decision.
    for (const step of l1Steps.slice(1, -1)) expect(step.join('\n')).toMatch(/if: (always\(\) && )?steps\.gate\.outputs\.run == 'true'/);
  });

  it('the Decide step tolerates only a written decision=error and passes other non-zero codes through', () => {
    const decideStep = stepNamed(changesSteps, 'Decide');
    expect(decideStep).toContain('set +e');
    expect(decideStep).toContain(`if [ "$code" -ne 0 ] && ! grep -qx 'decision=error' "$GITHUB_OUTPUT"; then exit "$code"; fi`);
  });

  it('the l1 job sees no fork flag and no presence booleans', () => {
    const job = l1Job.join('\n');
    expect(job).not.toContain('L1_GATE_FORK');
    expect(job).not.toContain('HAS_');
  });

  it('the live step keeps its exit code while teeing, and prints a notice when there is nothing to check', () => {
    expect(liveStep).toContain('set -o pipefail');
    expect(liveStep).toContain('| tee "$RUNNER_TEMP/suite-l1-ci.log"');
    expect(liveStep).toContain(`if grep -q 'gate passes with nothing to check' "$RUNNER_TEMP/suite-l1-ci.log"; then`);
    expect(liveStep).toContain(
      "echo '::notice::L1 gate passed with nothing to check: no suite has L1 tests and an L1 baseline at the merge-base.'",
    );
  });

  it('secrets: only the allowed five, raw values only in the live run step', () => {
    const names = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(ALLOWED_SECRETS).toContain(name);
    const rawRefs = [...text.matchAll(/\$\{\{ secrets\.([A-Z_]+) \}\}/g)].map((match) => match[0]);
    expect(rawRefs.length).toBeGreaterThan(0);
    for (const ref of rawRefs) expect(liveStep).toContain(ref);
    expect(text.split(/\$\{\{ secrets\.[A-Z_]+ \}\}/).length - 1).toBe(liveStep.split(/\$\{\{ secrets\.[A-Z_]+ \}\}/).length - 1);
    expect(text).not.toMatch(/secrets\s*:\s*inherit|toJSON\(secrets\)/);
  });

  it('--live-model appears only in the live run step, which calls run-live ci --level L1', () => {
    expect(lines.filter(meaningful).join('\n').split('--live-model').length - 1).toBe(1);
    expect(liveStep).toContain('node --import tsx src/suite/run-live.ts ci --level L1 --live-model --summary "$GITHUB_STEP_SUMMARY"');
    expect(liveStep).toContain('OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}');
    expect(liveStep).toContain("LANGWATCH_API_KEY: ''");
    for (const name of ALLOWED_SECRETS) expect(liveStep).toContain(`${name}: \${{ secrets.${name} }}`);
  });

  it('builds dependencies and runs the baseline guard with live labels before the live run', () => {
    const build = l1Steps.findIndex((step) => step.join('\n').includes('pnpm turbo run build --filter=@entalent/conversation-sim^...'));
    const guardStep = stepNamed(l1Steps, 'Baseline change guard');
    const guard = l1Steps.findIndex((step) => step.join('\n') === guardStep);
    const live = l1Steps.findIndex((step) => step.join('\n') === liveStep);
    expect(build).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(build);
    expect(live).toBeGreaterThan(guard);
    expect(guardStep).toContain("gh pr view \"$PR_NUMBER\" --repo \"$GITHUB_REPOSITORY\" --json labels --jq '[.labels[].name]'");
    expect(guardStep).toContain('GH_TOKEN: ${{ github.token }}');
    expect(guardStep).toContain('src/suite/baseline-guard.ts --base "$BASE_SHA" --head "$HEAD_SHA" --labels "$labels"');
    expect(guardStep).not.toMatch(/secrets\./);
  });

  it('uploads the run reports only, never case-runs.json, and links the artifact', () => {
    expect(lines.filter(meaningful).join('\n')).not.toContain('case-runs');
    const upload = stepNamed(l1Steps, 'Upload suite reports');
    expect(upload).toContain('actions/upload-artifact@');
    expect(upload).toMatch(/if: always\(\)/);
    const paths = block(upload.split('\n'), 'path', 10).slice(1).map((line) => line.trim()).filter((line) => line !== '');
    expect(paths).toEqual(['packages/conversation-sim/runs/suites/*/report.json', 'packages/conversation-sim/runs/suites/*/report.md']);
    expect(upload).toContain('retention-days: 14');
    expect(upload).toContain('if-no-files-found: ignore');
    const link = stepNamed(l1Steps, 'Link reports');
    expect(link).toContain('steps.upload.outputs.artifact-url');
    expect(link).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it('names the opt-in variable', () => {
    expect(text).toContain(`vars.${L1_GATE_VARIABLE}`);
    expect(join(WORKFLOW)).toMatch(/conversation-suite-l1-pr\.yml$/);
  });
});
