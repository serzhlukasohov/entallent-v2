import { createHash } from 'node:crypto';
import {
  PulseAssemblyError,
  PulseLabelsSchema,
  PulseReportPresentationSchema,
  isPulseUnicodeText,
  type PulseReportPresentation,
  type PulsePresentedSection,
} from '@entalent/contracts';
interface PulseLiteralLeafData {
  type: 'text';
  text: string;
  style?: { bold?: boolean; italic?: boolean };
}
type PulseReportBlockData =
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji: false } }
  | { type: 'divider' }
  | { type: 'rich_text'; elements: { type: 'rich_text_section'; elements: PulseLiteralLeaf[] }[] };
interface PulseSlackPartData {
  text: string;
  blocks: PulseReportBlock[];
  mrkdwn: false;
  parse: 'none';
  link_names: false;
  unfurl_links: false;
  unfurl_media: false;
}
interface PulseSlackPackageData {
  parts: readonly PulseSlackPart[];
  manifest: {
    contract: 'pulse-slack-v1';
    locale: string;
    purpose: string;
    audience: string;
    indexKey?: string;
    labelHash: string;
    sections: { sectionKey: string; contentIds: string[] }[];
    parts: {
      ordinal: number;
      total: number;
      contentHash: string;
      sectionKey: string;
      contentIds: string[];
      repeatedContext: true;
    }[];
  };
}
export type PulseDeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly PulseDeepReadonly<Item>[]
  : T extends object
    ? { readonly [K in keyof T]: PulseDeepReadonly<T[K]> }
    : T;
