import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PULSE_ENGLISH_LABELS,
  PULSE_LABEL_VERSION,
  PULSE_PRESENTATION_CONTRACT,
  type PulseReportPresentation,
  type PulsePresentedSection,
} from '@entalent/contracts';
import {
  renderPulseReportForSlack,
  type PulseReportBlock,
  type PulseSlackPackage,
} from './pulse-report-renderer';
function fixture(
  audience: 'team_lead' | 'manager' = 'manager',
  purpose: 'intermediate' | 'final' = 'final',
): PulseReportPresentation {
  const labels = { ...PULSE_ENGLISH_LABELS };
  const section: PulsePresentedSection = {
    sectionKey: 'sA',
    label: 'Product <@U123> <!channel> *literal* & trusted 👩🏽‍💻',
    status: 'eligible',
    metric:
      purpose === 'final'
        ? {
            kind: 'engagement',
            value: '7.1',
            direction: 'baseline_established',
            compositionChanged: false,
          }
        : audience === 'manager'
          ? {
              kind: 'index',
              indexKey: 'autonomy',
              value: '70.0',
              direction: 'improving',
              compositionChanged: true,
            }
          : {
              kind: 'index_category',
              indexKey: 'autonomy',
              category: 'healthy',
              direction: 'improving',
              compositionChanged: true,
            },
    narrative: {
      explanation: [
        'Decision ownership is unclear; <https://evil.invalid|click> *literal* & honest 👩🏽‍💻.',
      ],
      focus: { kind: 'problem', text: 'Clarify decision ownership.' },
      actions: [
        {
          actionKey: 'sAaA',
          title: 'Clarify responsibilities',
          detail: 'Ask the Team Lead to review decision ownership.',
        },
      ],
    },
  };
  return {
    contract: PULSE_PRESENTATION_CONTRACT,
    variant: audience + '_' + purpose,
    audience,
    purpose,
    ...(purpose === 'intermediate' ? { indexKey: 'autonomy' } : {}),
    locale: 'en',
    period: 'October 2026',
    labels,
    labelVersion: PULSE_LABEL_VERSION,
    labelHash: createHash('sha256').update(JSON.stringify(labels)).digest('hex'),
    sections: [section],
  } as PulseReportPresentation;
}
const leafText = (block: PulseReportBlock) =>
  block.type === 'header'
    ? block.text.text
    : block.type === 'rich_text'
      ? block.elements.flatMap((e) => e.elements.map((l) => l.text)).join('')
      : '';
for (const audience of ['team_lead', 'manager'] as const)
  for (const phase of ['intermediate', 'final'] as const)
    test(`RPT06 ${audience} ${phase} literal native blocks equal complete accessible fallback`, () => {
      const p = fixture(audience, phase);
      const r = renderPulseReportForSlack(p);
      assert.ok(r.parts.length);
      for (const part of r.parts) {
        const text = part.blocks.map(leafText).filter(Boolean).join('\n');
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        assert.equal(part.text, escaped);
        assert.ok(!part.text.includes('<@U123>'));
        assert.ok(part.text.includes('&lt;@U123&gt;'));
        assert.equal(part.mrkdwn, false);
        assert.equal(part.parse, 'none');
        assert.equal(part.link_names, false);
        assert.ok(!JSON.stringify(part).includes('metadata'));
        for (const block of part.blocks)
          if (block.type === 'rich_text')
            for (const element of block.elements)
              for (const leaf of element.elements) assert.equal(leaf.type, 'text');
      }
      const fallback = r.parts.map((part) => part.text).join('\n');
      if (phase === 'intermediate') {
        assert.ok(fallback.includes(p.labels.preliminary_notice));
        assert.ok(p.labels.preliminary_notice.includes('results and recommendations'));
        if (audience === 'team_lead') {
          assert.ok(!fallback.includes('70.0'));
          assert.ok(fallback.includes('Healthy'));
        }
      } else {
        assert.ok(fallback.includes('7.1/10'));
        assert.ok(!fallback.includes('/100'));
      }
    });
