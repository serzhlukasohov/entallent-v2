import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { exportAcceptancePreviews } from './report-acceptance-preview';
import { renderPulseReportForSlack } from '../packages/channel-slack/src/pulse-report-renderer';
import { pulsePublicationHash } from '../packages/database/src/pulse-report-publication-state';
import { PULSE_ENGLISH_LABELS,PULSE_PRESENTATION_CONTRACT,PULSE_LABEL_VERSION,
  type PulseReportPresentation } from '../packages/contracts/src/pulse-report-presentation';

const sourceHash='a'.repeat(64),root=mkdtempSync(join(tmpdir(),'rpt08-preview-'));
let attempt=0;
function freeze(presentation:PulseReportPresentation){
 const rendered=renderPulseReportForSlack(presentation),contracts={},provenance={},route={};
 return {presentation,contracts,provenance,route,manifest:rendered.manifest,storedParts:rendered.parts,
  artifact_hash:pulsePublicationHash({contracts,presentation,provenance,route,manifest:rendered.manifest,parts:rendered.parts})};
}
function source(){
 const snapshots=[];
 for(const audience of ['team_lead','manager'] as const)for(const purpose of ['intermediate','final'] as const){
  const narrative={explanation:['Beschäftigte erklären ihre Arbeitsweisen und Zuständigkeiten im Team. '.repeat(12)],focus:{kind:'none_supported' as const},actions:[{actionKey:'sAaA',title:'Arbeitsweisen besprechen',detail:'Die bestehenden Zuständigkeiten gemeinsam prüfen.'}]};
  const section={sectionKey:'sA',label:'Synthetisches Team 👩🏽‍💻 <literal> & vollständig',status:'eligible' as const,
   metric:purpose==='final'?{kind:'engagement' as const,value:'8.0',direction:'stable' as const,compositionChanged:false}
    :audience==='manager'?{kind:'index' as const,indexKey:'autonomy' as const,value:'70.0',direction:'stable' as const,compositionChanged:false}
    :{kind:'index_category' as const,indexKey:'autonomy' as const,category:'healthy' as const,direction:'stable' as const,compositionChanged:false},narrative};
  const presentation={contract:PULSE_PRESENTATION_CONTRACT,variant:audience+'_'+purpose,audience,purpose,
   ...(purpose==='intermediate'?{indexKey:'autonomy'}:{}),locale:'de',period:'October 2026',labels:PULSE_ENGLISH_LABELS,
   labelVersion:PULSE_LABEL_VERSION,labelHash:createHash('sha256').update(JSON.stringify(PULSE_ENGLISH_LABELS)).digest('hex'),
   sections:audience==='manager'?[section,{...section,sectionKey:'sB',label:'Weiteres synthetisches Team',narrative:{...narrative,actions:[]}}]:[section]} as PulseReportPresentation;
  snapshots.push(freeze(presentation));
 }
 const notice={...snapshots[3]!.presentation,sections:[{sectionKey:'sA',label:'Synthetisches Team',status:'insufficient_data'}]} as PulseReportPresentation;
 snapshots.push(freeze(notice));return {synthetic:true,sourceHash,companyLocale:'de',personalLocales:['uk'],snapshots};
}
function run(input:unknown){return exportAcceptancePreviews(input,sourceHash,join(root,String(++attempt)));}
try{
 const valid=source(),result=run(valid);
 assert.equal(result.variants.length,4);assert.equal(result.notice,true);assert.equal(result.multipart,true);assert.equal(result.longUnicode,true);
 assert.equal(result.nativeClients,'not_run');assert.deepEqual(result.personalLocales,['uk']);
 const html=readFileSync(join(root,String(attempt),result.parts[0]!.file),'utf8');
 assert.ok(html.includes('width:720px'));assert.ok(html.includes('width:375px'));assert.ok(html.includes('👩🏽‍💻'));assert.ok(html.includes('&lt;literal&gt;'));assert.ok(!html.includes('&amp;lt;literal'));
 assert.throws(()=>run({...valid,sourceHash:'b'.repeat(64)}),/source_binding/);
 assert.throws(()=>run({...valid,companyLocale:'uk'}),/locale_mismatch/);
 assert.throws(()=>run({...valid,snapshots:[]}),/required_variants/);
 const truncated=structuredClone(source());Object.assign(truncated.snapshots[0]!.storedParts[0]!,{text:truncated.snapshots[0]!.storedParts[0]!.text+' truncated'});
 assert.throws(()=>run(truncated),/frozen_parts/);
 const numeric=source(),tl=structuredClone(numeric.snapshots[0]!.presentation);
 if(tl.sections[0]!.status!=='eligible')throw Error('fixture_not_eligible');
 tl.sections[0]!.narrative.explanation=['A numeric Index of 70 was inserted.'];
 assert.throws(()=>{numeric.snapshots[0]=freeze(tl);run(numeric);},/narrative_invalid|tl_numeric_prose/);
 const short=source();short.snapshots=short.snapshots.map(snapshot=>{
  const p=structuredClone(snapshot.presentation);for(const section of p.sections)if(section.status==='eligible')section.narrative.explanation=['Kurzer synthetischer Text.'];return freeze(p);
 });assert.throws(()=>run(short),/required_variants/);
 console.log('report acceptance preview literal, width, locale and negative checks passed');
}finally{rmSync(root,{recursive:true,force:true});}
