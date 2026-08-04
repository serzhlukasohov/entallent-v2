import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioResult } from '@langwatch/scenario';
import { describeViolations, findViolations } from './assertions';
import type { CoachHarness } from './coach-harness';

const RUNS_DIR = join(process.cwd(), 'runs');

/**
 * Records what the coach actually did. A judge verdict is only useful next to the
 * modes, lengths, memory and style the deterministic layer produced, so both land
 * in the console and in `runs/<scenario>.md` for reading after the fact.
 */
export async function reportRun(
  name: string,
  harness: CoachHarness,
  result: ScenarioResult,
): Promise<void> {
  const report = await buildReport(name, harness, result);
  console.log(`\n${report}`);

  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `${slugify(name)}.md`), report, 'utf8');
}

async function buildReport(
  name: string,
  harness: CoachHarness,
  result: ScenarioResult,
): Promise<string> {
  const violations = findViolations(harness);
  const profile = await harness.styleProfile();
  const lengths = harness.replies.map((r) => r.length);

  const sections = [
    `# ${name}`,
    `Run at ${new Date().toISOString()} · ${harness.turns.length} turns · judge verdict: ${result.success ? 'PASS' : 'FAIL'}`,
    '',
    '## Judge',
    ...result.metCriteria.map((c) => `- met: ${c}`),
    ...result.unmetCriteria.map((c) => `- UNMET: ${c}`),
    result.reasoning ? `\n${result.reasoning}` : '',
    '',
    '## Deterministic checks',
    violations.length === 0 ? 'all clear' : describeViolations(violations),
    '',
    '## Turns',
    `reply lengths: ${lengths.join(', ')}`,
    '',
    ...harness.turns.flatMap((turn, index) => {
      const risk = turn.risk.severity === 'none' ? '' : ` risk=${turn.risk.severity}`;
      return [
        `**${index + 1}. [${turn.mode} / ${turn.classification.primaryIntent}${risk}] ${turn.responseText.length} chars**`,
        turn.responseText,
        '',
      ];
    }),
    '## Memory extracted',
    harness.memoryItems.length === 0
      ? 'none'
      : harness.memoryItems.map((item) => `- [${item.category}] ${item.content}`).join('\n'),
    '',
    '## Style profile',
    profile
      ? `${JSON.stringify(profile.dimensions)} · weight ${profile.adaptationWeight}`
      : 'not analysed (analyzeStyle is off for this scenario)',
  ];

  return sections.join('\n');
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