export type PulseLiteralLeaf = PulseDeepReadonly<PulseLiteralLeafData>;
export type PulseReportBlock = PulseDeepReadonly<PulseReportBlockData>;
export type PulseSlackPart = PulseDeepReadonly<PulseSlackPartData>;
export type PulseSlackPackage = PulseDeepReadonly<PulseSlackPackageData>;
interface Unit {
  id: string;
  leaves: PulseLiteralLeaf[];
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const leaf = (text: string, bold = false, italic = false): PulseLiteralLeaf => ({
  type: 'text',
  text,
  ...(bold || italic
    ? { style: { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) } }
    : {}),
});
const rich = (leaves: PulseLiteralLeaf[]): PulseReportBlock => ({
  type: 'rich_text',
  elements: [{ type: 'rich_text_section', elements: leaves }],
});
const raw = (leaves: readonly PulseLiteralLeaf[]) => leaves.map((l) => l.text).join('');
function validUnicode(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 8 || (c >= 11 && c <= 31) || c === 127) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(++i);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return !/[\u202a-\u202e\u2066-\u2069]/u.test(s);
}
function split(text: string, capacity = 1000, locale = 'en'): string[] {
  if (!validUnicode(text)) throw new PulseAssemblyError('narrative_invalid');
  const segments = new Intl.Segmenter(locale, { granularity: 'word' }).segment(text);
  const parts: string[] = [];
  let part = '';
  for (const { segment } of segments) {
    if (segment.length > capacity || escape(segment).length > capacity)
      throw new PulseAssemblyError('assembly_capacity_exceeded');
    if (escape(part + segment).length > capacity) {
      parts.push(part);
      part = '';
    }
    part += segment;
  }
  if (part) parts.push(part);
  return parts;
}
/** Pure serializer; never imports a sender/client, and never emits backend provenance as metadata. */
export function renderPulseReportForSlack(p: PulseReportPresentation): PulseSlackPackage {
  const checked = PulseReportPresentationSchema.safeParse(p);
  if (!checked.success)
    throw new PulseAssemblyError(
      checked.error.issues.some((i) =>
        ['labels', 'labelHash', 'labelVersion'].includes(String(i.path[0])),
      )
        ? 'language_unavailable'
        : 'narrative_invalid',
    );
  p = checked.data as PulseReportPresentation;

  const labelValidation = PulseLabelsSchema.safeParse(p.labels);
  if (!labelValidation.success) throw new PulseAssemblyError('language_unavailable');
  const l = labelValidation.data;
  if (createHash('sha256').update(JSON.stringify(l)).digest('hex') !== p.labelHash)
    throw new PulseAssemblyError('language_unavailable');
  const insufficient = p.purpose === 'final' && p.sections[0]?.status === 'insufficient_data';
  const title = insufficient
    ? l.title_insufficient_final
    : l[
        p.variant === 'team_lead_intermediate'
          ? 'title_tl_intermediate'
          : p.variant === 'team_lead_final'
            ? 'title_tl_final'
            : p.variant === 'manager_intermediate'
              ? 'title_manager_intermediate'
              : 'title_manager_final'
      ];
  if (!validUnicode(title) || title.length > 150) throw new PulseAssemblyError('narrative_invalid');
  const sections = insufficient ? p.sections.slice(0, 1) : p.sections;
  if (!sections.length) throw new PulseAssemblyError('assembly_capacity_exceeded');
  const groups = sections.map((s) => ({ s, units: units(s) }));
  const sectionTypes = new Map(
    sections.map((s, i) => [s.sectionKey, i === 0 ? l.overall_scope : l.teams_management]),
  );
  function units(s: PulsePresentedSection): Unit[] {
    const all: Unit[] = [];
    const add = (id: string, text: string, bold = false) =>
      split(text, 1000, p.locale).forEach((chunk, j) =>
        all.push({ id: id + ':' + j, leaves: [leaf(chunk, bold)] }),
      );
    if (s.status === 'insufficient_data') {
      add(s.sectionKey + ':insufficient', l.insufficient_data);
      return all;
    }
    const m = s.metric;
    if (
      (p.purpose === 'final' && m.kind !== 'engagement') ||
      (p.purpose === 'intermediate' &&
        ((p.audience === 'team_lead' && m.kind !== 'index_category') ||
          (p.audience === 'manager' && m.kind !== 'index')))
    )
      throw new PulseAssemblyError('narrative_invalid');
    const prose = [
      ...s.narrative.explanation,
      ...(s.narrative.focus.kind === 'problem' ? [s.narrative.focus.text] : []),
      ...s.narrative.actions.flatMap((a) => [a.title, a.detail]),
    ];
    if (
      !s.narrative.explanation.length ||
      s.narrative.actions.length > 3 ||
      prose.some((v) => !isPulseUnicodeText(v))
    )
      throw new PulseAssemblyError('narrative_invalid');
    const metricLabel =
      m.kind === 'engagement' ? l.engagement : l[('index_' + m.indexKey) as keyof typeof l];
    let value: string;
    if (m.kind === 'index_category')
      value =
        l[
          m.category === 'healthy'
            ? 'state_healthy'
            : m.category === 'critical'
              ? 'state_critical'
              : 'state_attention'
        ];
    else {
      if (!/^\d+\.\d$/.test(m.value)) throw new PulseAssemblyError('narrative_invalid');
      value =
        new Intl.NumberFormat(p.locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          useGrouping: false,
        }).format(Number(m.value)) +
        '/' +
        (m.kind === 'engagement' ? '10' : '100');
    }
    const direction =
      m.direction === 'baseline_established'
        ? l.baseline_established
        : l[('direction_' + m.direction) as keyof typeof l];
    if (!direction) throw new PulseAssemblyError('narrative_invalid');
    add(s.sectionKey + ':metric', metricLabel + ': ' + value + ' · ' + direction, true);
    if (m.compositionChanged) add(s.sectionKey + ':composition', l.composition_caveat);
    add(s.sectionKey + ':explanation-label', l.explanation, true);
    s.narrative.explanation.forEach((text, j) => add(s.sectionKey + ':explanation:' + j, text));
    add(s.sectionKey + ':focus-label', l.main_focus, true);
    add(
      s.sectionKey + ':focus',
      s.narrative.focus.kind === 'problem' ? s.narrative.focus.text : l.none_supported_problem,
    );
    add(s.sectionKey + ':actions-label', l.actions, true);
    if (!s.narrative.actions.length) add(s.sectionKey + ':no-actions', l.none_supported_action);
    for (const a of s.narrative.actions)
      all.push({ id: a.actionKey, leaves: [leaf(a.title, true), leaf('\n' + a.detail)] });
    return all;
  }
  const make = (
    s: PulsePresentedSection,
    items: Unit[],
    ordinal: number,
    total: number,
  ): PulseSlackPart => {
    const context = [
      l.period + ': ' + p.period,
      l.part + ' ' + ordinal + '/' + total,
      ...(p.purpose === 'intermediate' ? [l[('index_' + p.indexKey) as keyof typeof l]] : []),
      ...(p.purpose === 'intermediate' ? [l.preliminary_notice] : []),
      ...(!insufficient && p.audience === 'manager' ? [sectionTypes.get(s.sectionKey)!] : []),
      ...(!insufficient ? [s.label] : []),
    ];
    if (context.some((t) => !validUnicode(t) || t.length > 2500))
      throw new PulseAssemblyError('assembly_capacity_exceeded');
    const bodies = [...context.map((t) => [leaf(t)]), ...items.map((u) => u.leaves)];
    const text = [title, ...bodies.map(raw)].map(escape).join('\n');
    return {
      text,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: title, emoji: false } },
        ...context.map((t) => rich([leaf(t)])),
        { type: 'divider' },
        ...items.map((u) => rich(u.leaves)),
      ],
      mrkdwn: false,
      parse: 'none',
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
    };
  };
  const fits = (part: PulseSlackPart) =>
    part.text.length <= 4000 &&
    part.blocks.length <= 50 &&
    part.blocks.every(
      (b) => b.type !== 'rich_text' || b.elements.every((e) => raw(e.elements).length <= 2500),
    );
  let total = 1;
  let previous = '';
  let packed: { s: PulsePresentedSection; items: Unit[] }[] = [];
  for (let pass = 0; pass < 16; pass++) {
    packed = [];
    for (const { s, units } of groups) {
      let items: Unit[] = [];
      for (const u of units) {
        const candidate = [...items, u];
        if (!fits(make(s, candidate, packed.length + 1, total))) {
          if (!items.length) throw new PulseAssemblyError('assembly_capacity_exceeded');
          packed.push({ s, items });
          items = [];
          if (!fits(make(s, [u], packed.length + 1, total)))
            throw new PulseAssemblyError('assembly_capacity_exceeded');
        }
        items.push(u);
      }
      if (items.length) packed.push({ s, items });
    }
    if (packed.length > 4096) throw new PulseAssemblyError('assembly_capacity_exceeded');
    const partition = JSON.stringify(packed.map((g) => [g.s.sectionKey, g.items.map((i) => i.id)]));
    if (total === packed.length && partition === previous) {
      const parts = packed.map((g, i) => make(g.s, g.items, i + 1, total));
      if (!parts.every(fits)) throw new PulseAssemblyError('assembly_capacity_exceeded');
      const result: PulseSlackPackage = {
        parts,
        manifest: {
          contract: 'pulse-slack-v1',
          locale: p.locale,
          purpose: p.purpose,
          audience: p.audience,
          ...('indexKey' in p ? { indexKey: p.indexKey } : {}),
          labelHash: p.labelHash,
          sections: groups.map((g) => ({
            sectionKey: g.s.sectionKey,
            contentIds: g.units.map((u) => u.id),
          })),
          parts: packed.map((g, i) => ({
            ordinal: i + 1,
            total,
            contentHash: createHash('sha256').update(JSON.stringify(parts[i])).digest('hex'),
            sectionKey: g.s.sectionKey,
            contentIds: g.items.map((u) => u.id),
            repeatedContext: true,
          })),
        },
      };
      freezePulsePackage(result);
      return result;
    }
    total = packed.length;
    previous = partition;
  }
  throw new PulseAssemblyError('assembly_capacity_exceeded');
}

function freezePulsePackage(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezePulsePackage(child);
    Object.freeze(value);
  }
}
