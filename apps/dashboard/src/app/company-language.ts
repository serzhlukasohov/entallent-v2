'use client';
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { PULSE_COPY_VERSION, PULSE_SOURCE_ADMIN, interpolatePulseText, validatePulseTexts, type PulseLanguageReadMetadata } from '@entalent/contracts';
export const EnglishCompanyLanguage: PulseLanguageReadMetadata = { locale: 'en', resourceVersion: PULSE_COPY_VERSION, status: 'ready', resources: {} };
const CompanyLanguage = createContext<PulseLanguageReadMetadata>(EnglishCompanyLanguage);
export function companyCopy(context: PulseLanguageReadMetadata, key: string, values?: Readonly<Record<string, string | number>>): string {
  const source = PULSE_SOURCE_ADMIN[key as keyof typeof PULSE_SOURCE_ADMIN];
  if (!source) throw new Error('language_key_unavailable');
  if (context.locale === 'en') return interpolatePulseText(source, values);
  const resource = context.resources.admin;
  if (!resource || resource.locale !== context.locale || !validatePulseTexts(PULSE_SOURCE_ADMIN, resource.texts)) throw new Error('language_unavailable');
  return interpolatePulseText(resource.texts[key]!, values);
}
export function CompanyLanguageProvider({ language, children }: { language: PulseLanguageReadMetadata; children?: ReactNode }) {
  if (language.status !== 'ready') return createElement('div', { lang: 'en', role: 'status', 'data-language-status': 'language_unavailable' }, `Language unavailable: ${language.locale}`);
  return createElement(CompanyLanguage.Provider, { value: language }, children);
}
export function CompanyText({ k, values }: { k: string; values?: Readonly<Record<string, string | number>> }) {
  return createElement('span', { 'data-copy-key': k }, companyCopy(useContext(CompanyLanguage), k, values));
}
/** Only explicitly code-owned label keys enter this component; employee values never do. */
export function CompanyLabel({ label }: { label: string }) {
  const context = useContext(CompanyLanguage);
  if (label.startsWith('\u001epulse-copy:')) {
    const parsed = JSON.parse(label.slice('\u001epulse-copy:'.length)) as { key: string; values: Record<string,string|number>; labelValues: string[]; dateValues: string[] };
    const values = { ...parsed.values };
    for (const key of parsed.labelValues) values[key] = String(values[key]) in PULSE_SOURCE_ADMIN ? companyCopy(context, String(values[key])) : values[key]!;
    for (const key of parsed.dateValues) {const date=new Date(String(values[key]));values[key] = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(context.locale,{timeZone:'Europe/Warsaw',dateStyle:'medium',timeStyle:'short'}).format(date) : '—';}
    return companyCopy(context, parsed.key, values);
  }
  return label in PULSE_SOURCE_ADMIN ? companyCopy(context, label) : label;
}
export function CompanyDate({ value, includeTime = true }: { value: string | null | undefined; includeTime?: boolean }) {
  const context = useContext(CompanyLanguage);
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat(context.locale, { timeZone: 'Europe/Warsaw', dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short' as const } : {}) }).format(new Date(value));
}
export function CompanyPlural({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  const context = useContext(CompanyLanguage);
  return `${new Intl.NumberFormat(context.locale).format(count)} ${companyCopy(context, new Intl.PluralRules(context.locale).select(count) === 'one' ? singular : plural)}`;
}

export function CompanyNavigation({ children }: { children: ReactNode }) {
  return createElement('nav',{className:'filters','aria-label':companyCopy(useContext(CompanyLanguage),'ui.028')},children);
}
export function CompanyProgressTrack({ children, value, max, label }: { children: ReactNode; value: number; max: number; label?: string }) {
  const context=useContext(CompanyLanguage);
  return createElement('div',{className:'progress-track',role:'progressbar','aria-valuemin':0,'aria-valuemax':max,'aria-valuenow':value,'aria-valuetext':new Intl.NumberFormat(context.locale).format(value)+' / '+new Intl.NumberFormat(context.locale).format(max),'aria-label':label || companyCopy(context,'ui.063')},children);
}

export function CompanyDefinition({ display }: { display?: import('@entalent/contracts').DefinitionDisplay }) {
  const context=useContext(CompanyLanguage);
  return display?.status==='ready' && display.locale===context.locale && display.text ? display.text : companyCopy(context,'ui.language_unavailable');
}