test('RPT06 full manager package preserves more than two hundred insufficient team labels and all three action identities', () => {
  const p = fixture();
  p.sections.push(
    ...Array.from({ length: 300 }, (_, i) => ({
      sectionKey:
        's' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)),
      label: 'Frozen team ' + i,
      status: 'insufficient_data' as const,
    })),
  );
  const first = p.sections[0]!;
  if (first.status !== 'eligible') throw Error('eligible');
  first.narrative.actions = [
    ...first.narrative.actions,
    { actionKey: 'sAaB', title: 'Agree boundaries', detail: 'Agree the remit with the Team Lead.' },
    {
      actionKey: 'sAaC',
      title: 'Review support',
      detail: 'Review available support with the Team Lead.',
    },
  ];
  const r = renderPulseReportForSlack(p);
  assert.equal(r.manifest.sections.length, 301);
  for (const s of p.sections)
    assert.ok(r.manifest.sections.some((x) => x.sectionKey === s.sectionKey));
  for (const a of first.narrative.actions)
    assert.ok(
      r.manifest.parts.some((part) => part.contentIds.some((id) => id.startsWith(a.actionKey))),
    );
  const actual = r.manifest.parts.flatMap((part) => part.contentIds);
  assert.deepEqual(
    actual,
    r.manifest.sections.flatMap((s) => s.contentIds),
  );
  assert.equal(new Set(actual).size, actual.length);
});
test('RPT06 long Unicode paragraphs, escaped entities and labels pack completely without splitting graphemes, with deterministic fixedpoint hashes', () => {
  const p = fixture();
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.label = 'Frozen team ' + '👨‍👩‍👧‍👦 & <literal> '.repeat(20);
  s.narrative.explanation = ['Ownership & support 👩🏽‍💻 e\u0301 <literal> remain mixed. '.repeat(20)];
  p.sections.push(
    ...['B', 'C', 'D'].map((key) => ({
      ...s,
      sectionKey: 's' + key,
      narrative: {
        ...s.narrative,
        actions: s.narrative.actions.map((a, i) => ({
          ...a,
          actionKey: 's' + key + 'a' + String.fromCharCode(65 + i),
        })),
      },
    })),
  );
  const a = renderPulseReportForSlack(p),
    b = renderPulseReportForSlack(p);
  assert.deepEqual(a, b);
  assert.ok(a.parts.length > 2);
  for (const [i, part] of a.parts.entries()) {
    assert.ok(part.text.length <= 4000);
    assert.ok(part.blocks.length <= 50);
    assert.equal(a.manifest.parts[i]!.ordinal, i + 1);
    assert.equal(a.manifest.parts[i]!.total, a.parts.length);
    for (const block of part.blocks) {
      const text = leafText(block);
      const first = text.charCodeAt(0);
      assert.ok(
        !text.startsWith('\u200d') &&
          !text.startsWith('\u0301') &&
          !(first >= 0xdc00 && first <= 0xdfff),
      );
      const last = text.charCodeAt(text.length - 1);
      assert.ok(!text.endsWith('\u200d') && !(last >= 0xd800 && last <= 0xdbff));
    }
  }
  assert.equal(
    a.manifest.parts.flatMap((p) => p.contentIds).length,
    a.manifest.sections.flatMap((s) => s.contentIds).length,
  );
});
test('RPT06 forged numeric narrative or variant and pathological indivisible Unicode fail whole package', () => {
  const p = fixture('team_lead', 'intermediate');
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.narrative.explanation = ['Score 42'];
  assert.throws(() => renderPulseReportForSlack(p));
  s.narrative.explanation = ['Ownership remains unclear.'];
  s.metric = {
    kind: 'index',
    indexKey: 'autonomy',
    value: '70.0',
    direction: 'stable',
    compositionChanged: false,
  };
  assert.throws(() => renderPulseReportForSlack(p));
  s.metric = {
    kind: 'index_category',
    indexKey: 'autonomy',
    category: 'healthy',
    direction: 'stable',
    compositionChanged: false,
  };
  s.narrative.explanation = ['e' + '\u0301'.repeat(1100)];
  assert.throws(() => renderPulseReportForSlack(p));
  s.narrative.explanation = ['Bad\ud800'];
  assert.throws(() => renderPulseReportForSlack(p));
});
test('RPT06 final overall insufficient is title, period, ordinal and notice only with no child or advice', () => {
  const p = fixture();
  p.sections = [{ sectionKey: 'sA', label: 'OVERALL_PRIVATE_LABEL', status: 'insufficient_data' }];
  const r = renderPulseReportForSlack(p);
  const text = r.parts[0]!.text;
  assert.ok(text.includes('Insufficient data'));
  assert.ok(!text.includes('OVERALL_PRIVATE_LABEL'));
  assert.ok(!text.includes('CHILD_MUST_NOT_APPEAR'));
  assert.ok(!text.includes('Actions'));
  assert.ok(!text.includes('Explanation'));
  assert.ok(!text.includes(p.labels.overall_scope));
  assert.ok(!text.includes(p.labels.teams_management));
  assert.throws(() =>
    renderPulseReportForSlack({
      ...p,
      sections: [
        ...p.sections,
        { sectionKey: 'sB', label: 'CHILD_MUST_NOT_APPEAR', status: 'insufficient_data' },
      ],
    }),
  );
});
test('RPT06 missing localized atomic slots or modified frozen label bundle cannot silently fall back', () => {
  const p = fixture();
  p.locale = 'de';
  (p.labels as unknown as Record<string, unknown>).part = undefined;
  assert.throws(() => renderPulseReportForSlack(p));
  const q = fixture();
  q.labels.part = 'Teil';
  assert.throws(() => renderPulseReportForSlack(q));
});
test('RPT06 synthetic desktop and mobile preview artifacts preserve actual native literal leaf text', () => {
  const p = fixture('manager', 'intermediate');
  const r = renderPulseReportForSlack(p);
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const view = r.parts
    .map(
      (part) =>
        '<article>' +
        part.blocks.map((block) => '<div>' + escape(leafText(block)) + '</div>').join('') +
        '</article>',
    )
    .join('');
  const html =
    '<!doctype html><meta charset="utf-8"><title>RPT06 synthetic native payload preview</title><style>body{font:16px system-ui;background:#eee;padding:20px}main{display:flex;gap:24px;align-items:start}.desktop{width:720px}.mobile{width:375px}article{background:white;padding:20px;margin:0 0 20px;border:1px solid #ccc}article div{white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:12px}article div:first-child{font-weight:700;font-size:20px}</style><p>Synthetic literal payload preview. Native Slack acceptance remains unverified.</p><main><section class="desktop">' +
    view +
    '</section><section class="mobile">' +
    view +
    '</section></main>';
  writeFileSync(resolve(__dirname, '../../../runs/rpt-06/slack-desktop-mobile-preview.html'), html);
  writeFileSync(
    resolve(__dirname, '../../../runs/rpt-06/slack-preview-package.json'),
    JSON.stringify(r, null, 2) + '\n',
  );
  assert.ok(html.includes('&lt;@U123&gt;'));
});

