import { vi } from 'vitest';
import { ConversationOrchestrator, ProactiveCheckInUseCase, type LanguagePolicy, type OnboardingTurnPort } from '@entalent/application';
import type { rpt05FixtureSuite } from './pulse-report-inputs.fixture';
/** Actual application composers and message repository; provider/queue adapters are deterministic fakes. */
export async function runLocalizedProbe(
  s: ReturnType<typeof rpt05FixtureSuite>,
  f: Awaited<ReturnType<ReturnType<typeof rpt05FixtureSuite>['fixture']>>,
  policy: LanguagePolicy,
  path: 'ordinary'|'proactive',
  options: {userId?:string;onboardingTurn?:OnboardingTurnPort} = {},
) {
  const userId=options.userId ?? f.users[0]!,conversationId=f.conversations.get(userId)!,question=f.numeric[0]!;
  const form=policy.resources!.engagement!.texts[question.stableKey]!;
  const history:Array<NonNullable<Awaited<ReturnType<typeof s.conversation.findMessageById>>>>=[];
  for(let i=0;i<3;i++) {const source=await s.inbound(f,userId,'Synthetic substantive work context '+i);const message=await s.conversation.findMessageById(source.inboundMessageId,f.tenantId,conversationId);history.push(message!);}
  const current=history[history.length-1]!;
  const repo={
    findById:async()=>({id:conversationId,tenantId:f.tenantId,userId,channelType:'dev',externalConversationId:'fixture',userDisplayName:'Fixture',userLocale:policy.responseLanguage,userTimezone:'UTC'}),
    findRecentMessages:async()=>history,
    findLatestDeliveredReportingDisclosure:s.conversation.findLatestDeliveredReportingDisclosure.bind(s.conversation),
    resolvePersonalLanguage:async()=>policy,
    saveMessage:s.conversation.saveMessage.bind(s.conversation),updateActiveTopic:vi.fn(),
  };
  const ai={classifySituation:async()=>({primaryIntent:'casual_conversation',secondaryIntents:[],emotionalState:[],urgency:'low',confidence:1,surveyAllowed:true,requiresSafetyCheck:false,reasoningSummary:'Fixture',dialogueAct:'new_substance',latestUserSubstance:'Synthetic work context',topicAnchor:null,reminderRequest:null,...(options.onboardingTurn?{onboardingSignal:{intent:'acknowledge',substantive:true}}:{})}),detectRisk:async()=>({riskType:null,severity:'none',confidence:1,evidence:[],immediateResponseRequired:false,escalationRecommended:false,surveyMustBeBlocked:false,proactiveMessagesMustBePaused:false,reasoningSummary:'Fixture'}),generateResponse:vi.fn(async()=>({text:form,confidence:1,containsSurveyProbe:true,surveyProbeQuestionId:question.id})),scoreSentiment:async()=>.5};
  const outbox={enqueueMessageSend:vi.fn(),enqueueMemoryExtraction:vi.fn(),enqueueSurveyEvidence:vi.fn(),enqueueGroupReport:vi.fn(),enqueueFollowUpExecution:vi.fn(),enqueueStyleAnalysis:vi.fn(),enqueueProfileHydration:vi.fn()};
  const survey={findPulseCaptureForConversation:async()=>[],findPendingConfirmationGroups:async()=>[],findAwaitingConfirmationGroups:async()=>[],findOrCreateActiveWindow:async()=>({id:f.windows.get(userId)!}),findQuestionsForWindow:async()=>[question],findEvidenceForQuestion:async()=>[],findAssessmentsForWindow:async()=>[],findTeamByMemberId:async()=>null,findCurrentHierarchyIdentifiers:async()=>[]};
  const backlog={getNextProbeQuestion:vi.fn(async()=>({question,windowId:f.windows.get(userId)!,focus:'open'})),recordProbeSent:vi.fn()};
  const input={messageId:current.id,conversationId,tenantId:f.tenantId,userId,externalWorkspaceId:'fixture',externalConversationId:'fixture',traceId:'rptlang-correction-fixture'};
  const result=path==='proactive'
    ? await new ProactiveCheckInUseCase(repo as never,ai as never,outbox as never,undefined,backlog as never).execute(input)
    : await new ConversationOrchestrator(repo as never,ai as never,outbox as never,undefined,survey as never,undefined,undefined,{isEnabled:async()=>true} as never,undefined,backlog as never,undefined,undefined,undefined,undefined,options.onboardingTurn).orchestrate(input);
  return {result,ai,outbox,question};
}
