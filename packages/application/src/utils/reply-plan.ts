import type { SituationClassification } from '@entalent/contracts';
import type { ReplyPlan } from '../ports/ai-provider.port';
import type { MemoryItemRecord } from '../types/records';

const ANCHOR_CATEGORIES = new Set(['commitment', 'milestone', 'stressor', 'project_context', 'concern']);
const GROUNDING_CATEGORY_PRIORITY = ['milestone', 'commitment', 'concern', 'stressor', 'project_context'];

export interface ReplyPlanInput {
  classification: SituationClassification;
  memoryItems?: Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>[];
  includeFollowUpQuestion: boolean;
  lastReplyAskedQuestion?: boolean;
  surveyProbeQuestionId?: string;
  sensitiveMode?: boolean;
}

export function buildReplyPlan(input: ReplyPlanInput): ReplyPlan {
  const { classification } = input;
  const dialogueAct = classification.dialogueAct;
  const latestUserSubstance = classification.latestUserSubstance?.trim() || null;
  const topicAnchor = classification.topicAnchor?.trim() || null;
  const memoryAnchors = selectMemoryAnchors(input.memoryItems ?? []);
  const responseMove = responseMoveFor(dialogueAct);
  const mayInferFromBrevity = latestUserSubstance !== null;
  const questionPolicy = buildQuestionPolicy({
    dialogueAct,
    latestUserSubstance,
    includeFollowUpQuestion: input.includeFollowUpQuestion,
    lastReplyAskedQuestion: input.lastReplyAskedQuestion ?? false,
  });

  return {
    dialogueAct,
    latestUserSubstance,
    topicAnchor,
    memoryAnchors,
    responseMove,
    mayInferFromBrevity,
    questionPolicy,
    requiredGrounding: buildRequiredGrounding(responseMove, topicAnchor, memoryAnchors),
    forbiddenMoves: buildForbiddenMoves({
      responseMove,
      mayInferFromBrevity,
      sensitiveMode: input.sensitiveMode ?? false,
      surveyProbeQuestionId: input.surveyProbeQuestionId,
    }),
  };
}

function selectMemoryAnchors(
  items: Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>[],
): ReplyPlan['memoryAnchors'] {
  return items
    .filter((item) => ANCHOR_CATEGORIES.has(item.category))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3)
    .map((item) => ({ category: item.category, content: item.content }));
}

function responseMoveFor(dialogueAct: SituationClassification['dialogueAct']): ReplyPlan['responseMove'] {
  switch (dialogueAct) {
    case 'greeting':
      return 'social_greeting';
    case 'social_checkin':
      return 'social_reply';
    case 'acknowledgement':
    case 'continuation':
      return 'continue_existing_thread';
    case 'request':
      return 'answer_request';
    case 'emotional_disclosure':
      return 'support_emotion';
    case 'closing':
      return 'close_or_pause';
    case 'correction':
    case 'new_substance':
    default:
      return 'address_new_substance';
  }
}

function buildQuestionPolicy(input: {
  dialogueAct: SituationClassification['dialogueAct'];
  latestUserSubstance: string | null;
  includeFollowUpQuestion: boolean;
  lastReplyAskedQuestion: boolean;
}): ReplyPlan['questionPolicy'] {
  if (!input.includeFollowUpQuestion) {
    return { maxQuestions: 0, reason: 'strategy_disallows_questions' };
  }

  if (input.dialogueAct === 'greeting') {
    return { maxQuestions: 0, reason: 'greeting_no_question' };
  }

  if (input.dialogueAct === 'social_checkin') {
    return { maxQuestions: 1, reason: 'social_checkin_returns_question' };
  }

  if (input.dialogueAct === 'acknowledgement' && input.latestUserSubstance === null) {
    return { maxQuestions: 0, reason: 'acknowledgement_no_new_substance' };
  }

  if (input.lastReplyAskedQuestion && input.dialogueAct !== 'new_substance') {
    return { maxQuestions: 0, reason: 'asked_recently' };
  }

  return { maxQuestions: 1, reason: 'new_substance_allows_question' };
}

function buildRequiredGrounding(
  responseMove: ReplyPlan['responseMove'],
  topicAnchor: string | null,
  memoryAnchors: ReplyPlan['memoryAnchors'],
): ReplyPlan['requiredGrounding'] {
  if (responseMove !== 'support_emotion') return [];
  if (!topicAnchor) return [];
  const anchor = selectGroundingAnchor(memoryAnchors);
  if (!anchor) return [];
  return [{
    source: 'memory',
    category: anchor.category,
    content: anchor.content,
    requirement: 'mention_explicitly',
  }];
}

function selectGroundingAnchor(memoryAnchors: ReplyPlan['memoryAnchors']): ReplyPlan['memoryAnchors'][number] | undefined {
  return [...memoryAnchors].sort((a, b) => {
    const aPriority = GROUNDING_CATEGORY_PRIORITY.indexOf(a.category);
    const bPriority = GROUNDING_CATEGORY_PRIORITY.indexOf(b.category);
    return normalizePriority(aPriority) - normalizePriority(bPriority);
  })[0];
}

function normalizePriority(priority: number): number {
  return priority === -1 ? Number.MAX_SAFE_INTEGER : priority;
}

function buildForbiddenMoves(input: {
  responseMove: ReplyPlan['responseMove'];
  mayInferFromBrevity: boolean;
  sensitiveMode: boolean;
  surveyProbeQuestionId?: string;
}): ReplyPlan['forbiddenMoves'] {
  const forbidden = new Set<ReplyPlan['forbiddenMoves'][number]>();
  if (!input.mayInferFromBrevity) forbidden.add('comment_on_brevity');
  if (input.responseMove === 'social_reply') forbidden.add('operational_status');
  if (input.responseMove === 'support_emotion') forbidden.add('action_plan');
  if (input.sensitiveMode) {
    forbidden.add('diagnose');
    forbidden.add('action_plan');
    forbidden.add('survey_probe');
  } else if (!input.surveyProbeQuestionId) {
    forbidden.add('survey_probe');
  }
  return [...forbidden];
}