test('RPT06 word-preserving intermediate continuations repeat Index identity and keep each action indivisible', () => {
  const p = fixture('team_lead', 'intermediate');
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.narrative.explanation = ['Ownership remains unclear. '.repeat(44)];
  s.label = 'Frozen team ' + 'L'.repeat(1500);
  s.narrative.actions = ['Clarify ownership', 'Agree boundaries', 'Review decisions'].map(
    (title, i) => ({
      actionKey: 'sAa' + String.fromCharCode(65 + i),
      title,
      detail: 'Review ownership with the Team Lead. '.repeat(10),
    }),
  );
  const rendered = renderPulseReportForSlack(p);
  assert.ok(rendered.parts.length > 1);
  for (const part of rendered.parts) assert.ok(part.text.includes('Autonomy'));
  const ids = rendered.manifest.parts.flatMap((p) => p.contentIds);
  assert.equal(ids.filter((id) => id === s.narrative.actions[0]!.actionKey).length, 1);
  const chunks = rendered.parts
    .flatMap((part) =>
      part.blocks
        .filter((block) => block.type === 'rich_text')
        .flatMap((block) =>
          block.type === 'rich_text'
            ? block.elements.flatMap((e) => e.elements.map((leaf) => leaf.text))
            : [],
        ),
    )
    .filter(
      (text) =>
        text.startsWith('Ownership') ||
        text.startsWith('unclear.') ||
        text.startsWith('remains') ||
        text.startsWith(' '),
    );
  assert.equal(chunks.join(''), s.narrative.explanation[0]);
  for (const chunk of chunks) assert.ok(!/[A-Za-z]$/.test(chunk));
});

