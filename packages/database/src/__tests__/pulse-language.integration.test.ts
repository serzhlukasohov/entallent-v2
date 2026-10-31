import {OnboardingService} from '../../../../apps/worker/src/onboarding/onboarding.service';
import {OnboardingStateRepository} from '../../../../apps/worker/src/onboarding/onboarding-state.repository';
import {appendReportingDisclosure} from '../../../application/src/utils/reporting-disclosure';
import {runLocalizedProbe} from './pulse-language-composition.fixture';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DatabaseService } from '../../../../apps/worker/src/database/database.service';
import { ConversationRepository } from '../../../../apps/worker/src/conversation/repositories/conversation.repository';
import {ReportConfigurationService} from '../../../../apps/api/src/report-configuration/report-configuration.service';
import {afterAll,describe,it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {eq,and} from 'drizzle-orm';
import {PULSE_ENGLISH_RESOURCES, PULSE_COPY_VERSION, PULSE_LANGUAGE_POLICY, type PulseResourceKind} from '@entalent/contracts';
import {PreparePulseLanguageUseCase, PrepareAnalyticalRenditionUseCase, FinalizeQuestionInsightUseCase} from '@entalent/application';
import {PulseLanguageRepository} from '../../../../apps/worker/src/survey/repositories/pulse-language.repository';
import {AnalyticalRenditionRepository} from '../../../../apps/worker/src/survey/repositories/analytical-rendition.repository';
import {ReportingPermissionRepository} from '../../../../apps/worker/src/survey/repositories/reporting-permission.repository';
import {CompanyLanguageReadService} from '../../../../apps/api/src/admin/company-language-read.service';
import {rpt05FixtureSuite} from './pulse-report-inputs.fixture';
import {addPulsePresentationTopics} from './pulse-report-presentation.fixture';
import {stageLanguageTopics} from './pulse-language.fixture';
import * as schema from '../schema';

describe.runIf(Boolean(process.env.DATABASE_URL))('RPT-LANG migrated boundaries (fake reviews prove plumbing only)',()=>{
 const s=rpt05FixtureSuite();afterAll(s.cleanup);
 const resources=new PulseLanguageRepository(s.database),renditions=new AnalyticalRenditionRepository(s.database);
 async function prepare(locale:string,kind:PulseResourceKind){
  const source=PULSE_ENGLISH_RESOURCES[kind as keyof typeof PULSE_ENGLISH_RESOURCES];
  // Synthetic complete fixture catalog: this is NOT multilingual fidelity acceptance.
  const generator={modelId:'fixture-only',generate:vi.fn(async()=>({...source})),review:vi.fn(async()=>({semanticPass:true,modelId:'fixture-only-review',promptVersion:'fixture-v1'}))};
  return new PreparePulseLanguageUseCase(resources,generator).execute({locale,kind,source});
 }
 it('stores nullable legacy provenance, pure reads, and exact source/version resources',async()=>{
  const f=await s.fixture(1);const before=await s.raw`select count(*)::int n from tenant_report_config_revisions where tenant_id=${f.tenantId}`;
  const read=new CompanyLanguageReadService(s.database);const language=await read.read(f.tenantId);
  expect(language.locale).toBe('en');expect(language.resources.admin?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await s.raw`select count(*)::int n from tenant_report_config_revisions where tenant_id=${f.tenantId}`)[0].n).toBe(before[0].n);
  const r=await prepare('de','safe_signal');await expect(resources.install({...r,texts:{generalized:'Changed copy'}})).rejects.toThrow('language_hash_invalid');
  const [legacy]=await s.raw`select column_default from information_schema.columns where table_name='survey_question_insights' and column_name='prose_provenance'`;
  expect(legacy.column_default).toBeNull();
 });
 it('orders accepted/pending personal preferences by trusted DB receipt, preserving explicit selection and unrelated keys',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!,pendingLocale='de-x-'+randomUUID().slice(0,8);await s.db.update(schema.users).set({communicationPreferences:{otherSetting:true}}).where(eq(schema.users.id,userId));
  await prepare('uk','operational');await prepare('uk','disclosure');
  const first=await s.inbound(f,userId,'Please use Ukrainian.'),later=await s.inbound(f,userId,'Please use German.');
  expect((await s.conversation.resolvePersonalLanguage({...first,inboundMessageId:first.inboundMessageId,proposal:{locale:'uk',kind:'explicit'}})).responseLanguage).toBe('uk');
  const pending=await s.conversation.resolvePersonalLanguage({...later,inboundMessageId:later.inboundMessageId,proposal:{locale:pendingLocale,kind:'explicit'}});
  expect(pending).toMatchObject({responseLanguage:'uk',requestedLocale:pendingLocale,resourceStatus:'language_unavailable'});
  await s.conversation.resolvePersonalLanguage({...first,inboundMessageId:first.inboundMessageId,proposal:{locale:'uk',kind:'explicit'}});
  let [user]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));
  expect(user.communicationPreferences).toMatchObject({otherSetting:true,pulseLanguage:{locale:'uk'},pulseLanguagePending:{locale:pendingLocale,inboundId:later.inboundMessageId}});
  await prepare(pendingLocale,'operational');await prepare(pendingLocale,'disclosure');
  const selected=await s.conversation.resolvePersonalLanguage({...later,inboundMessageId:later.inboundMessageId,proposal:{locale:pendingLocale,kind:'explicit'}});
  expect(selected.responseLanguage).toBe(pendingLocale);
  const number=await s.inbound(f,userId,'7');
  expect((await s.conversation.resolvePersonalLanguage({...number,inboundMessageId:number.inboundMessageId,proposal:{locale:'uk',kind:'inferred'}})).responseLanguage).toBe(pendingLocale);
  [user]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));
  expect(user.communicationPreferences).toMatchObject({otherSetting:true,pulseLanguage:{locale:pendingLocale,kind:'explicit'}});expect(user.communicationPreferences).not.toHaveProperty('pulseLanguagePending');
  expect((await s.db.select().from(schema.tenants).where(eq(schema.tenants.id,f.tenantId)))[0].locale).toBe('en');
  await expect(s.conversation.resolvePersonalLanguage({tenantId:randomUUID(),userId})).rejects.toThrow('language_subject_missing');
 });
 it('R2 preserves a pending explicit request through later inference and accepts it at its original clock',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!,locale='uk-x-'+randomUUID().slice(0,8);
  await prepare('de','operational');await prepare('de','disclosure');
  const explicit=await s.inbound(f,userId,'Please use Ukrainian.'),inferred=await s.inbound(f,userId,'A substantial German work statement.');
  expect(await s.conversation.resolvePersonalLanguage({...explicit,proposal:{locale,kind:'explicit'}})).toMatchObject({requestedLocale:locale,resourceStatus:'language_unavailable'});
  const [first]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));
  const pending=(first.communicationPreferences as Record<string,unknown>).pulseLanguagePending;
  expect(await s.conversation.resolvePersonalLanguage({...inferred,proposal:{locale:'de',kind:'inferred'}})).toMatchObject({requestedLocale:locale,resourceStatus:'language_unavailable'});
  expect((await s.db.select().from(schema.users).where(eq(schema.users.id,userId)))[0].communicationPreferences).toMatchObject({pulseLanguagePending:pending});
  await prepare(locale,'operational');await prepare(locale,'disclosure');
  expect(await s.conversation.resolvePersonalLanguage({...inferred,proposal:{locale:'de',kind:'inferred'}})).toMatchObject({responseLanguage:locale,source:'explicit_current'});
  const [accepted]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));
  expect(accepted.communicationPreferences).toMatchObject({pulseLanguage:pending});expect(accepted.communicationPreferences).not.toHaveProperty('pulseLanguagePending');
  const newer=await s.inbound(f,userId,'Please use German instead.');
  expect(await s.conversation.resolvePersonalLanguage({...newer,proposal:{locale:'de',kind:'explicit'}})).toMatchObject({responseLanguage:'de'});
  await s.conversation.resolvePersonalLanguage({...explicit,proposal:{locale,kind:'explicit'}});
  expect((await s.db.select().from(schema.users).where(eq(schema.users.id,userId)))[0].communicationPreferences).toMatchObject({pulseLanguage:{locale:'de',inboundId:newer.inboundMessageId}});
 });
 it('R5 resolves accepted non-English resources on a real single-connection pool without a spare connection',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!;await prepare('de','operational');await prepare('de','disclosure');
  const inbound=await s.inbound(f,userId,'Please use German.');
  const raw=postgres(process.env.DATABASE_URL!,{max:1});const db=drizzle(raw);
  const database=new DatabaseService({get:()=>process.env.DATABASE_URL} as never);
  (database as unknown as {_client:{db:typeof db;sql:typeof raw}})._client={db,sql:raw};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {const result=await Promise.race([new ConversationRepository(database).resolvePersonalLanguage({...inbound,proposal:{locale:'de',kind:'explicit'}}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('language_pool_starved')),1500);})]);expect(result).toMatchObject({responseLanguage:'de',resourceStatus:'ready'});}
  finally{clearTimeout(timer);await raw.end({timeout:1});}
 });
 it('freezes German capture across config edit and language-only retry, stages score once, and keeps original message bytes',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!;await new ReportConfigurationService(s.database).saveLanguage(f.tenantId,'de',1,{type:'internal_operator',operatorId:'fixture-only'});
  const staged=await stageLanguageTopics(s,f,userId),q=staged.questions[0]!;
  // Real PostgreSQL writers may use sub-millisecond revisions; preserve all six digits for CAS.
  await s.raw`update survey_question_working_insights set updated_at='2026-10-29T12:34:56.123456Z' where survey_window_id=${staged.windowId} and survey_question_id=${q.id}`;
  const scorer={scoreConfirmedMeaning:vi.fn(async()=>({score:73,confidence:.9,modelId:'scoring-fixture',promptVersion:'scoring-v1',direction:'mixed' as const,severity:'low' as const,rootCauseCategory:'autonomy' as const}))};
  const deidentifier={deidentify:vi.fn(async()=>{throw new Error('fixture-language-unavailable')})};
  const languages={read:vi.fn().mockResolvedValue(null),install:vi.fn()};
  const finalizer=new FinalizeQuestionInsightUseCase(staged.repo,scorer,deidentifier,languages);
  const input={tenantId:f.tenantId,userId,surveyWindowId:staged.windowId,surveyQuestionId:q.id};
  await expect(finalizer.execute(input)).rejects.toMatchObject({code:'language_unavailable'});
  const [working]=await s.db.select().from(schema.surveyQuestionWorkingInsights).where(and(eq(schema.surveyQuestionWorkingInsights.surveyWindowId,staged.windowId),eq(schema.surveyQuestionWorkingInsights.surveyQuestionId,q.id)));
  expect(working.languageCapture).toMatchObject({locale:'de'});expect(working.scoreCache).toMatchObject({score:73});expect(working.purgedAt).toBeNull();
  await new ReportConfigurationService(s.database).saveLanguage(f.tenantId,'fr',2,{type:'internal_operator',operatorId:'fixture-only'});
  languages.read.mockResolvedValue({locale:'de',texts:{generalized:'Ein allgemeines Signal zum Arbeitserleben wurde erkannt.'}});
  expect(await finalizer.execute(input)).toBe('finalized');expect(scorer.scoreConfirmedMeaning).toHaveBeenCalledTimes(1);
  const [final]=await s.db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.surveyQuestionId,q.id));
  expect(final).toMatchObject({score:'73',modelId:'scoring-fixture',promptVersion:'scoring-v1',summarySupport:'generalized_signal',proseProvenance:expect.objectContaining({locale:'de'})});
  const [message]=await s.db.select().from(schema.messages).where(eq(schema.messages.id,staged.source.inboundMessageId));expect(message.text).toBe('Synthetic employee statement about decision ownership.');
  const [purged]=await s.db.select().from(schema.surveyQuestionWorkingInsights).where(eq(schema.surveyQuestionWorkingInsights.id,working.id));expect(purged.scoreCache).toBeNull();expect(purged.languageCapture).toBeNull();
 });
 async function prepared(){const f=await s.fixture(1),userId=f.users[0]!;await addPulsePresentationTopics(s,f,userId);const [i]=await s.db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.tenantId,f.tenantId));const source=await renditions.loadPermittedSource(f.tenantId,i.id);expect(source).not.toBeNull();const record={source:source!,locale:'de',text:'Die Beschäftigten beschreiben ausreichende Wahlfreiheit bei der Arbeitsgestaltung.',policyVersion:PULSE_LANGUAGE_POLICY,modelId:'fixture-only',promptVersion:'fixture-v1'};expect(await renditions.install(record)).toBe('installed');return{f,userId,i,record};}
 it('R1 composes authorized disclosure before the exact approved form and persists both immutable delivery proofs',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!,question=f.numeric[0]!;
  const engagement=await prepare('uk','engagement'),disclosure=await prepare('uk','disclosure');
  const form=engagement.texts[question.stableKey]!,rights=disclosure.texts.rights!;
  const body=appendReportingDisclosure('A source-owned answer.\n\n'+form,'uk',disclosure,form);
  const hash=createHash('sha256').update(body).digest('hex'),formHash=createHash('sha256').update(form).digest('hex');
  const metadata={engagementProbe:{contractVersion:'engagement-1-10-v1',surveyDefinitionId:f.definitionId,surveyWindowId:f.windows.get(userId)!,questionId:question.id,questionVersion:question.version,stableKey:question.stableKey,displayedFormHash:hash,locale:'uk',resourceVersion:engagement.version,resourceSourceHash:engagement.sourceHash,formTextHash:formHash},reportingDisclosureVersion:'reporting-disclosure-v1',reportingDisclosureForm:{locale:'uk',version:disclosure.version,sourceHash:disclosure.sourceHash,textHash:createHash('sha256').update(rights).digest('hex'),fullBodyHash:hash}};
  const saved=await s.conversation.saveMessage({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',text:body,metadata});
  expect(body.endsWith(form)).toBe(true);expect(body.indexOf(rights)).toBeLessThan(body.indexOf(form));
  const [stored]=await s.raw`select text from messages where id=${saved.id}`;expect(stored.text).toBe(body);
  await s.db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,saved.id));
  const [delivered]=await s.db.select().from(schema.messages).where(eq(schema.messages.id,saved.id));
  expect(delivered.engagementDeliveryProof).toMatchObject({actualFormHash:hash,displayedFormHash:hash,formTextHash:formHash,locale:'uk'});
  expect(delivered.metadata).toMatchObject(metadata);
  const answer=await s.inbound(f,userId,'7');expect(await s.capture.capture(answer)).toMatchObject({status:'accepted'});await s.commit(answer);
  await expect(s.db.update(schema.messages).set({text:body+' edited'}).where(eq(schema.messages.id,saved.id))).rejects.toThrow();
  for(const invalid of [body+' unauthorized suffix',body.replace(form,form+' altered')]) await expect(s.conversation.saveMessage({tenantId:f.tenantId,userId,conversationId:saved.conversationId,direction:'outbound',text:invalid,metadata:{engagementProbe:metadata.engagementProbe}})).rejects.toThrow('engagement_form_resource_unavailable');
 });
 it.each(['ordinary','proactive'] as const)('R1 actual %s use case persists the localized approved probe through its existing disclosure gate',async path=>{
  const f=await s.fixture(1),userId=f.users[0]!,engagement=await prepare('uk','engagement'),disclosure=await prepare('uk','disclosure'),operational=await prepare('uk','operational');
  const rights=disclosure.texts.rights!,hash=createHash('sha256').update(rights).digest('hex');
  const first=await s.conversation.saveMessage({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',text:rights,metadata:{reportingDisclosureVersion:'reporting-disclosure-v1',reportingDisclosureForm:{locale:'uk',version:disclosure.version,sourceHash:disclosure.sourceHash,textHash:hash,fullBodyHash:hash}}});
  await s.db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,first.id));
  const run=await runLocalizedProbe(s,f,{responseLanguage:'uk',source:'saved_explicit',resourceStatus:'ready',resources:{engagement,disclosure,operational}},path);
  const [saved]=await s.db.select().from(schema.messages).where(eq(schema.messages.id,run.result.outboundMessageId));
  expect(saved.text.endsWith(engagement.texts[run.question.stableKey]!)).toBe(true);expect(saved.metadata).toMatchObject({engagementProbe:{locale:'uk',questionId:run.question.id,displayedFormHash:createHash('sha256').update(saved.text).digest('hex')}});expect(saved.metadata).not.toHaveProperty('reportingDisclosureForm');
  await s.db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,saved.id));
  expect((await s.db.select().from(schema.messages).where(eq(schema.messages.id,saved.id)))[0].engagementDeliveryProof).toMatchObject({locale:'uk',actualFormHash:createHash('sha256').update(saved.text).digest('hex')});
  expect(run.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);expect(run.ai.generateResponse).toHaveBeenCalledTimes(1);
 });
 it.each(['undecided','deferred'] as const)('R8 real substantive team-lead acknowledgment %s stays before the persisted exact form',async participation=>{
  const f=await s.fixture(1),userId=f.lead,engagement=await prepare('uk','engagement'),disclosure=await prepare('uk','disclosure'),operational=await prepare('uk','operational');
  const language={responseLanguage:'uk',source:'saved_explicit' as const,resourceStatus:'ready' as const,resources:{engagement,disclosure,operational}};
  await s.db.insert(schema.onboardingStates).values({tenantId:f.tenantId,personId:userId,track:'team_lead',introStatus:'delivered',participation,buttonsActive:false});
  const rights=disclosure.texts.rights!,hash=createHash('sha256').update(rights).digest('hex');
  const receipt=await s.conversation.saveMessage({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',text:rights,metadata:{reportingDisclosureVersion:'reporting-disclosure-v1',reportingDisclosureForm:{locale:'uk',version:disclosure.version,sourceHash:disclosure.sourceHash,textHash:hash,fullBodyHash:hash}}});
  await s.db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,receipt.id));
  const service=new OnboardingService(new OnboardingStateRepository(s.database),{resolveLanguage:async()=>language} as never),apply=vi.spyOn(service,'applyTurnEvent');
  let run:Awaited<ReturnType<typeof runLocalizedProbe>>|undefined,error:unknown;
  try{run=await runLocalizedProbe(s,f,language,'ordinary',{userId,onboardingTurn:service});}catch(caught){error=caught;}
  expect(apply).toHaveBeenCalledTimes(1);expect(apply.mock.calls[0]![2]).toMatchObject({type:'action',action:'got_it',source:'text'});
  const outcome=await apply.mock.results[0]!.value;expect(outcome).toMatchObject({changed:true,replyAck:operational.texts['ack.got_it_team_lead'],state:{participation:'active',track:'team_lead'}});
  expect(error).toBeUndefined();expect(run).toBeDefined();
  const [saved]=await s.db.select().from(schema.messages).where(eq(schema.messages.id,run!.result.outboundMessageId));
  const form=engagement.texts[run!.question.stableKey]!,ack=operational.texts['ack.got_it_team_lead']!;
  expect(saved.text).toContain(ack);expect(saved.text.indexOf(ack)).toBeLessThan(saved.text.indexOf(form));expect(saved.text.endsWith(form)).toBe(true);
  expect(saved.metadata).toMatchObject({engagementProbe:{locale:'uk',questionId:run!.question.id,displayedFormHash:createHash('sha256').update(saved.text).digest('hex')}});expect(saved.metadata).not.toHaveProperty('reportingDisclosureForm');
  await s.db.update(schema.messages).set({sentAt:new Date()}).where(eq(schema.messages.id,saved.id));
  expect((await s.db.select().from(schema.messages).where(eq(schema.messages.id,saved.id)))[0].engagementDeliveryProof).toMatchObject({locale:'uk',actualFormHash:createHash('sha256').update(saved.text).digest('hex')});
  expect((await s.db.select().from(schema.onboardingStates).where(eq(schema.onboardingStates.personId,userId)))[0].participation).toBe('active');expect(run!.ai.generateResponse).toHaveBeenCalledTimes(1);expect(run!.outbox.enqueueMessageSend).toHaveBeenCalledTimes(1);
 });
 it('R6 never resurrects an expired native source after its watermark and copies are deleted',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!;
  await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb((3.0/86400)::numeric)) where id=${f.tenantId}`;
  await addPulsePresentationTopics(s,f,userId);
  const [i]=await s.db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.tenantId,f.tenantId));
  const source=await renditions.loadPermittedSource(f.tenantId,i.id);expect(source).not.toBeNull();
  const record={source:source!,locale:'de',text:'Ein allgemeines Signal zum Arbeitserleben wurde erkannt.',policyVersion:PULSE_LANGUAGE_POLICY,modelId:'fixture',promptVersion:'fixture'};
  expect(await renditions.install(record)).toBe('installed');
  await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(730::numeric)) where id=${f.tenantId}`;
  const [wait]=await s.raw`select greatest(0,extract(epoch from (expires_at-clock_timestamp()))*1000)::float8 ms from survey_report_topic_watermarks where insight_id=${i.id}`;
  await new Promise(resolve=>setTimeout(resolve,Number(wait.ms)+50));
  expect(await renditions.loadPermittedSource(f.tenantId,i.id)).toBeNull();
  await s.raw`delete from survey_report_topic_watermarks where insight_id=${i.id}`;
  expect((await s.raw`select count(*)::int n from pulse_analytical_renditions where analytical_id=${i.id}`)[0].n).toBe(0);
  expect(await renditions.loadPermittedSource(f.tenantId,i.id)).toBeNull();
  expect(await renditions.read(f.tenantId,i.id,'de')).toBeNull();expect(await renditions.install(record)).toBe('stale');
  const translate=vi.fn();expect(await new PrepareAnalyticalRenditionUseCase(renditions,{translate,reviewTranslation:vi.fn()}).execute({tenantId:f.tenantId,analyticalId:i.id,locale:'de'})).toBe('stale');expect(translate).not.toHaveBeenCalled();
  expect((await s.db.select().from(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.id,i.id)))[0].score).toBe(i.score);
 });
 it('R6 permits explicitly approved legacy authority and denies unknown sources without native absence guessing',async()=>{
  const h=await prepared();
  const [legacyTeam]=await s.db.insert(schema.teams).values({tenantId:h.f.tenantId,name:'Explicit legacy fixture team'}).returning();
  await s.db.insert(schema.teamMemberships).values({teamId:legacyTeam.id,userId:h.userId});
  for(const [version,legacyOpening] of [['v2-policy-1.0.0',true],['v2-policy-1.0.0',false],['unknown-fixture',false]] as const){
   const [definition]=await s.db.insert(schema.surveyDefinitions).values({tenantId:h.f.tenantId,name:'Legacy fixture '+version,version,active:true}).returning();
   const [question]=await s.db.insert(schema.surveyQuestions).values({surveyDefinitionId:definition.id,stableKey:'legacy_fixture',title:'Legacy fixture',canonicalMeaning:'Legacy fixture meaning',dimension:'autonomy',questionGroup:'autonomy',version:'1'}).returning();
   const [window]=await s.db.insert(schema.surveyWindows).values({tenantId:h.f.tenantId,userId:h.userId,surveyDefinitionId:definition.id,status:'closed',periodStart:new Date(Date.now()-1000),periodEnd:new Date(Date.now()+86400000)}).returning();
   await s.db.insert(schema.surveyWindowScoringPolicies).values({surveyWindowId:window.id,tenantId:h.f.tenantId,scoringPolicyId:h.f.policy.id});
   if(legacyOpening)await s.survey.openReportingCycle({tenantId:h.f.tenantId,surveyDefinitionId:definition.id,periodStart:window.periodStart,periodEnd:window.periodEnd,openedAt:new Date()});
   const original={...h.i,id:undefined};
   const [insight]=await s.db.insert(schema.surveyQuestionInsights).values({...original,surveyWindowId:window.id,surveyDefinitionId:definition.id,surveyQuestionId:question.id,questionVersion:'1',workingInsightId:null}).returning();
   const [authority]=await s.db.select().from(schema.pulseAnalyticalSourceAuthorities).where(eq(schema.pulseAnalyticalSourceAuthorities.analyticalId,insight.id));
   expect(authority.sourceKind).toBe(legacyOpening?'approved_legacy':'unknown');
   const source=await renditions.loadPermittedSource(h.f.tenantId,insight.id);
   if(legacyOpening)expect(source).toMatchObject({summary:insight.deidentifiedSummary});else expect(source).toBeNull();
  }
 });
 it('R6 dependency cleanup cannot erase a closed native authority, restore expiry or break source cascades',async()=>{
  const h=await prepared();
  await expect(s.raw`delete from survey_report_insight_revisions where insight_id=${h.i.id}`).rejects.toThrow('pulse_report_revision_metadata_immutable');
  await s.raw`delete from survey_report_topic_watermarks where insight_id=${h.i.id}`;
  const [authority]=await s.db.select().from(schema.pulseAnalyticalSourceAuthorities).where(eq(schema.pulseAnalyticalSourceAuthorities.analyticalId,h.i.id));expect(authority).toMatchObject({sourceKind:'native',dependencyLostAt:expect.any(Date)});
  await expect(s.db.update(schema.pulseAnalyticalSourceAuthorities).set({sourceKind:'approved_legacy',dependencyLostAt:null}).where(eq(schema.pulseAnalyticalSourceAuthorities.analyticalId,h.i.id))).rejects.toThrow('language_source_authority_immutable');
  expect(await renditions.install(h.record)).toBe('stale');
  await s.db.delete(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.id,h.i.id));
  expect(await s.db.select().from(schema.pulseAnalyticalSourceAuthorities).where(eq(schema.pulseAnalyticalSourceAuthorities.analyticalId,h.i.id))).toEqual([]);
 });
 it('scopes safe copies to source/tenant and never extends effective current retention',async()=>{
  const h=await prepared();expect(await renditions.read(randomUUID(),h.i.id,'de')).toBeNull();
  expect((await renditions.read(h.f.tenantId,h.i.id,'de'))?.source.sourceHash).toBe(h.record.source.sourceHash);
  await s.raw`update tenants set retention_policy=jsonb_set(retention_policy,'{memoryRetentionDays}',to_jsonb(0.000000001::numeric)) where id=${h.f.tenantId}`;
  expect(await renditions.read(h.f.tenantId,h.i.id,'de')).toBeNull();expect((await s.raw`select count(*)::int n from pulse_analytical_renditions where analytical_id=${h.i.id}`)[0].n).toBe(0);
 });
 it.each(['full','partial','source_delete','subject_delete','hard_subject_delete'] as const)('erases restricted text for %s before provenance disappears',async(kind)=>{
  const h=await prepared();
  if(kind==='source_delete')await s.db.delete(schema.surveyQuestionInsights).where(eq(schema.surveyQuestionInsights.id,h.i.id));
  else if(kind==='hard_subject_delete'){await s.db.delete(schema.orgEmployeePlacements).where(eq(schema.orgEmployeePlacements.employeePersonId,h.userId));await s.db.delete(schema.users).where(eq(schema.users.id,h.userId));}
  else if(kind==='subject_delete')await s.db.update(schema.users).set({status:'deleted',deletedAt:new Date()}).where(eq(schema.users.id,h.userId));
  else {const [revision]=await s.raw`select lineage_id from survey_report_insight_revisions where insight_id=${h.i.id}`;await new ReportingPermissionRepository(s.database).withdraw({tenantId:h.f.tenantId,userId:h.userId,personId:h.userId,requestId:randomUUID(),target:kind==='full'?{kind:'full_reporting'}:{kind:'partial_reporting',lineageIds:[revision.lineage_id]},provenance:{kind:'verified_subject',tenantId:h.f.tenantId,userId:h.userId,personId:h.userId,verificationId:randomUUID(),receivedAt:new Date()}});}
  expect(await renditions.read(h.f.tenantId,h.i.id,'de')).toBeNull();expect((await s.raw`select count(*)::int n from pulse_analytical_renditions where analytical_id=${h.i.id}`)[0].n).toBe(0);expect(await renditions.install(h.record)).toBe('stale');
 });
 it('binds translated numeric capture to immutable actual form after personal language changes, preserving legacy English receipts',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!,q=f.questions.find(q=>q.stableKey==='engagement_current')!;
  const texts={engagement_nps:'Auf einer Skala von 1 bis 10, wobei 1 überhaupt nicht wahrscheinlich und 10 äußerst wahrscheinlich bedeutet: Wie wahrscheinlich empfiehlst du dieses Unternehmen als Arbeitsplatz? Bitte antworte mit einer ganzen Zahl.',engagement_motivation:'Auf einer Skala von 1 bis 10, wobei 1 nie und 10 immer bedeutet: Wie oft bist du motiviert, bei der Arbeit dein Bestes zu geben? Bitte antworte mit einer ganzen Zahl.',engagement_current:'Auf einer Skala von 1 bis 10, wobei 1 überhaupt nicht engagiert und 10 vollständig engagiert bedeutet: Wie engagiert fühlst du dich gerade bei deiner Arbeit? Bitte antworte mit einer ganzen Zahl.'};
  const resource=await new PreparePulseLanguageUseCase(resources,{modelId:'fake-only',generate:async()=>texts,review:async()=>({semanticPass:true,modelId:'fake-only-review',promptVersion:'fixture'})}).execute({locale:'de',kind:'engagement',source:PULSE_ENGLISH_RESOURCES.engagement});
  const text=texts.engagement_current,hash=createHash('sha256').update(text).digest('hex');
  const [prompt]=await s.db.insert(schema.messages).values({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',senderType:'agent',text,occurredAt:new Date(),sentAt:new Date(),metadata:{engagementProbe:{contractVersion:'engagement-1-10-v1',surveyDefinitionId:f.definitionId,surveyWindowId:f.windows.get(userId),questionId:q.id,questionVersion:q.version,stableKey:q.stableKey,displayedFormHash:hash,locale:'de',resourceVersion:resource.version,resourceSourceHash:resource.sourceHash,formTextHash:hash}}}).returning();
  await s.db.update(schema.users).set({communicationPreferences:{pulseLanguage:{locale:'uk',kind:'explicit'}}}).where(eq(schema.users.id,userId));
  const source=await s.inbound(f,userId,'7');expect(await s.capture.capture(source)).toMatchObject({status:'accepted'});
  const [answer]=await s.db.select().from(schema.surveyEngagementAnswerRevisions).where(eq(schema.surveyEngagementAnswerRevisions.inboundReceiptId,source.inboundMessageId));expect(Number(answer.value)).toBe(7);expect(answer.displayedFormHash).toBe(hash);await s.commit(source);
  await expect(s.db.update(schema.messages).set({text:'Changed form'}).where(eq(schema.messages.id,prompt.id))).rejects.toThrow();
  const legacy=await s.numeric(f,userId,0,'8');const [legacyAnswer]=await s.db.select().from(schema.surveyEngagementAnswerRevisions).where(eq(schema.surveyEngagementAnswerRevisions.inboundReceiptId,legacy.inboundMessageId));expect(Number(legacyAnswer.value)).toBe(8);
 });
 it('never advances durable preference from an unverified explicit receipt clock',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!;const prior=await s.inbound(f,userId,'Please use Ukrainian.');await s.conversation.resolvePersonalLanguage({...prior,proposal:{locale:'uk',kind:'explicit'}});
  const [before]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));
  const [m]=await s.db.insert(schema.messages).values({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'inbound',senderType:'user',text:'Please use German.',occurredAt:new Date(),receivedAt:new Date()}).returning();expect(m.receiptTrust).toBe('unverified_explicit_receipt');
  await s.conversation.resolvePersonalLanguage({tenantId:f.tenantId,userId,inboundMessageId:m.id,proposal:{locale:'de',kind:'explicit'}});
  const [after]=await s.db.select().from(schema.users).where(eq(schema.users.id,userId));expect(after.communicationPreferences).toEqual(before.communicationPreferences);expect(after.locale).toBe(before.locale);
 });
 it('hard tenant erasure closes restricted source copies and tenant-scoped definition resources',async()=>{const h=await prepared();await s.db.delete(schema.tenants).where(eq(schema.tenants.id,h.f.tenantId));expect((await s.raw`select count(*)::int n from pulse_analytical_renditions where tenant_id=${h.f.tenantId}`)[0].n).toBe(0);});

 it('validates actual disclosure form hashes and immutable delivered bytes while keeping legacy receipt compatibility',async()=>{
  const f=await s.fixture(1),userId=f.users[0]!,resource=await resources.read('de','disclosure');expect(resource).not.toBeNull();
  const text=resource!.texts.rights!,hash=createHash('sha256').update(text).digest('hex');
  const [prompt]=await s.db.insert(schema.messages).values({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',senderType:'agent',text,occurredAt:new Date(),sentAt:new Date(),metadata:{reportingDisclosureVersion:'reporting-disclosure-v1',reportingDisclosureForm:{locale:'de',version:resource!.version,sourceHash:resource!.sourceHash,textHash:hash,fullBodyHash:hash}}}).returning();
  expect(await s.conversation.findLatestDeliveredReportingDisclosure(f.tenantId,userId,'reporting-disclosure-v1',new Date(Date.now()+1000))).toMatchObject({version:'reporting-disclosure-v1'});
  await expect(s.db.update(schema.messages).set({text:'Changed disclosure'}).where(eq(schema.messages.id,prompt.id))).rejects.toThrow('disclosure_delivered_form_immutable');
  await expect(s.db.insert(schema.messages).values({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',senderType:'agent',text:'Unreviewed form',occurredAt:new Date(),sentAt:new Date(),metadata:{reportingDisclosureForm:{locale:'ja',version:PULSE_COPY_VERSION,sourceHash:'0'.repeat(64),textHash:hash,fullBodyHash:hash}}})).rejects.toThrow('disclosure_form_resource_unavailable');
  const legacyText=PULSE_ENGLISH_RESOURCES.disclosure.rights!;await s.db.insert(schema.messages).values({tenantId:f.tenantId,userId,conversationId:f.conversations.get(userId)!,direction:'outbound',senderType:'agent',text:legacyText,occurredAt:new Date(),sentAt:new Date(),metadata:{reportingDisclosureVersion:'reporting-disclosure-v1'}});
  expect(await s.conversation.findLatestDeliveredReportingDisclosure(f.tenantId,userId,'reporting-disclosure-v1',new Date(Date.now()+1000))).not.toBeNull();
 });
 it('keeps accepted custom definition labels scoped to the exact tenant and source hash',async()=>{
  const f=await s.fixture(1),key='title.'+createHash('sha256').update('custom'+'\0'+'Custom source title').digest('hex');
  const prepared=await new PreparePulseLanguageUseCase(resources,{modelId:'fake-only',generate:async()=>({[key]:'Benutzerdefinierter Titel'}),review:async()=>({semanticPass:true,modelId:'fake-only',promptVersion:'fixture'})}).execute({tenantId:f.tenantId,locale:'de',kind:'definitions',source:{[key]:'Custom source title'}});
  expect(await resources.read('de','definitions',randomUUID())).toBeNull();expect((await resources.read('de','definitions',f.tenantId))?.sourceHash).toBe(prepared.sourceHash);
  const {definitionDisplay}=await import('../../../../apps/api/src/admin/company-language-read.service');
  expect(definitionDisplay({locale:'de',resourceVersion:PULSE_COPY_VERSION,status:'ready',resources:{definitions:prepared}},'custom','Custom source title')).toMatchObject({status:'ready',text:'Benutzerdefinierter Titel'});
  expect(definitionDisplay({locale:'de',resourceVersion:PULSE_COPY_VERSION,status:'ready',resources:{definitions:prepared}},'custom','Changed title')).toMatchObject({status:'language_unavailable',text:null});
 });

});
