import {
  evaluateDeidentification,
  type DeidentificationPolicyInput,
  type DeidentificationRejectionReason,
} from './deidentification-policy';

export const QUESTION_DEIDENTIFICATION_POLICY_VERSION = 'question-deidentification-v2';

export function evaluateQuestionDeidentification(input: DeidentificationPolicyInput):
  | { status: 'accepted'; policyVersion: typeof QUESTION_DEIDENTIFICATION_POLICY_VERSION; reasons: [] }
  | { status: 'rejected'; policyVersion: typeof QUESTION_DEIDENTIFICATION_POLICY_VERSION;
      reasons: DeidentificationRejectionReason[] } {
  const baseline = evaluateDeidentification(input);
  const reasons = new Set<DeidentificationRejectionReason>(baseline.reasons);
  const text = input.text.trim();

  if (/(?<![\p{L}\p{N}])@[\p{L}\p{N}._-]{2,}/iu.test(text)) reasons.add('slack_handle');
  if (/(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?![\p{L}\p{N}-])/iu.test(text)) {
    reasons.add('email_address');
  }
  if (/(?<![\p{L}\p{N}])[UW][A-Z0-9]{8,}(?![\p{L}\p{N}])/u.test(text)) {
    reasons.add('slack_handle');
  }
  if (/<#[A-Z0-9]{2,}(?:\|[^>]*)?>/u.test(text)) reasons.add('known_identifier');
  if (/<[!]subteam\^S[A-Z0-9]{2,}(?:\|[^>]*)?>/u.test(text)) reasons.add('known_identifier');
  if (/\b(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}(?:\/\S*)?\b/iu.test(text)
    || /\b[a-z][a-z0-9+.-]*:\/\/\S+/iu.test(text)) reasons.add('url');
  if (/(?<!\d)\d{3}[ .-]?\d{3}[ .-]?\d{3}(?!\d)/u.test(text)
    || /(?<!\d)\d{9,15}(?!\d)/u.test(text)) reasons.add('phone_number');
  if (/(?<!\d)\d{10}\.\d{6}(?!\d)/u.test(text)) reasons.add('source_message_id');
  if (/(?<!\d)(?:\d{4}[.]\d{1,2}[.]\d{1,2}|\d{1,2}[.]\d{1,2}[.]\d{2,4})(?!\d)/u.test(text)
    || /(?<!\d)(?:[01]?\d|2[0-3])[.][0-5]\d(?!\d)/u.test(text)
    || /(?<!\d)\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря|січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?![\p{L}\p{N}])/iu.test(text)) {
    reasons.add('exact_date_or_time');
  }
  if (/(?<![\p{L}\p{N}])(?:Project|Customer|Client|Account)\s+#?(?:[A-Z0-9][A-Z0-9_-]{2,})(?![\p{L}\p{N}])/u.test(text)) {
    reasons.add('project_or_customer_identifier');
  }
  if (hasLabeledIdentifier(text,
    /(?:^|[^\p{L}\p{N}])(?:project|customer|client|account|projekt|klient|konto|проєкт|проект|клієнт|клиент|аккаунт)\s+/giu)) {
    reasons.add('project_or_customer_identifier');
  }
  if (hasLabeledIdentifier(text,
    /(?:^|[^\p{L}\p{N}])(?:manager|teammate|colleague|team|menedżer|kolega|koleżanka|zespół|менеджер|коллега|колега|команда)\s+/giu)) {
    reasons.add('known_identifier');
  }
  const foldedText = foldIdentifier(text);
  if (input.knownIdentifiers?.some((identifier) => {
    const foldedIdentifier = foldIdentifier(identifier.trim());
    return foldedIdentifier.length >= 3 && foldedText.includes(foldedIdentifier);
  })) reasons.add('known_identifier');

  return reasons.size === 0
    ? { status: 'accepted', policyVersion: QUESTION_DEIDENTIFICATION_POLICY_VERSION, reasons: [] }
    : { status: 'rejected', policyVersion: QUESTION_DEIDENTIFICATION_POLICY_VERSION,
        reasons: [...reasons].sort() };
}

function foldIdentifier(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
}

function hasLabeledIdentifier(text: string, labels: RegExp): boolean {
  const identifier = /^#?(?:\p{Lu}[\p{L}\p{N}_-]{2,}|[A-Z0-9][A-Z0-9_-]{2,})(?![\p{L}\p{N}])/u;
  return [...text.matchAll(labels)].some((match) =>
    identifier.test(text.slice(match.index + match[0].length)));
}