test('RPT06 complete German long-label fixture repeats frozen localized notice and literal continuation content', () => {
  const german = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        '../../conversation-sim/src/fixtures/pulse-report-narrative/german-company.json',
      ),
      'utf8',
    ),
  ) as { labels: PulseReportPresentation['labels'] };
  const p = fixture('manager', 'intermediate');
  p.locale = 'de-DE';
  p.labels = german.labels;
  p.labelHash = createHash('sha256').update(JSON.stringify(p.labels)).digest('hex');
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.label = 'Produktentwicklung und organisationsübergreifende Zusammenarbeit '.repeat(8);
  s.narrative.explanation = ['Zuständigkeiten bleiben unklar. '.repeat(35)];
  s.narrative.focus = { kind: 'none_supported' };
  s.narrative.actions = [
    'Zuständigkeiten klären',
    'Grenzen abstimmen',
    'Entscheidungen prüfen',
  ].map((title, i) => ({
    actionKey: 'sAa' + String.fromCharCode(65 + i),
    title,
    detail: 'Klären Sie Zuständigkeiten mit der Teamleitung. '.repeat(8),
  }));
  s.label = s.label.repeat(3);
  const rendered = renderPulseReportForSlack(p);
  assert.ok(rendered.parts.length > 1);
  for (const part of rendered.parts) {
    assert.ok(part.text.includes(german.labels.preliminary_notice));
    assert.ok(part.text.includes('Autonomie'));
    assert.ok(part.text.includes(german.labels.overall_scope));
    assert.ok(!part.text.includes('preliminary'));
  }
});

test('RPT06 duplicate frozen labels retain separate complete section coverage', () => {
  const p = fixture();
  p.sections.push(
    { sectionKey: 'sB', label: 'Same label', status: 'insufficient_data' },
    { sectionKey: 'sC', label: 'Same label', status: 'insufficient_data' },
  );
  const r = renderPulseReportForSlack(p);
  assert.deepEqual(
    r.manifest.sections.slice(1).map((s) => s.sectionKey),
    ['sB', 'sC'],
  );
  assert.equal(r.parts.filter((p) => p.text.includes('Same label')).length, 2);
});
test('RPT06 fifty-block packing boundary preserves every short paragraph without accessibility truncation', () => {
  const p = fixture();
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.narrative.explanation = Array(70).fill('Supported.');
  s.narrative.actions = [];
  const r = renderPulseReportForSlack(p);
  assert.ok(r.parts.length > 1);
  assert.equal(r.parts[0]!.blocks.length, 50);
  assert.equal(
    r.parts.flatMap((p) => p.blocks).filter((b) => leafText(b) === 'Supported.').length,
    70,
  );
});
test('RPT06 removing optional emoji preserves complete text-based condition, dynamics and preliminary qualification', () => {
  const p = fixture('team_lead', 'intermediate');
  const s = p.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.label = s.label.replaceAll('👩🏽‍💻', '');
  s.narrative.explanation = s.narrative.explanation.map((t) => t.replaceAll('👩🏽‍💻', ''));
  const text = renderPulseReportForSlack(p)
    .parts.map((p) => p.text)
    .join('\n');
  for (const meaning of [
    'Healthy',
    'Improving',
    'Explanation',
    'Main focus',
    'Actions',
    p.labels.preliminary_notice,
  ])
    assert.ok(text.includes(meaning));
});

