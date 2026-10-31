import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PulseReportPresentationSchema,type PulseReportPresentation } from '../packages/contracts/src/pulse-report-presentation';
import { renderPulseReportForSlack,type PulseReportBlock } from '../packages/channel-slack/src/pulse-report-renderer';
import { pulsePublicationHash } from '../packages/database/src/pulse-report-publication-state';
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const slackEscape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const literal=(block:PulseReportBlock)=>block.type==='header'?block.text.text:block.type==='rich_text'?block.elements.flatMap(element=>element.elements.map(leaf=>leaf.text)).join(''):'';
const normalized=(value:string)=>value.replace(/\s+/gu,'');
export function exportAcceptancePreviews(input:unknown,sourceHash:string,out:string){
 const source=input as {synthetic?:boolean;sourceHash?:string;companyLocale?:string;personalLocales?:string[];snapshots?:Record<string,unknown>[]};
 if(source.synthetic!==true||source.sourceHash!==sourceHash||!Array.isArray(source.snapshots)||!source.companyLocale||!Array.isArray(source.personalLocales)||!source.personalLocales.length||source.personalLocales.some(locale=>typeof locale!=='string'||!locale))throw Error('preview_source_binding_invalid');
 mkdirSync(out,{recursive:true,mode:0o700});
 const variants=new Set<string>(),manifest=[];
 let notice=false,multipart=false,longUnicode=false;
 for(const snapshot of source.snapshots){
  const presentation=PulseReportPresentationSchema.parse(snapshot.presentation);
  if(presentation.locale!==source.companyLocale)throw Error('preview_company_locale_mismatch');
  const rendered=renderPulseReportForSlack(presentation as PulseReportPresentation);
  if(pulsePublicationHash(rendered.manifest)!==pulsePublicationHash(snapshot.manifest)||pulsePublicationHash(rendered.parts)!==pulsePublicationHash(snapshot.storedParts))throw Error('preview_not_actual_frozen_parts');
  if(pulsePublicationHash({contracts:snapshot.contracts,presentation,provenance:snapshot.provenance,manifest:snapshot.manifest,parts:snapshot.storedParts,route:snapshot.route})!==snapshot.artifact_hash)throw Error('preview_artifact_hash_mismatch');
  variants.add(presentation.variant);notice ||=presentation.sections[0]?.status==='insufficient_data';multipart ||=rendered.parts.length>1;
  const visible=rendered.parts.flatMap(part=>part.blocks.map(literal)).filter(Boolean).join('\n');
  const expected=rendered.manifest.sections.flatMap(section=>section.contentIds).sort();
  const observed=rendered.manifest.parts.flatMap(part=>part.contentIds).sort();
  if(JSON.stringify(expected)!==JSON.stringify(observed)||new Set(observed).size!==observed.length)throw Error('preview_content_inventory_incomplete');
  for(const section of presentation.sections){
   if(!(presentation.purpose==='final'&&presentation.sections[0]?.status==='insufficient_data')&&!normalized(visible).includes(normalized(section.label)))throw Error('preview_scope_label_truncated');
   if(section.status!=='eligible')continue;
   const content=[...section.narrative.explanation,...section.narrative.actions.flatMap(action=>[action.title,action.detail]),...(section.narrative.focus.kind==='problem'?[section.narrative.focus.text]:[])];
   longUnicode ||=content.some(text=>text.length>=600&&Array.from(text).some(char=>char.codePointAt(0)!>127));
   if(content.some(text=>!normalized(visible).includes(normalized(text))))throw Error('preview_narrative_truncated');
   if(presentation.variant==='team_lead_intermediate'&&content.some(text=>/\d/u.test(text)))throw Error('preview_tl_numeric_prose');
  }
  for(const [index,part]of rendered.parts.entries()){
   const leafText=part.blocks.map(literal).filter(Boolean).join('\n'),partManifest=rendered.manifest.parts[index]!;
   if(!part.text||part.text!==slackEscape(leafText)||part.text.length>4000||part.blocks.length>50)throw Error('preview_literal_fallback_or_limit_invalid');
   if(partManifest.ordinal!==index+1||partManifest.total!==rendered.parts.length)throw Error('preview_continuation_identity_invalid');
   if(/"(?:tenantId|candidateId|userId|sourceMessageIds|authorizationToken)"\s*:/u.test(JSON.stringify(part)))throw Error('preview_restricted_identity');
   const file:string='snapshot-'+(manifest.length+1)+'.html';
   const html='<!doctype html><html lang="'+escape(presentation.locale)+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Synthetic report preview</title><style>body{font:16px system-ui;background:#f6f6f4;color:#181818;margin:24px}main{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap}article{box-sizing:border-box;background:white;padding:20px;border:1px solid #ddd;white-space:pre-wrap;overflow-wrap:anywhere;flex:none}h1{font-size:18px}p{font-size:14px}</style><h1>Synthetic Slack payload preview</h1><p>Local literal-content preview. Native Slack desktop, mobile and accessibility acceptance remain unrun.</p><main>'+[720,375].map(width=>'<article style="width:'+width+'px;min-width:'+width+'px;max-width:'+width+'px" aria-label="'+width+' pixel preview">'+escape(leafText)+'</article>').join('')+'</main></html>';
   writeFileSync(join(out,file),html,{mode:0o600});writeFileSync(join(out,file.replace('.html','.json')),JSON.stringify(part,null,2),{mode:0o600});
   manifest.push({variant:presentation.variant,companyLocale:presentation.locale,personalLocales:source.personalLocales,ordinal:index+1,count:rendered.parts.length,bodyHash:pulsePublicationHash(part),fallbackHash:hash(part.text),htmlHash:hash(html),file});
  }
 }
 if(variants.size!==4||!notice||!multipart||!longUnicode)throw Error('preview_required_variants_notice_multipart_missing');
 const result={schemaVersion:'pulse-preview-v1',sourceHash,synthetic:true,variants:[...variants].sort(),companyLocale:source.companyLocale,personalLocales:source.personalLocales,notice,multipart,longUnicode,nativeClients:'not_run',parts:manifest};
 writeFileSync(join(out,'manifest.json'),JSON.stringify(result,null,2),{mode:0o600});return result;
}
