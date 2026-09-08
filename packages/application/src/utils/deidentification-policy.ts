export const DEIDENTIFICATION_POLICY_VERSION = 'deidentification-v1';

export const DEIDENTIFICATION_REJECTION_REASONS = [
  'known_identifier',
  'slack_handle',
  'email_address',
  'phone_number',
  'url',
  'exact_date_or_time',
  'source_message_id',
  'project_or_customer_identifier',
] as const;

export type DeidentificationRejectionReason = (typeof DEIDENTIFICATION_REJECTION_REASONS)[number];

export type DeidentificationDecision =
  | { status: 'accepted'; policyVersion: typeof DEIDENTIFICATION_POLICY_VERSION; reasons: [] }
  | {
      status: 'rejected';
      policyVersion: typeof DEIDENTIFICATION_POLICY_VERSION;
      reasons: DeidentificationRejectionReason[];
    };

export interface DeidentificationPolicyInput {
  text: string;
  knownIdentifiers?: string[];
  sourceMessageIds?: string[];
}

export function evaluateDeidentification(input: DeidentificationPolicyInput): DeidentificationDecision {
  const reasons = new Set<DeidentificationRejectionReason>();
  const text = input.text.trim();

  if (/<@[A-Z0-9]+>|\B@[a-z0-9._-]{2,}/i.test(text)) reasons.add('slack_handle');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) reasons.add('email_address');
  if (/(?:\+\d[\d\s().-]{7,}\d|\(\d{3}\)\s*\d{3}[-\s]?\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/.test(text)) {
    reasons.add('phone_number');
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) reasons.add('url');
  if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\b/i.test(text)) {
    reasons.add('exact_date_or_time');
  }
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(text)) {
    reasons.add('source_message_id');
  }
  if (/\b(?:Project|Customer|Client|Account)\s+[A-Z][A-Za-z0-9_-]+\b/.test(text)) {
    reasons.add('project_or_customer_identifier');
  }

  for (const identifier of [...(input.knownIdentifiers ?? []), ...(input.sourceMessageIds ?? [])]) {
    const needle = identifier.trim();
    if (needle.length >= 3 && text.toLocaleLowerCase().includes(needle.toLocaleLowerCase())) {
      reasons.add(input.sourceMessageIds?.includes(identifier) ? 'source_message_id' : 'known_identifier');
    }
  }

  return reasons.size === 0
    ? { status: 'accepted', policyVersion: DEIDENTIFICATION_POLICY_VERSION, reasons: [] }
    : { status: 'rejected', policyVersion: DEIDENTIFICATION_POLICY_VERSION, reasons: [...reasons].sort() };
}

export function isAcceptedDeidentificationDecision(
  decision: DeidentificationDecision | null | undefined,
): decision is Extract<DeidentificationDecision, { status: 'accepted' }> {
  return decision?.status === 'accepted'
    && decision.policyVersion === DEIDENTIFICATION_POLICY_VERSION
    && decision.reasons.length === 0;
}
