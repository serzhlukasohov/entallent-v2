import { OpenAiProvider, type OpenAiProviderConfig } from '../packages/ai-openai/src/openai-provider';
import type { ConversationTurn } from '@entalent/application';
import { evaluateQuestionDeidentification } from '../packages/application/src/utils/question-deidentification-policy';
import { validateQuestionBundleComposition } from '../packages/application/src/utils/question-bundle-composition';
import { validateQuestionBundleVerdict } from '../packages/application/src/utils/question-bundle-verdict';
import { validateQuestionClarificationPrompt, validateQuestionClarificationVerdict } from '../packages/application/src/utils/question-clarification';
import { V2_QUESTION_GROUP_BY_STABLE_KEY } from '../packages/application/src/utils/question-scoring-policy';

const questionIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;
const meanings = [
  'I receive useful feedback about my work.',
  'I have enough time to develop new skills.',
  'I see a clear path for professional growth.',
];
let stage = 'configuration';

async function main(): Promise<void> {
  const provider = new OpenAiProvider(modelConfig(process.env));
  const timestamp = new Date('2026-09-29T10:00:00Z');
  const sourceQuestion = [{
    id: questionIds[0], stableKey: 'q12_expectations',
    canonicalMeaning: 'Whether the employee knows what is expected at work',
    positiveIndicators: ['clear goals'], negativeIndicators: ['unclear goals'],
    contraindications: [], responseType: 'open_ended' as const,
  }];
  stage = 'evaluate_unrelated_latest_turn';
  const unrelated = await provider.evaluateSurveyEvidence([
    { role: 'assistant', content: 'You said your work goals are very clear. What would you like to discuss now?', timestamp },
    { role: 'user', content: 'Can you tell me the weather today?', timestamp },
  ], sourceQuestion, { focusLatestEmployeeMessage: true });
  if (unrelated.evidence.length !== 0 || unrelated.candidateQuestionIds.length !== 0) {
    throw new Error('latest_turn_source_boundary_failed');
  }
  stage = 'evaluate_short_grounded_reply';
  const grounded = await provider.evaluateSurveyEvidence([
    { role: 'assistant', content: 'Do you know what is expected of you at work?', timestamp },
    { role: 'user', content: 'Yes, very clearly.', timestamp },
  ], sourceQuestion, { focusLatestEmployeeMessage: true });
  if (grounded.evidence.length !== 1 || grounded.evidence[0]?.questionId !== questionIds[0]) {
    throw new Error('latest_turn_grounded_reply_missing');
  }
  const turns: ConversationTurn[] = [{
    role: 'user', content: 'I want to talk about feedback and growth at work.', timestamp,
  }];
  const questions = questionIds.map((surveyQuestionId, index) => ({
    surveyQuestionId, workingSummary: meanings[index]!,
  }));

  stage = 'compose_bundle';
  const bundle = validateQuestionBundleComposition(
    await provider.composeQuestionBundle(turns, questions, 'English'), questionIds,
  );
  const mapped = {
    displayedText: bundle.text,
    components: bundle.statements.map((statement) => ({ ...statement, questionVersion: 'synthetic-v2' })),
  };
  for (const indexCase of [
    {
      name: 'autonomy',
      employeeTurn: 'I want to talk about how much say I have in my work.',
      stableKeys: ['q12_expectations', 'q12_strengths_opportunity', 'q12_opinions_count'],
      meanings: [
        'I know what is expected of me.',
        'I have opportunities to use my strengths in my work.',
        'My input is heard when work decisions are made.',
      ],
    },
    {
      name: 'belonging',
      employeeTurn: 'I want to talk about feeling included at work.',
      stableKeys: ['wellbeing_at_work', 'q12_supervisor_cares', 'belonging_psychological_safety'],
      meanings: [
        'My workload leaves me with enough energy and balance.',
        'My supervisor checks in on me as a person.',
        'I feel safe raising concerns and admitting mistakes.',
      ],
    },
    {
      name: 'growth',
      employeeTurn: 'I want to talk about feedback and growth at work.',
      stableKeys: ['role_clarity', 'professional_growth', 'q12_progress_discussion'],
      meanings: [
        'I understand what success in my role requires.',
        'I have opportunities to learn and grow professionally.',
        'Someone has discussed my career progress with me in the last six months.',
      ],
    },
    {
      name: 'purpose',
      employeeTurn: 'I want to talk about whether my work matters.',
      stableKeys: ['q12_recognition', 'purpose_meaning', 'purpose_contribution'],
      meanings: [
        'My good work has received recognition in the last seven days.',
        'I find my work meaningful.',
        'I can see how my work contributes to something that matters.',
      ],
    },
  ]) {
    stage = `compose_bundle_${indexCase.name}`;
    if (indexCase.stableKeys.length !== 3 || indexCase.stableKeys.some(
      (key) => V2_QUESTION_GROUP_BY_STABLE_KEY[key as keyof typeof V2_QUESTION_GROUP_BY_STABLE_KEY] !== indexCase.name,
    )) throw new Error('canonical_question_map_mismatch');
    validateQuestionBundleComposition(await provider.composeQuestionBundle(
      [{ role: 'user', content: indexCase.employeeTurn, timestamp }],
      questionIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, workingSummary: indexCase.meanings[index]!,
      })),
      'English',
    ), questionIds);
  }
  for (const locale of [
    {
      language: 'Polish',
      employeeTurn: 'Chcę porozmawiać o informacji zwrotnej i rozwoju w pracy.',
      meanings: [
        'Dostaję przydatną informację zwrotną o swojej pracy.',
        'Mam czas na rozwijanie nowych umiejętności.',
        'Widzę jasną ścieżkę rozwoju zawodowego.',
      ],
      languageSignal: /[ąćęłńóśźż]/iu,
    },
    {
      language: 'Russian',
      employeeTurn: 'Хочу обсудить обратную связь и развитие на работе.',
      meanings: [
        'Я получаю полезную обратную связь о работе.',
        'У меня есть время развивать новые навыки.',
        'Я вижу понятный путь профессионального роста.',
      ],
      languageSignal: /\p{Script=Cyrillic}/u,
    },
  ]) {
    stage = `compose_bundle_${locale.language.toLowerCase()}`;
    const localized = validateQuestionBundleComposition(await provider.composeQuestionBundle(
      [{ role: 'user', content: locale.employeeTurn, timestamp }],
      questionIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, workingSummary: locale.meanings[index]!,
      })),
      locale.language,
    ), questionIds);
    if (!locale.languageSignal.test(localized.text)) {
      throw new Error('localized_bundle_language_missing');
    }
  }
  const partialReply = 'The feedback and growth path points are right, but the time to learn point is wrong: urgent work interrupts training.';
  stage = 'interpret_partial_reply';
  const verdict = validateQuestionBundleVerdict(await provider.interpretQuestionBundleResponse([
    ...turns,
    { role: 'assistant', content: bundle.text, timestamp },
    { role: 'user', content: partialReply, timestamp },
  ], mapped), questionIds);
  if (verdict.kind !== 'partial'
    || !sameIds(verdict.acceptedQuestionIds, [questionIds[0], questionIds[2]])
    || !sameIds(verdict.disputedQuestionIds, [questionIds[1]])
    || verdict.declinedQuestionIds.length !== 0) {
    throw new Error('partial_mapping_unexpected');
  }

  for (const [name, reply, expectedKind] of [
    ['agreement', 'Yes, exactly all of that.', 'agree'],
    ['full_rejection', 'No, all three points are wrong. Please discard that understanding and start over.', 'reject'],
    ['unrelated', 'What time is it?', 'unrelated'],
  ] as const) {
    stage = `interpret_${name}`;
    const result = validateQuestionBundleVerdict(await provider.interpretQuestionBundleResponse([
      ...turns,
      { role: 'assistant', content: bundle.text, timestamp },
      { role: 'user', content: reply, timestamp },
    ], mapped), questionIds);
    if (result.kind !== expectedKind) throw new Error(`${name}_mapping_unexpected`);
  }
  stage = 'interpret_decline';
  const decline = validateQuestionBundleVerdict(await provider.interpretQuestionBundleResponse([
    ...turns,
    { role: 'assistant', content: bundle.text, timestamp },
    { role: 'user', content: 'The feedback and growth path points are right. Please skip the time to learn point; I do not want to discuss it.', timestamp },
  ], mapped), questionIds);
  if (decline.kind !== 'partial'
    || !sameIds(decline.acceptedQuestionIds, [questionIds[0], questionIds[2]])
    || !sameIds(decline.declinedQuestionIds, [questionIds[1]])
    || decline.disputedQuestionIds.length !== 0) {
    throw new Error('decline_mapping_unexpected');
  }

  const clarification = {
    workingSummary: meanings[1]!,
    disputedStatement: bundle.statements.find((statement) => statement.surveyQuestionId === questionIds[1])!.statement,
  };
  stage = 'compose_clarification';
  const prompt = validateQuestionClarificationPrompt(await provider.composeQuestionClarification([
    ...turns,
    { role: 'assistant', content: bundle.text, timestamp },
    { role: 'user', content: partialReply, timestamp },
  ], clarification, 'English'));
  stage = 'interpret_clarification';
  const clarificationVerdict = validateQuestionClarificationVerdict(await provider.interpretQuestionClarificationResponse([
    { role: 'assistant', content: prompt, timestamp },
    { role: 'user', content: 'I can learn, but urgent work leaves no time allocated for training.', timestamp },
  ], clarification));
  if (clarificationVerdict.kind !== 'clarified' || !clarificationVerdict.correctedSummary.trim()) {
    throw new Error('clarification_mapping_unexpected');
  }

  stage = 'score_synthetic_question';
  const scored = await provider.scoreConfirmedMeaning({
    semanticSummary: 'I can learn new skills, but urgent work often interrupts planned training.',
    rubric: {
      version: 'synthetic-bridge-only',
      instructions: 'Assess how consistently the employee has time to develop new skills. Use the full 0–100 range.',
      anchors: [
        { score: 0, description: 'No time or opportunity for skill development.' },
        { score: 50, description: 'Some opportunities, frequently interrupted by urgent work.' },
        { score: 100, description: 'Reliable protected time and opportunities for skill development.' },
      ],
    },
    questionId: questionIds[1],
    scoringPolicyVersion: 'synthetic-bridge-only',
  });
  if (!Number.isFinite(scored.score) || scored.score < 0 || scored.score > 100
    || !Number.isFinite(scored.confidence) || scored.confidence < 0 || scored.confidence > 1
    || !scored.modelId || !scored.promptVersion) {
    throw new Error('synthetic_score_invalid');
  }

  stage = 'deidentify';
  const privateMeaning = 'Manager Mira delayed Project Atlas training on 28 September 2026.';
  let acceptedPolicyVersion: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const candidate = await provider.deidentify({ semanticSummary: privateMeaning, attempt });
    const decision = evaluateQuestionDeidentification({
      text: candidate, knownIdentifiers: ['Mira', 'Atlas', 'Project Atlas'],
    });
    if (decision.status === 'accepted') {
      acceptedPolicyVersion = decision.policyVersion;
      break;
    }
  }
  if (!acceptedPolicyVersion) throw new Error('privacy_gate_rejected_both_attempts');

  stage = 'deidentify_unlabeled_person';
  const unlabeledMeaning = 'The review was blocked by Sarah, so growth slowed.';
  let unlabeledPersonOutcome: 'model' | 'fallback' = 'fallback';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const candidate = await provider.deidentify({ semanticSummary: unlabeledMeaning, attempt });
    if (evaluateQuestionDeidentification({
      text: candidate, knownIdentifiers: ['Sarah'],
    }).status === 'accepted') {
      unlabeledPersonOutcome = 'model';
      break;
    }
  }
  if (unlabeledPersonOutcome === 'fallback' && evaluateQuestionDeidentification({
    text: 'A high adverse signal related to growth was identified.',
    knownIdentifiers: ['Sarah'],
  }).status !== 'accepted') {
    throw new Error('unlabeled_person_fallback_rejected');
  }

  const privacyScenarioOutcomes: Record<string, 'model' | 'fallback'> = {};
  for (const scenario of [
    {
      name: 'later_sentence_name',
      meaning: 'The review was delayed. Sarah dismissed my concern about growth.',
      knownIdentifiers: ['Sarah'],
    },
    {
      name: 'international_email',
      meaning: 'I sent my growth concerns to sara@会社.jp and received no answer.',
      knownIdentifiers: ['sara', '会社'],
    },
    {
      name: 'slack_user_group',
      meaning: 'The growth discussion was shared with <!subteam^S12345678|@private-team>.',
      knownIdentifiers: ['S12345678', 'private-team'],
    },
  ]) {
    stage = `deidentify_${scenario.name}`;
    let outcome: 'model' | 'fallback' = 'fallback';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const candidate = await provider.deidentify({ semanticSummary: scenario.meaning, attempt });
      if (evaluateQuestionDeidentification({
        text: candidate, knownIdentifiers: scenario.knownIdentifiers,
      }).status === 'accepted') {
        outcome = 'model';
        break;
      }
    }
    if (outcome === 'fallback' && evaluateQuestionDeidentification({
      text: 'A generalized work experience signal was identified.',
      knownIdentifiers: scenario.knownIdentifiers,
    }).status !== 'accepted') {
      throw new Error('privacy_scenario_fallback_rejected');
    }
    privacyScenarioOutcomes[scenario.name] = outcome;
  }

  console.log(JSON.stringify({
    status: 'passed',
    fixture: 'synthetic-only',
    questionCount: bundle.statements.length,
    indexBundleCount: 4,
    localizedBundleCount: 2,
    partialAcceptedCount: verdict.acceptedQuestionIds.length,
    partialDisputedCount: verdict.disputedQuestionIds.length,
    agreement: 'agree',
    rejection: 'reject',
    decline: 'partial',
    unrelated: 'unrelated',
    clarification: clarificationVerdict.kind,
    privacyPolicyVersion: acceptedPolicyVersion,
    unlabeledPersonOutcome,
    privacyScenarioOutcomes,
    latestTurnSourceBoundary: 'passed',
    syntheticScoreAdapter: 'passed',
  }));
}

function modelConfig(env: NodeJS.ProcessEnv): OpenAiProviderConfig {
  if (env['AZURE_OPENAI_ENDPOINT'] && env['AZURE_OPENAI_API_KEY']
    && env['AZURE_OPENAI_API_VERSION'] && env['OPENAI_MODEL_BALANCED']) {
    return {
      azure: true,
      endpoint: env['AZURE_OPENAI_ENDPOINT'],
      apiKey: env['AZURE_OPENAI_API_KEY'],
      apiVersion: env['AZURE_OPENAI_API_VERSION'],
      deploymentName: env['OPENAI_MODEL_BALANCED'],
    };
  }
  if (env['OPENAI_API_KEY']) return { apiKey: env['OPENAI_API_KEY'] };
  throw new Error('model_configuration_missing');
}

function sameIds(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((id) => actual.includes(id));
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'unknown';
  const message = error instanceof Error ? error.message : '';
  const reasonCode = /^v2_[a-z_]+$/.test(message) ? message : 'provider_or_model_error';
  console.error(JSON.stringify({ status: 'failed', stage, fixture: 'synthetic-only', name, reasonCode }));
  process.exitCode = 1;
});
