import type { SituationClassification } from '@entalent/contracts';
import type { ReplyPlan } from '../ports/ai-provider.port';
import type { MemoryItemRecord } from '../types/records';

const ANCHOR_CATEGORIES = new Set(['commitment', 'milestone', 'stressor', 'project_context', 'concern']);
const GROUNDING_CATEGORY_PRIORITY = ['milestone', 'commitment', 'concern', 'stressor', 'project_context'];

export interface ReplyPlanInput {
  classification: SituationClassification;
  memoryItems?: Pick<MemoryItemRecord, 'category' | 'content' | 'importance'>[];
  includeFollowUpQuestion: boolean;
  currentTurnHasTopicAnchor?: boolean;
  correctionCarryover?: boolean;
  surveyProbeQuestionId?: string;
  sensitiveMode?: boolean;
}

export function buildReplyPlan(input: ReplyPlanInput): ReplyPlan {
  const { classification } = input;
  const dialogueAct = classification.dialogueAct;
  const latestUserSubstance = classification.latestUserSubstance?.trim() || null;
  const topicAnchor = classification.topicAnchor?.trim() || null;
  const resolvedDetails = [...new Set(
    (classification.resolvedDetails ?? [])
      .map((detail) => detail.trim())
      .filter(Boolean),
  )].slice(0, 5);
  const sensitiveMode = input.sensitiveMode ?? false;
  const safetyOverridesPause = sensitiveMode &&
    (dialogueAct === 'closing' || dialogueAct === 'acknowledgement');
  // CAP-6: an accepted offer is a request for the offered item even when the surface act is a
  // backchannel. Safety, a disclosure, a correction, and a closing keep their own contracts.
  const priorAssistantOffer = classification.priorAssistantOffer ?? false;
  const acceptsPriorOffer = !sensitiveMode
    && priorAssistantOffer
    && (classification.acceptsPriorOffer ?? false)
    && OFFER_ACCEPTING_ACTS.has(dialogueAct);
  const correctionCarryover = input.correctionCarryover ?? false;
  const memoryAnchors = safetyOverridesPause || dialogueAct === 'correction' || correctionCarryover || acceptsPriorOffer
    ? []
    : selectMemoryAnchors(input.memoryItems ?? []);
  const responseMove = safetyOverridesPause
    ? 'support_emotion'
    : acceptsPriorOffer
      ? 'answer_request'
      : responseMoveFor(dialogueAct);
  const mayInferFromBrevity = latestUserSubstance !== null;
  // CAP-9: a list shape is honoured only where the typed move produces content; a pause,
  // emotional support, or a safety turn keeps prose.
  const formatRequest = !sensitiveMode && FORMAT_HONOURING_MOVES.has(responseMove) && dialogueAct !== 'acknowledgement'
    ? classification.formatRequest ?? null
    : null;
  // Delivering an accepted offer or a requested shape ends the turn; no question of the mentor's own.
  const questionPolicy = acceptsPriorOffer
    ? { maxQuestions: 0 as const, reason: 'offer_delivery' as const }
    : formatRequest
      ? { maxQuestions: 0 as const, reason: 'format_request' as const }
      : buildQuestionPolicy({
          dialogueAct,
          includeFollowUpQuestion: input.includeFollowUpQuestion,
        });

  return {
    dialogueAct,
    correctionCarryover,
    latestUserSubstance,
    topicAnchor,
    resolvedDetails,
    memoryAnchors,
    responseMove,
    mayInferFromBrevity,
    questionPolicy,
    requiredGrounding: safetyOverridesPause
      ? []
      : acceptsPriorOffer
        ? [PRIOR_OFFER_GROUNDING]
        : buildRequiredGrounding(
            responseMove,
            input.currentTurnHasTopicAnchor ?? topicAnchor !== null,
            memoryAnchors,
          ),
    forbiddenMoves: buildForbiddenMoves({
      responseMove,
      mayInferFromBrevity,
      sensitiveMode,
      surveyProbeQuestionId: input.surveyProbeQuestionId,
      acceptsPriorOffer,
      openPriorOffer: priorAssistantOffer && !acceptsPriorOffer,
    }),
    formatRequest,
  };
}

const OFFER_ACCEPTING_ACTS = new Set<SituationClassification['dialogueAct']>([
  'acknowledgement', 'continuation', 'request', 'new_substance', 'social_checkin', 'greeting',
]);
const FORMAT_HONOURING_MOVES = new Set<ReplyPlan['responseMove']>([
  'answer_request', 'address_new_substance', 'continue_existing_thread',
]);

/** Prompt-side description only; the offered item itself is read from the transcript. */
const PRIOR_OFFER_GROUNDING: ReplyPlan['requiredGrounding'][number] = {
  source: 'prior_offer',
  category: 'offer',
  content: 'the item offered in the previous assistant turn',
  requirement: 'deliver_now',
};

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
  includeFollowUpQuestion: boolean;
}): ReplyPlan['questionPolicy'] {
  if (input.dialogueAct === 'closing') {
    return { maxQuestions: 0, reason: 'strategy_disallows_questions' };
  }

  if (input.dialogueAct === 'correction') {
    return { maxQuestions: 0, reason: 'strategy_disallows_questions' };
  }

  if (!input.includeFollowUpQuestion) {
    return { maxQuestions: 0, reason: 'strategy_disallows_questions' };
  }

  if (input.dialogueAct === 'acknowledgement') {
    return { maxQuestions: 1, reason: 'new_substance_allows_question' };
  }

  if (input.dialogueAct === 'greeting') {
    return { maxQuestions: 1, reason: 'greeting_opens_conversation' };
  }

  if (input.dialogueAct === 'social_checkin') {
    return { maxQuestions: 1, reason: 'social_checkin_returns_question' };
  }

  return { maxQuestions: 1, reason: 'new_substance_allows_question' };
}

function buildRequiredGrounding(
  responseMove: ReplyPlan['responseMove'],
  currentTurnHasTopicAnchor: boolean,
  memoryAnchors: ReplyPlan['memoryAnchors'],
): ReplyPlan['requiredGrounding'] {
  if (responseMove !== 'support_emotion' || currentTurnHasTopicAnchor) return [];
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
  acceptsPriorOffer: boolean;
  /** The previous mentor turn offered something the employee has not accepted. */
  openPriorOffer: boolean;
}): ReplyPlan['forbiddenMoves'] {
  const forbidden = new Set<ReplyPlan['forbiddenMoves'][number]>();
  forbidden.add('unsupported_interpretation');
  if (!input.mayInferFromBrevity) forbidden.add('comment_on_brevity');
  // CAP-6: deliver, do not offer. One open offer per thread; none when something was just asked
  // for. In sensitive mode the safety contract already forbids frameworks and offers.
  if (input.acceptsPriorOffer) forbidden.add('offer_again');
  if (!input.sensitiveMode
    && (input.acceptsPriorOffer || input.openPriorOffer || input.responseMove === 'answer_request')) {
    forbidden.add('new_offer');
  }
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
