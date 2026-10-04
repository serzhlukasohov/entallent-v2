import { describe, expect, it } from 'vitest';
import { evaluateQuestionDeidentification } from './question-deidentification-policy';

describe('Question Insight de-identification policy', () => {
  it('accepts generalized content under its own version', () => {
    expect(evaluateQuestionDeidentification({ text: 'Growth opportunities were limited.' })).toEqual({
      status: 'accepted', policyVersion: 'question-deidentification-v2', reasons: [],
    });
  });

  it.each([
    ['@Маша', 'slack_handle'],
    ['Write to sara@会社.jp.', 'email_address'],
    ['Write to sara@przykład.pl.', 'email_address'],
    ['team.example.org/path', 'url'],
    ['slack://workspace/channel', 'url'],
    ['123 456 789', 'phone_number'],
    ['Call me at 2025550147.', 'phone_number'],
    ['The discussion moved to <#C12345678|private-team>.', 'known_identifier'],
    ['The discussion involved <!subteam^S12345678|@private-team>.', 'known_identifier'],
    ['The discussion involved <!subteam^S12345678>.', 'known_identifier'],
    ['The issue involved Slack user U12345678.', 'slack_handle'],
    ['Slack message 1725367200.000001', 'source_message_id'],
    ['28.09.2026', 'exact_date_or_time'],
    ['28 сентября', 'exact_date_or_time'],
    ['28 września', 'exact_date_or_time'],
    ['Training was interrupted at 14.30.', 'exact_date_or_time'],
    ['Account 12345', 'project_or_customer_identifier'],
    ['Projekt Orion', 'project_or_customer_identifier'],
    ['проєкт Обрій', 'project_or_customer_identifier'],
    ['Клиент Сапфир', 'project_or_customer_identifier'],
    ['zespół Nimbus', 'known_identifier'],
    ['Менеджер Марина', 'known_identifier'],
  ])('rejects private identifier %s', (text, reason) => {
    expect(evaluateQuestionDeidentification({ text }).reasons).toContain(reason);
  });

  it('keeps ordinary generic descriptions reportable', () => {
    expect(evaluateQuestionDeidentification({ text: 'Team morale and project delivery were uneven.' }).status)
      .toBe('accepted');
  });

  it('rejects a scoped external source identifier even when it has no Slack timestamp shape', () => {
    expect(evaluateQuestionDeidentification({
      text: 'The discussion was recorded under message ref-A1B2C3.',
      sourceMessageIds: ['ref-A1B2C3'],
    }).reasons).toContain('source_message_id');
  });

  it.each([
    ['Żuraw', 'zuraw'],
    ['Łukasz', 'Lukasz'],
  ])('rejects an accent-folded known identifier %s', (identifier, candidate) => {
    expect(evaluateQuestionDeidentification({
      text: `The issue involved ${candidate}.`, knownIdentifiers: [identifier],
    }).reasons).toContain('known_identifier');
  });
});
