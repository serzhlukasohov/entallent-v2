import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AdminV2PilotPerson } from '@entalent/contracts';
import { personProgress, questionStatusLabel } from './v2-pilot-progress';

const question = (group: string, ready = false, outcome: string | null = null) => ({
  stableKey: group, title: group, group, status: 'collecting', ready,
  workingSummary: outcome ? null : 'working', finalSummary: null, outcome, score: null,
});

test('next step follows the available Autonomy evidence without claiming delivery', () => {
  const person: AdminV2PilotPerson = {
    userId: 'qa', displayName: 'QA', inbound: 2,
    questions: [question('autonomy', true), question('autonomy'), question('autonomy')],
  };
  assert.match(personProgress(person).nextStep, /недостающим темам/);
  person.questions = person.questions.map((item) => ({ ...item, ready: true }));
  assert.match(personProgress(person).nextStep, /Проверить Bundle/);
  person.questions = person.questions.map((item) => ({ ...item, outcome: 'scored', ready: false }));
  assert.equal(personProgress(person).stage, 'Автономия 3/3');
  person.questions[2] = { ...person.questions[2]!, outcome: 'insufficient_evidence' };
  assert.match(personProgress(person).stage, /оценено 2\/3/);
  assert.equal(questionStatusLabel('collecting'), 'Черновик, не подтверждён');
});
