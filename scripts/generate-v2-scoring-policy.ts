import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('_bmad-output/specs/spec-insight-analysis-v2/SCORING-POLICY.md');
const target = resolve('scripts/data/v2-scoring-policy-1.0.0.json');

const keys = {
  A1: 'autonomy_control_work', A2: 'autonomy_voice_influence', A3: 'autonomy_expectation_clarity',
  G1: 'growth_skill_development', G2: 'growth_useful_feedback', G3: 'growth_future_opportunities',
  P1: 'purpose_personal_meaning', P2: 'purpose_contribution_visibility', P3: 'purpose_recognition',
  B1: 'belonging_team', B2: 'belonging_psychological_safety', B3: 'belonging_manager_support',
} as const;

export async function compileApprovedV2Policy(markdown: string): Promise<Record<string, unknown>> {
  const approvalDate = /^approval_date: (\d{4}-\d{2}-\d{2})$/m.exec(markdown)?.[1];
  const version = /^policy_version: (\S+)$/m.exec(markdown)?.[1];
  if (!approvalDate || version !== '1.0.0') throw new Error('approved_v2_policy_metadata_invalid');
  const shared = markdown.split('## 2. Shared rules\n')[1]?.split('## 3. Canonical topics and rubrics\n')[0]
    ?.split('\n').filter((line) => /^\d+\. /.test(line)).join('\n');
  const catalog = markdown.split('## 3. Canonical topics and rubrics\n')[1]?.split('## 4. Supplemental')[0];
  if (!shared || !catalog) throw new Error('approved_v2_policy_sections_missing');

  const rubrics: Record<string, unknown> = {};
  let group = '';
  let topicId = '';
  let title = '';
  let body: string[] = [];
  const finish = () => {
    if (!topicId) return;
    const key = keys[topicId as keyof typeof keys];
    const text = body.join('\n');
    const meaning = /^\*\*Canonical meaning:\*\* (.+)$/m.exec(text)?.[1];
    const approvedAt = text.search(/^\*\*Approved example/m);
    const anchorText = approvedAt < 0 ? text : text.slice(0, approvedAt);
    const anchors = [...anchorText.matchAll(/^- \*\*(0|25|50|75|100):\*\* (.+)$/gm)]
      .map((match) => ({ score: Number(match[1]), description: match[2] }));
    const examplesText = approvedAt < 0 ? '' : text.slice(approvedAt);
    const examples = [
      ...[...examplesText.matchAll(/^- \*\*(\d+):\*\* "(.+)"$/gm)]
        .map((match) => ({ score: Number(match[1]), text: match[2] })),
      ...[...examplesText.matchAll(/^\*\*Approved example — (\d+):\*\* "(.+)"$/gm)]
        .map((match) => ({ score: Number(match[1]), text: match[2] })),
    ];
    const notes = anchorText.split('\n').filter((line) => line.trim()
      && !line.startsWith('**Canonical meaning:**') && !/^- \*\*(0|25|50|75|100):\*\*/.test(line));
    if (!key || !meaning || anchors.map((anchor) => anchor.score).join(',') !== '0,25,50,75,100'
      || examples.length === 0 || rubrics[key]) throw new Error(`approved_v2_topic_invalid:${topicId}`);
    rubrics[key] = {
      topicId, title, questionGroup: group, canonicalMeaning: meaning,
      version, approvedAt: approvalDate,
      instructions: `${shared}\n\n${meaning}${notes.length ? `\n\n${notes.join('\n')}` : ''}`,
      anchors, approvedExamples: examples,
    };
  };
  for (const line of catalog.split('\n')) {
    const section = /^### (.+)$/.exec(line);
    const topic = /^#### ([AGPB][1-3]) — (.+)$/.exec(line);
    if (section) {
      finish();
      topicId = '';
      group = section[1]!.startsWith('Belonging') ? 'belonging' : section[1]!.toLowerCase();
    }
    if (topic) {
      finish();
      topicId = topic[1]!;
      title = topic[2]!;
      body = [];
    } else if (topicId) body.push(line);
  }
  finish();
  if (Object.keys(rubrics).length !== 12) throw new Error('approved_v2_catalog_incomplete');
  return rubrics;
}

async function main(): Promise<void> {
  const output = JSON.stringify(await compileApprovedV2Policy(await readFile(source, 'utf8')), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (output !== await readFile(target, 'utf8')) throw new Error('approved_v2_policy_json_outdated');
  } else {
    await mkdir(resolve('scripts/data'), { recursive: true });
    await writeFile(target, output);
  }
}

if (require.main === module) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