test('RPT06 exported renderer rejects conflicting report Index, out-of-range metric and extra numeric fields before serialization', () => {
  const p = fixture('manager', 'intermediate');
  if (!('indexKey' in p)) throw Error('index');
  p.indexKey = 'growth';
  assert.throws(() => renderPulseReportForSlack(p));
  const q = fixture('manager', 'final');
  const s = q.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.metric = { kind: 'engagement', value: '99.0', direction: 'stable', compositionChanged: false };
  assert.throws(() => renderPulseReportForSlack(q));
  const extra = fixture('team_lead', 'intermediate');
  (extra.sections[0] as unknown as Record<string, unknown>).rawMean = 70;
  assert.throws(() => renderPulseReportForSlack(extra));
});
test('RPT06 Manager grouping headings distinguish identically named overall and child scopes in native blocks and fallback', () => {
  const p = fixture('manager', 'final');
  p.sections[0]!.label = 'Identical label';
  p.sections.push({ sectionKey: 'sB', label: 'Identical label', status: 'insufficient_data' });
  const r = renderPulseReportForSlack(p);
  assert.ok(r.parts[0]!.text.includes(p.labels.overall_scope));
  assert.ok(r.parts[1]!.text.includes(p.labels.teams_management));
  for (const part of r.parts) {
    const visible = part.blocks.map(leafText).filter(Boolean).join('\n');
    assert.equal(
      part.text,
      visible.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    );
  }
});
test('RPT06 final Slack package is deeply immutable so text, nested leaf and manifest mutation cannot stale hashes', () => {
  const p = fixture();
  const r = renderPulseReportForSlack(p);
  const before = JSON.stringify(r);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.parts));
  assert.ok(Object.isFrozen(r.manifest));
  assert.equal(Reflect.set(r.parts[0]!, 'text', 'changed'), false);
  assert.equal(Reflect.set(r.manifest.parts[0]!, 'contentHash', 'changed'), false);
  const rich = r.parts[0]!.blocks.find((b) => b.type === 'rich_text');
  if (!rich || rich.type !== 'rich_text') throw Error('rich');
  assert.ok(Object.isFrozen(rich.elements[0]!.elements[0]));
  assert.equal(Reflect.set(rich.elements[0]!.elements[0]!, 'text', 'changed'), false);
  assert.throws(() => Reflect.apply(Array.prototype.push, r.parts, [r.parts[0]]));
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(renderPulseReportForSlack(p), r);
});

test('RPT06 Manager team continuations repeat their grouping heading while preserving each action once', () => {
  const p = fixture('manager', 'intermediate');
  const overall = p.sections[0]!;
  if (overall.status !== 'eligible') throw Error('eligible');
  const child = {
    ...overall,
    sectionKey: 'sB',
    label: 'Frozen child ' + 'L'.repeat(1500),
    narrative: {
      ...overall.narrative,
      explanation: ['Ownership remains unclear. '.repeat(44)],
      actions: ['Clarify ownership', 'Agree boundaries', 'Review decisions'].map((title, i) => ({
        actionKey: 'sBa' + String.fromCharCode(65 + i),
        title,
        detail: 'Review ownership with the Team Lead. '.repeat(10),
      })),
    },
  };
  p.sections.push(child);
  const r = renderPulseReportForSlack(p);
  const parts = r.manifest.parts
    .map((part, i) => ({ part, payload: r.parts[i]! }))
    .filter(({ part }) => part.sectionKey === 'sB');
  assert.ok(parts.length > 1);
  for (const { payload } of parts) {
    assert.ok(payload.text.includes(p.labels.teams_management));
    assert.ok(!payload.text.includes(p.labels.overall_scope));
  }
  for (const action of child.narrative.actions)
    assert.equal(
      parts.flatMap((p) => p.part.contentIds).filter((id) => id === action.actionKey).length,
      1,
    );
});

function pulseSlackReadonlyTypeContract(result: PulseSlackPackage) {
  // @ts-expect-error final payload text is immutable
  result.parts[0]!.text = 'changed';
  // @ts-expect-error manifest coverage arrays are immutable
  result.manifest.parts[0]!.contentIds.push('changed');
  const block = result.parts[0]!.blocks.find((b) => b.type === 'rich_text');
  if (block && block.type === 'rich_text') {
    // @ts-expect-error nested literal leaves are immutable
    block.elements[0]!.elements[0]!.text = 'changed';
  }
}
void pulseSlackReadonlyTypeContract;

test('RPT06 exported renderer rejects duplicate section identity, duplicate action identity and foreign-section actions', () => {
  const duplicate = fixture('manager', 'final');
  duplicate.sections.push({ sectionKey: 'sA', label: 'Same label', status: 'insufficient_data' });
  assert.throws(() => renderPulseReportForSlack(duplicate));
  const actions = fixture('manager', 'final');
  const s = actions.sections[0]!;
  if (s.status !== 'eligible') throw Error('eligible');
  s.narrative.actions.push({ ...s.narrative.actions[0]!, title: 'Review responsibilities' });
  assert.throws(() => renderPulseReportForSlack(actions));
  const foreign = fixture('manager', 'final');
  const f = foreign.sections[0]!;
  if (f.status !== 'eligible') throw Error('eligible');
  f.narrative.actions[0]!.actionKey = 'sBaA';
  assert.throws(() => renderPulseReportForSlack(foreign));
});
