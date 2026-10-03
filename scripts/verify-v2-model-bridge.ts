import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenAiProvider, type OpenAiProviderConfig } from '../packages/ai-openai/src/openai-provider';
import type { ApprovedQuestionRubric, ConversationTurn } from '@entalent/application';
import { evaluateQuestionDeidentification } from '../packages/application/src/utils/question-deidentification-policy';
import { validateQuestionBundleComposition } from '../packages/application/src/utils/question-bundle-composition';
import { validateQuestionBundleVerdict } from '../packages/application/src/utils/question-bundle-verdict';
import { validateQuestionClarificationPrompt, validateQuestionClarificationVerdict } from '../packages/application/src/utils/question-clarification';

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
const approvedPolicy = JSON.parse(readFileSync(resolve('scripts/data/v2-scoring-policy-1.0.0.json'), 'utf8')) as
  Record<string, ApprovedQuestionRubric & { questionGroup: string; approvedExamples: Array<{ score: number; text: string }> }>;
let stage = 'configuration';

async function main(): Promise<void> {
  const provider = new OpenAiProvider(modelConfig(process.env));
  if (process.argv.includes('--approved-only')) {
    const observations = await verifyApprovedScoring(provider);
    console.log(JSON.stringify({ status: 'observed', fixture: 'approved-policy-1.0.0',
      approvedExampleObservations: observations,
      exactReferenceMatches: observations.filter((item) => item.approved === item.observed).length,
      referenceExampleCount: observations.length, calibrationAcceptance: 'not_assessed',
      approvedUnscoredOutcome: 'passed' }));
    return;
  }
  if (process.argv.includes('--generalization-probe')) {
    const observations = await verifyGeneralization(provider);
    console.log(JSON.stringify({ status: 'observed', fixture: 'synthetic-generalization',
      observations, correctOrderCount: observations.filter((item) => item.low < item.high).length,
      pairCount: observations.length, calibrationAcceptance: 'not_assessed' }));
    return;
  }
  const timestamp = new Date('2026-09-29T10:00:00Z');
  const sourceQuestion = [{
    id: questionIds[0], stableKey: 'autonomy_expectation_clarity',
    canonicalMeaning: approvedPolicy['autonomy_expectation_clarity']!.canonicalMeaning!,
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
  const probedTopics = new Set<string>();
  for (const indexCase of [
    {
      name: 'autonomy',
      employeeTurn: 'I want to talk about how much say I have in my work.',
      stableKeys: ['autonomy_control_work', 'autonomy_voice_influence', 'autonomy_expectation_clarity'],
      meanings: [
        'I can choose how to carry out my assigned work.',
        'My ideas are considered and can shape work decisions.',
        'I know my responsibilities, priorities, and expected results.',
      ],
    },
    {
      name: 'belonging',
      employeeTurn: 'I want to talk about feeling included at work.',
      stableKeys: ['belonging_team', 'belonging_psychological_safety', 'belonging_manager_support'],
      meanings: [
        'I feel accepted and included in my team.',
        'I feel safe raising concerns and admitting mistakes.',
        'My manager helps with priorities and work blockers.',
      ],
    },
    {
      name: 'growth',
      employeeTurn: 'I want to talk about feedback and growth at work.',
      stableKeys: ['growth_skill_development', 'growth_useful_feedback', 'growth_future_opportunities'],
      meanings: [
        'My work helps me develop useful skills.',
        'Feedback helps me understand what to improve.',
        'I can access opportunities to keep growing here.',
      ],
    },
    {
      name: 'purpose',
      employeeTurn: 'I want to talk about whether my work matters.',
      stableKeys: ['purpose_personal_meaning', 'purpose_contribution_visibility', 'purpose_recognition'],
      meanings: [
        'I find my work meaningful.',
        'I can see how my work helps colleagues and customers.',
        'My good work and contributions are noticed and acknowledged.',
      ],
    },
  ]) {
    stage = `compose_bundle_${indexCase.name}`;
    if (indexCase.stableKeys.length !== 3 || indexCase.stableKeys.some((key) => {
      probedTopics.add(key);
      return approvedPolicy[key]?.questionGroup !== indexCase.name;
    })) throw new Error('canonical_question_map_mismatch');
    validateQuestionBundleComposition(await provider.composeQuestionBundle(
      [{ role: 'user', content: indexCase.employeeTurn, timestamp }],
      questionIds.map((surveyQuestionId, index) => ({
        surveyQuestionId, workingSummary: indexCase.meanings[index]!,
      })),
      'English',
    ), questionIds);
  }
  if (probedTopics.size !== 12 || Object.keys(approvedPolicy).some((key) => !probedTopics.has(key))) {
    throw new Error('canonical_question_map_mismatch');
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
  if (scored.outcome !== 'scored' || !Number.isInteger(scored.score)
    || scored.score === null || scored.score < 0 || scored.score > 100
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

async function verifyApprovedScoring(provider: OpenAiProvider): Promise<Array<{ topic: string; approved: number; observed: number }>> {
  stage = 'score_approved_policy';
  const calibration: Array<{ topic: string; approved: number; observed: number }> = [];
  if (Object.keys(approvedPolicy).length !== 12) throw new Error('approved_policy_topic_count_invalid');
  for (const [topic, rubric] of Object.entries(approvedPolicy)) {
    if (rubric.anchors.length !== 5 || !rubric.canonicalMeaning || !rubric.title) {
      throw new Error('approved_policy_rubric_incomplete');
    }
    for (const example of rubric.approvedExamples) {
      stage = `score_approved_${topic}`;
      const result = await provider.scoreConfirmedMeaning({
        semanticSummary: example.text,
        rubric,
        questionId: topic,
        scoringPolicyVersion: '1.0.0',
      });
      if (result.outcome !== 'scored' || !Number.isInteger(result.score)
        || result.score === null || result.score < 0 || result.score > 100) {
        throw new Error('approved_policy_score_invalid');
      }
      calibration.push({ topic, approved: example.score, observed: result.score });
    }
  }
  if (calibration.length !== 14) throw new Error('approved_example_count_invalid');

  stage = 'score_approved_insufficient_evidence';
  const unscored = await provider.scoreConfirmedMeaning({
    semanticSummary: 'I have not needed help from my manager, so I cannot assess whether support is available.',
    rubric: approvedPolicy['belonging_manager_support']!,
    questionId: 'belonging_manager_support',
    scoringPolicyVersion: '1.0.0',
  });
  if (unscored.outcome !== 'insufficient_evidence' || unscored.score !== null) {
    throw new Error('approved_policy_unscored_invalid');
  }
  return calibration;
}

async function verifyGeneralization(provider: OpenAiProvider): Promise<Array<{ topic: string; low: number; high: number }>> {
  const observations: Array<{ topic: string; low: number; high: number }> = [];
  const selectedTopic = process.argv.find((arg) => arg.startsWith('--topic='))?.slice('--topic='.length);
  for (const scenario of [
    { topic: 'autonomy_control_work',
      low: 'I like the team, but even small changes to my assigned work need several approvals and my suggestions to improve the process are consistently blocked.',
      high: 'I choose how to deliver my assigned work, make meaningful decisions, and regularly implement process improvements without unnecessary approvals.' },
    { topic: 'autonomy_voice_influence',
      low: 'When I suggest improvements, no one discusses them or explains decisions, and my input never changes the work.',
      high: 'My ideas are heard, discussed seriously, and have repeatedly shaped team decisions and working practices.' },
    { topic: 'autonomy_expectation_clarity',
      low: 'My priorities change without explanation, and I do not know what results or standards my role is expected to meet.',
      high: 'I know my responsibilities, current priorities, expected results, and how success in my role will be judged.' },
    { topic: 'growth_skill_development',
      low: 'My work repeats skills I already know and gives me no useful chances to learn or develop professionally.',
      high: 'My work regularly builds skills that matter to my career, and I can describe steady progress from recent tasks and accessible learning.' },
    { topic: 'growth_useful_feedback',
      low: 'The only feedback I receive is vague praise or criticism, so I never learn what to change in my work.',
      high: 'I regularly receive specific feedback I can act on, and it has helped me improve recent work.' },
    { topic: 'growth_future_opportunities',
      low: 'I see no accessible training, stretch work, or path to progress here, even after asking about development.',
      high: 'I can access relevant learning and stretch opportunities, and I understand a realistic path for growing here.' },
    { topic: 'purpose_personal_meaning',
      low: 'I cannot connect my daily work to anything I value; it consistently feels pointless to me.',
      high: 'My work consistently matters to me because I can see how it advances the outcomes I personally value.' },
    { topic: 'purpose_contribution_visibility',
      low: 'I deliver tasks but never learn who uses the results or what difference they make, so I cannot see my contribution.',
      high: 'I can trace my work to clear outcomes for colleagues and customers and understand how my contribution helps.' },
    { topic: 'purpose_recognition',
      low: 'Valuable work I deliver is repeatedly overlooked, and no one acknowledges my contributions.',
      high: 'My good work and useful contributions are consistently noticed and acknowledged in meaningful ways.' },
    { topic: 'belonging_team',
      low: 'I am left out of team discussions and social routines and do not feel accepted as a member of the team.',
      high: 'I am included in team discussions and routines, and I feel accepted as a genuine member of the team.' },
    { topic: 'belonging_psychological_safety',
      low: 'People are publicly humiliated after raising concerns, so I hide mistakes and avoid disagreeing even when I see a serious problem.',
      high: 'I have raised difficult concerns and admitted mistakes; each time colleagues responded respectfully and helped us improve.' },
    { topic: 'belonging_manager_support',
      low: 'When I need help with daily work, my manager is unavailable and leaves me without guidance or practical support.',
      high: 'When I need help with daily work, my manager responds promptly with useful guidance and practical support.' },
  ]) {
    if (selectedTopic && scenario.topic !== selectedTopic) continue;
    const scores: number[] = [];
    for (const semanticSummary of [scenario.low, scenario.high]) {
      stage = `generalization_${scenario.topic}`;
      const result = await provider.scoreConfirmedMeaning({ semanticSummary,
        rubric: approvedPolicy[scenario.topic]!, questionId: scenario.topic,
        scoringPolicyVersion: '1.0.0' });
      if (result.outcome !== 'scored' || !Number.isInteger(result.score)
        || result.score === null || result.score < 0 || result.score > 100) {
        throw new Error('generalization_score_invalid');
      }
      scores.push(result.score);
    }
    observations.push({ topic: scenario.topic, low: scores[0]!, high: scores[1]! });
  }
  if ((!selectedTopic && observations.length !== Object.keys(approvedPolicy).length)
    || (selectedTopic && observations.length !== 1)
    || new Set(observations.map((item) => item.topic)).size !== observations.length) {
    throw new Error('generalization_topic_coverage_invalid');
  }
  return observations;
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
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; code?: string }> })?.issues;
  console.error(JSON.stringify({ status: 'failed', stage,
    fixture: process.argv.includes('--approved-only') ? 'approved-policy-1.0.0'
      : process.argv.includes('--generalization-probe') ? 'synthetic-generalization' : 'synthetic-only',
    name, reasonCode,
    ...(name === 'ZodError' && Array.isArray(issues) ? { validationIssues: issues.map((issue) => ({
      path: issue.path?.join('.') ?? '', code: issue.code ?? 'unknown',
    })) } : {}),
  }));
  process.exitCode = 1;
});
