import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PULSE_SOURCE_ADMIN,PULSE_COPY_VERSION,type PulseLanguageReadMetadata} from '@entalent/contracts';
import {companyCopy,CompanyLanguageProvider,CompanyText,CompanyDate,CompanyPlural} from './company-language';
import DashboardPage from './page';
import PulsePage from './pulse/page';
import UserInsightsPage from './pulse/[userId]/page';
import CyclesPage from './cycles/page';
import CyclePage from './cycles/[cohortId]/page';
const cohortId='9b5d3697-229c-4243-9481-bd6f1456faec';
const original='Точний приватний текст працівника <без перекладу>';
const fixture=vi.hoisted(()=>({language:null as unknown,people:null as unknown,status:null as unknown,hierarchy:null as unknown,signals:[] as unknown[]}));
vi.mock('./lib',()=>({TENANT_ID:'private-fixture',qaPrivateViewEnabled:()=>true,fetchAdminTeamHierarchy:async()=>fixture.hierarchy,fetchAdminV2Pilot:async()=>fixture.status,fetchAdminV2PilotPeople:async()=>fixture.people,fetchAdminV2PilotQaTeamSignals:async()=>({...(fixture.people as object),signals:fixture.signals}),fetchAdminV2PilotCycle:async()=>({checkedAt:'2026-10-29T12:00:00Z',cycle:(fixture.status as {cycles:unknown[]}).cycles[0]})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('unexpected notfound')}}));
function language(locale:string):PulseLanguageReadMetadata {
 const texts=Object.fromEntries(Object.entries(PULSE_SOURCE_ADMIN).map(([k,v])=>[k,locale==='en'?v:(locale==='de'?'Geprüfter Testtext':'Перевірений тестовий текст')+': '+k+' '+[...v.matchAll(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g)].map(m=>m[0]).join(' ')]));
 return {locale,resourceVersion:PULSE_COPY_VERSION,status:'ready',resources:{admin:{locale,kind:'admin',version:PULSE_COPY_VERSION,sourceHash:'0'.repeat(64),textHash:'1'.repeat(64),texts,status:'accepted',provenance:{generator:'fake-only',reviewer:'fake-only',promptVersion:'fixture',semanticPass:true}}}};
}
function seed(l:PulseLanguageReadMetadata){
 fixture.signals=[];
 const envelope={cohortId,periodStart:'2026-10-20T08:00:00Z',periodEnd:'2026-11-03T17:00:00Z',state:'active',checkedAt:'2026-10-29T12:00:00Z',companyLanguage:l};
 fixture.people={...envelope,people:[{userId:'u1',displayName:'Олена Незмінна',inbound:2,lastInboundAt:'2026-10-29T10:00:00Z',questions:[{stableKey:'autonomy_control_work',title:'Original canonical title',titleDisplay:{status:'language_unavailable',locale:l.locale,text:null,sourceHash:'h'},group:'autonomy',status:'collecting',ready:false,workingSummary:original,finalSummary:null,outcome:null,score:null}]}]};
 fixture.status={checkedAt:envelope.checkedAt,companyLanguage:l,cycles:[{...envelope,definitionVersion:'v2',scoringPolicyVersion:'v1',rosterSize:5,participants:1,inbound:2,processed:2,autonomyScoredParticipants:0,managerTargetConfigured:false,readyMeanings:1,completeGroups:0,deliveredBundles:0,sentReports:0,questions:[]}]};
 fixture.hierarchy={units:[{id:'unit',name:'Назва підрозділу',manager:null,teams:[],directMembers:[{id:'u1',displayName:'Олена Незмінна',role:'employee'}]}],unplaced:[],source:'org'};
}
describe('company copy plumbing fixtures (not multilingual semantic acceptance)',()=>{
 it.each(['en','de','uk'])('renders every active route with explicit %s resources, keeping private originals and names verbatim',async locale=>{
  const l=language(locale);seed(l);
  const pages=[await DashboardPage(),await PulsePage({searchParams:Promise.resolve({})}),await UserInsightsPage({params:Promise.resolve({userId:'u1'})}),await CyclesPage(),await CyclePage({params:Promise.resolve({cohortId})})];
  for(const page of pages){const html=renderToStaticMarkup(createElement(CompanyLanguageProvider,{language:l},page));expect(html).not.toContain('data-copy-key="setup.');expect(html).not.toContain('ADMIN_API_KEY');expect(html).not.toMatch(/>ui\.\d+</);expect(html).toContain(companyCopy(l,'ui.016'));}
  const personal=renderToStaticMarkup(createElement(CompanyLanguageProvider,{language:l},pages[2]));expect(personal).toContain('Олена Незмінна');expect(personal).toContain('Точний приватний текст працівника &lt;без перекладу&gt;');expect(personal).not.toContain('Original canonical title');
 });
 it.each(['en','de','uk'])('R7 shows actual TeamSignal pending/unavailable copy in %s without changing score or provenance',async locale=>{
  const l=language(locale);seed(l);
  for(const status of ['translation_pending','language_unavailable'] as const){
   const signal={stableKey:'autonomy_control_work',title:'Unchanged title',group:'autonomy',summary:'',display:{status,text:null,locale,sourceLocale:'fr'},outcome:'scored',score:63,direction:'favorable',severity:'low',rootCause:'autonomy',author:{userId:'u1',displayName:'Original Author'}};
   fixture.signals=[signal];const before=JSON.stringify(signal);
   const page=await PulsePage({searchParams:Promise.resolve({})});
   const html=renderToStaticMarkup(createElement(CompanyLanguageProvider,{language:l},page));
   expect(html).toContain(companyCopy(l,status==='translation_pending'?'ui.translation_pending':'ui.language_unavailable'));
   expect(html).not.toContain('<blockquote></blockquote>');expect(html).toContain('63');expect(JSON.stringify(signal)).toBe(before);expect(signal.display.sourceLocale).toBe('fr');
  }
 });
 it('blocks an unavailable locale instead of presenting English as localized completion',()=>{const l={...language('ja'),status:'language_unavailable' as const,resources:{}};const html=renderToStaticMarkup(createElement(CompanyLanguageProvider,{language:l},createElement(CompanyText,{k:'ui.016'})));expect(html).toContain('language_unavailable');expect(html).toContain('Language unavailable: ja');expect(html).not.toContain('data-copy-key');});
 it('rejects missing keys/slots and displays escaped interpolation with locale dates/plurals',()=>{const l=language('en');expect(()=>companyCopy(l,'not-real')).toThrow();expect(()=>companyCopy(l,'ui.score')).toThrow();const html=renderToStaticMarkup(createElement(CompanyLanguageProvider,{language:l},createElement(CompanyText,{k:'ui.legacy_home',values:{team:'<img>',manager:'<script>'}}),createElement(CompanyDate,{value:'bad'}),createElement(CompanyPlural,{count:2,singular:'ui.043',plural:'ui.045'})));expect(html).toContain('&lt;img&gt;');expect(html).not.toContain('<script>');expect(html).toContain('2 topics');});
});
