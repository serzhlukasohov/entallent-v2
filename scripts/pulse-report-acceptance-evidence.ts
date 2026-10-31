import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS, type PulseAcceptanceAssertion } from '../packages/contracts/src/pulse-report-acceptance';

export const RPT08_REGRESSION_SELECTION = [
  { package: '@entalent/application', framework: 'vitest', files: [
    'src/use-cases/calculate-pulse-report-metrics.test.ts',
    'src/use-cases/pulse-report-inputs.test.ts',
    'src/use-cases/build-pulse-report.use-case.test.ts',
    'src/use-cases/finalize-question-insight.use-case.test.ts',
    'src/use-cases/select-question-insight-inputs.use-case.test.ts',
    'src/use-cases/resolve-pulse-report-final-schedule.test.ts',
    'src/use-cases/withdraw-reporting-permission.use-case.test.ts',
    'src/utils/question-readiness.test.ts',
    'src/use-cases/conversation-orchestrator.test.ts',
  ] },
  { package: '@entalent/channel-slack', framework: 'node:test', files: ['src/pulse-report-renderer.test.ts', 'src/pulse-report-transport.test.ts'] },
  { package: '@entalent/worker', framework: 'vitest', files: ['src/survey/pulse-report-slack-assembly.service.test.ts','src/survey/pulse-report-recovery.integration.test.ts','src/survey/repositories/question-insight.repository.capture.integration.test.ts','src/survey/repositories/question-insight.repository.bundle.integration.test.ts'] },
  { package: '@entalent/database', framework: 'vitest', files: [
    'src/__tests__/pulse-report-inputs.integration.test.ts',
    'src/__tests__/pulse-report-scopes.integration.test.ts',
    'src/__tests__/pulse-report-presentation.integration.test.ts',
    'src/__tests__/pulse-report-delivery.integration.test.ts',
    'src/__tests__/pulse-report-calendar.integration.test.ts',
    'src/__tests__/engagement-answers.integration.test.ts',
    'src/__tests__/pulse-language.integration.test.ts',
  ] },
] as const;

export type AcceptanceTestEvidence = { file: string; name: string; status: string; ordinal: number; testId: string };
type NativeCounts = { tests: number; passed: number; failed: number; cancelled: number; skipped: number; todo: number; suites: number; topLevel: number };
const nativeCountKeys=['tests','passed','failed','cancelled','skipped','todo','suites','topLevel'] as const;
type NativeSummary = { success: boolean; counts: NativeCounts };
type NativeTest = { file: string; name: string; status: string; ordinal: number };
type NativeReport = { schemaVersion: 'rpt08-node-test-report-v1'; framework: 'node:test'; summary: NativeSummary | null; fileSummaries: Array<NativeSummary & {file: string}>; tests: NativeTest[] };
type NativeEvent = { type: string; data: { name?: string; file?: string; testId?: number; parentId?: number; skip?: boolean | string; todo?: boolean | string; details?: {type?: string}; success?: boolean; counts?: NativeCounts } };
type ExpectedTests = { framework: 'vitest' | 'node:test'; files: readonly string[] };

export function nativeAcceptanceReporterModule(root: string) {
  return `const load=require('node:module').createRequire(${JSON.stringify(root+'/package.json')});load('tsx/cjs');module.exports=load(${JSON.stringify(root+'/scripts/pulse-report-acceptance-evidence.ts')}).default;\n`;
}

// The native reporter retains only terminal test metadata, never event errors or fixture output.
export default async function* nativeAcceptanceReporter(source: AsyncIterable<NativeEvent>) {
  const terminal: NativeEvent['data'][] = [], summaries: NativeReport['fileSummaries'] = [];
  let summary: NativeSummary | null = null, aggregateSummaries = 0;
  const completed: Array<{data: NativeEvent['data']; status: string}> = [];
  for await (const event of source) {
    const data=event.data;
    if (event.type === 'test:summary') {
      const counts=Object.fromEntries(nativeCountKeys.map(key=>[key,typeof data.counts?.[key]==='number'?data.counts[key]:-1])) as NativeCounts;
      const value={success:data.success === true,counts};
      if (data.file) summaries.push({...value,file:realpathSync(data.file).replaceAll('\\','/')});
      else { summary=value; aggregateSummaries++; }
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      terminal.push(data);
      if(data.details?.type === 'test') completed.push({data,status:
        data.skip === true || typeof data.skip === 'string' ? 'skipped' :
          data.todo === true || typeof data.todo === 'string' ? 'todo' : event.type === 'test:pass' ? 'passed' : 'failed'});
    }
  }
  const nodes=new Map(terminal.map(data=>[data.file+'\0'+data.testId,data]));
  const ordinals=new Map<string,number>();
  const tests=completed.map(({data,status})=>{
    const file=data.file ? realpathSync(data.file).replaceAll('\\','/') : '',names=[data.name ?? ''];
    let parent=data.parentId,depth=0;
    while(parent && depth++ < terminal.length){
      const ancestor=nodes.get(data.file+'\0'+parent);
      if(!ancestor) throw Error('acceptance_native_parent_missing');
      names.unshift(ancestor.name ?? '');parent=ancestor.parentId;
    }
    if(parent) throw Error('acceptance_native_parent_cycle');
    const ordinal=(ordinals.get(file) ?? 0)+1;ordinals.set(file,ordinal);
    return {file,name:names.join(' > '),status,ordinal};
  });
  if(aggregateSummaries!==1) throw Error('acceptance_native_terminal_summary_unsupported');
  const report: NativeReport={schemaVersion:'rpt08-node-test-report-v1',framework:'node:test',summary,fileSummaries:summaries,tests};
  yield JSON.stringify(report)+'\n';
}

function verifyExpectedTests(observed: AcceptanceTestEvidence[], framework: ExpectedTests['framework'], expected?: ExpectedTests) {
  if(expected){
    const actual=new Set(observed.map(test=>realpathSync(test.file).replaceAll('\\','/'))),files=new Set(expected.files.map(file=>realpathSync(file).replaceAll('\\','/')));
    if(expected.framework!==framework || files.size!==expected.files.length || actual.size!==files.size || [...actual].some(file=>!files.has(file)))
      throw Error('acceptance_unexpected_test_selection');
  }
  return observed;
}

function readNativeTestEvidence(report: NativeReport, expected?: ExpectedTests): AcceptanceTestEvidence[] {
  const exactKeys=(value:unknown,keys:readonly string[])=>value!==null && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && Object.keys(value).every(key=>keys.includes(key));
  const validSummary=(value: NativeSummary | null | undefined,file=false)=>exactKeys(value,file?['success','counts','file']:['success','counts']) && value?.success===true && exactKeys(value.counts,nativeCountKeys) &&
    nativeCountKeys.every(key=>Number.isInteger(value.counts[key])&&value.counts[key]>=0) && value.counts.tests>0 &&
    value.counts.passed===value.counts.tests && ['failed','cancelled','skipped','todo'].every(key=>value.counts[key as keyof NativeCounts]===0);
  if(!exactKeys(report,['schemaVersion','framework','summary','fileSummaries','tests']) || report.framework!=='node:test' || !validSummary(report.summary) || !Array.isArray(report.tests) || !report.tests.length || !Array.isArray(report.fileSummaries) || !report.fileSummaries.length)
    throw Error('acceptance_native_report_incomplete');
  const ordinals=new Map<string,number>(),identities=new Set<string>();
  const observed=report.tests.map(test=>{
    if(!exactKeys(test,['file','name','status','ordinal']) || typeof test.file!=='string' || !test.file || typeof test.name!=='string' || !test.name || test.status!=='passed') throw Error('acceptance_failed_or_skipped_assertion');
    if(realpathSync(test.file).replaceAll('\\','/')!==test.file)throw Error('acceptance_native_noncanonical_file');
    const ordinal=(ordinals.get(test.file)??0)+1;ordinals.set(test.file,ordinal);
    const identity=test.file+'\0'+test.name;
    if(test.ordinal!==ordinal || identities.has(identity)) throw Error('acceptance_native_duplicate_test');
    identities.add(identity);
    const projected={file:test.file,name:test.name,status:test.status,ordinal:test.ordinal};
    return {...projected,testId:acceptanceEvidenceHash(projected)};
  });
  const files=new Set<string>();
  for(const file of report.fileSummaries){
    if(typeof file.file!=='string' || !file.file || realpathSync(file.file).replaceAll('\\','/')!==file.file || files.has(file.file) || !validSummary(file,true) || ordinals.get(file.file)!==file.counts.tests)
      throw Error('acceptance_native_file_summary_mismatch');
    files.add(file.file);
  }
  if(files.size!==ordinals.size || observed.length!==report.summary!.counts.tests || report.fileSummaries.reduce((sum,file)=>sum+file.counts.tests,0)!==observed.length)
    throw Error('acceptance_test_inventory_mismatch');
  return verifyExpectedTests(observed,'node:test',expected);
}

export function readAcceptanceTestEvidence(path: string, expected?: ExpectedTests): AcceptanceTestEvidence[] {
  const raw=JSON.parse(readFileSync(path,'utf8'));
  if(raw.schemaVersion==='rpt08-node-test-report-v1') return readNativeTestEvidence(raw,expected);
  if(expected?.framework==='node:test') throw Error('acceptance_native_report_required');
  const report = raw as {
    success?: boolean; numTotalTests?: number; numPassedTests?: number; numFailedTests?: number; numPendingTests?: number;
    testResults?: Array<{ name?: string; status?: string; assertionResults?: Array<{ fullName?: string; status?: string }> }>;
  };
  if (report.success !== true || !report.numTotalTests || report.numPassedTests !== report.numTotalTests
    || report.numFailedTests !== 0 || report.numPendingTests !== 0 || !report.testResults?.length)
    throw Error('acceptance_test_report_incomplete');
  const observed = report.testResults.flatMap(suite => {
    if (suite.status !== 'passed' || !suite.name || !suite.assertionResults?.length) throw Error('acceptance_empty_or_failed_suite');
    if(realpathSync(suite.name).replaceAll('\\','/')!==suite.name)throw Error('acceptance_vitest_noncanonical_file');
    return suite.assertionResults.map((test,index) => {
      if (!test.fullName || test.status !== 'passed') throw Error('acceptance_failed_or_skipped_assertion');
      const identity={file:suite.name!.replaceAll('\\','/'),name:test.fullName,status:test.status,ordinal:index+1};
      return {...identity,testId:acceptanceEvidenceHash(identity)};
    });
  });
  if (observed.length !== report.numTotalTests || new Set(observed.map(t => t.file + '\0' + t.ordinal)).size !== observed.length)
    throw Error('acceptance_test_inventory_mismatch');
  return verifyExpectedTests(observed,'vitest',expected);
}

// These are test identities, not receipt-supplied success flags. Every companion must execute in this run.
export const RPT08_COMPANION_TESTS: Record<string, Array<[string, string]>> = {
  '01': [['pulse-report-inputs.integration.test.ts','actual positive prepare/history SQL spy'],['pulse-report-inputs.integration.test.ts','transitive frontier helper never read private'],['pulse-report-delivery.integration.test.ts','cross-tenant payload/support']],
  '02': [['question-readiness.test.ts','keeps a status without a driver not ready'],['question-readiness.test.ts','honours an explicit decline on the first refusal'],['question-insight.repository.capture.integration.test.ts','keeps a status without a driver open'],['question-insight.repository.capture.integration.test.ts','honours an explicit decline of the driver recorded without new meaning']],
  '03': [['finalize-question-insight.use-case.test.ts','employee never saw and confirmed'],['question-insight.repository.bundle.integration.test.ts','offers a corrected meaning that was not shown'],['conversation-orchestrator.test.ts','shows the corrected statement back after a clarified verdict']],
  '04': [['calculate-pulse-report-metrics.test.ts','averages exactly three Index scores'],['pulse-report-inputs.integration.test.ts','latest confirmed unscored state wins'],['pulse-report-inputs.integration.test.ts','post-cutoff confirmed correction cannot hide']],
  '05': [['pulse-report-scopes.integration.test.ts','12 overall/5 each'],['pulse-report-inputs.integration.test.ts','team own TL excluded']],
  '06': [['pulse-report-inputs.integration.test.ts','transferred/deactivated frozen subjects'],['pulse-report-scopes.integration.test.ts','retains original affiliation'],['pulse-report-scopes.integration.test.ts','preserves earliest stops']],
  '07': [['pulse-report-inputs.integration.test.ts', 'denominator changes from10 to8']],
  '08': [['pulse-report-scopes.integration.test.ts', 'excludes only the requested question']],
  '09': [['build-pulse-report.use-case.test.ts', 'final includes partial and unscored']],
  '10': [['finalize-question-insight.use-case.test.ts', 'categorical safe fallback']],
  '11': [['engagement-answers.integration.test.ts', 'rejects'], ['engagement-answers.integration.test.ts', 'real proactive producer']],
  '12': [['calculate-pulse-report-metrics.test.ts', 'classifies unrounded'], ['build-pulse-report.use-case.test.ts', 'team_lead intermediate']],
  '13': [['pulse-report-inputs.test.ts', 'raw nonzero comparison']],
  '14': [['pulse-report-inputs.test.ts', 'incompatible immediately previous']],
  '15': [['pulse-report-delivery.integration.test.ts', 'exact N=5/6/10 readiness']],
  '16': [['resolve-pulse-report-final-schedule.test.ts', 'Friday company close']],
  '17': [['pulse-report-inputs.integration.test.ts', 'late into the same cutoff']],
  '18': [['pulse-report-inputs.integration.test.ts', 'two incomplete native stages']],
  '19': [['pulse-report-delivery.integration.test.ts', 'five of one hundred']],
  '20': [['pulse-report-inputs.integration.test.ts', 'team own TL excluded']],
  '21': [['build-pulse-report.use-case.test.ts', 'overall survives every insufficient team']],
  '22': [['build-pulse-report.use-case.test.ts', 'unsupported coarse causes']],
  '23': [['build-pulse-report.use-case.test.ts', 'preserves 0 distinct'], ['build-pulse-report.use-case.test.ts', 'preserves 1 distinct'], ['build-pulse-report.use-case.test.ts', 'preserves 3 distinct']],
  '24': [['pulse-report-renderer.test.ts', 'team_lead intermediate literal']],
  '25': [['build-pulse-report.use-case.test.ts', 'team_lead final']],
  '26': [['pulse-report-renderer.test.ts', 'Manager grouping headings']],
  '27': [['build-pulse-report.use-case.test.ts', 'manager final']],
  '28': [['build-pulse-report.use-case.test.ts', 'German company and Ukrainian personal']],
  '29': [['pulse-report-renderer.test.ts', 'long Unicode paragraphs']],
  '30': [['pulse-report-slack-assembly.service.test.ts', 'post-render invalidation']],
  '31': [['pulse-report-delivery.integration.test.ts', 'write-ahead crash, duplicate grants, unknown report freeze'], ['pulse-report-delivery.integration.test.ts', 'provider acceptance followed by receipt rollback'], ['pulse-report-delivery.integration.test.ts', 'terminated-owner']],
  '32': [],
  '33': [['pulse-report-delivery.integration.test.ts', 'lawful soft and hard subject erasure']],
};

function companionTests(number: string, tests: AcceptanceTestEvidence[]) {
  return (RPT08_COMPANION_TESTS[number]??[]).flatMap(([file,phrase])=>{
    const matching=tests.filter(test=>test.file.endsWith('/'+file)&&test.name.toLowerCase().includes(phrase.toLowerCase()));
    if(!matching.length)throw Error('acceptance_companion_missing_'+number);
    if(matching.some(test=>test.status!=='passed'))throw Error('acceptance_companion_not_passed_'+number);
    return matching;
  });
}

export function verifyAcceptanceLowerCompanions(tests: AcceptanceTestEvidence[]) {
  return Object.keys(RPT08_COMPANION_TESTS).map(number=>({caseId:'RPT-AC-'+number,testIds:companionTests(number,tests).map(test=>test.testId)}));
}

export function registerAcceptanceAssertions(tests: AcceptanceTestEvidence[], evidenceHash: string): PulseAcceptanceAssertion[] {
  const main = tests.find(t => t.file.endsWith('/pulse-report-connected-acceptance.integration.test.ts')
    && t.name.includes('produces native shown confirmation'));
  const restart = tests.find(t => t.file.endsWith('/pulse-report-restart-acceptance.integration.test.ts')
    && t.name.includes('recovers lost dispatch hints for a committed turn'));
  const recovery=tests.find(t=>t.file.endsWith('/pulse-report-restart-acceptance.integration.test.ts')&&t.name.includes('recovers exhausted evidence'));
  const changed = tests.find(t => t.file.endsWith('/pulse-report-connected-acceptance.integration.test.ts')
    && t.name.includes('exactly one two three or four changed contributors'));
  if (!main || !restart || !recovery || !changed) throw Error('acceptance_connected_required_cases_missing');
  return PULSE_ACCEPTANCE_LOCAL_OBLIGATIONS.map(([number, id, phase]) => {
    const matches = phase==='P05'?[restart,recovery]:[number==='32'?changed:main];
    if(['07','08','17','18','31'].includes(number)&&!matches.includes(recovery))matches.push(recovery);
    if(number==='06'&&!matches.includes(main))matches.push(main);
    matches.push(...companionTests(number,tests));
    if (matches.some(t => t.status !== 'passed')) throw Error('acceptance_companion_not_passed_' + number);
    return { id, caseIds: ['RPT-AC-' + number], phase, status: 'passed', dimension: 'local',
      assertionCount: matches.length, skipped: 0, evidenceHash,testIds:matches.map(test=>test.testId) };
  });
}

export const acceptanceEvidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Test-only fixture helpers; no runtime clock or production configuration is changed. */
export function acceptanceCalendarClose(now:number,durationMinutes:number){
  const close=new Date(Math.ceil((now+durationMinutes*60_000)/60_000)*60_000);
  if(!Number.isFinite(now)||!Number.isFinite(durationMinutes)||durationMinutes<=0||close.toISOString().slice(0,10)!==new Date(now).toISOString().slice(0,10)||close.toISOString().slice(11,16)==='00:00')throw Error('acceptance_calendar_crosses_utc_day');
  return close;
}
export function isPrivateAcceptanceSql(query:string){
  const sql=query.replace(/'(?:[^']|'')*'/g,"''").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,' ');
  const relations=sql.matchAll(/\b(?:from|join)\s+((?:(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)\s*\.\s*)*(?:"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*))/gi);
  return [...relations].some(match=>['messages','survey_question_working_insights','memories','conversation_summaries'].includes(match[1]!.split('.').at(-1)!.trim().replaceAll('"','').toLowerCase()));
}
export async function orderedAcceptanceClosers(closers:readonly (()=>Promise<unknown>)[]){
  const results:PromiseSettledResult<unknown>[]=[];
  for(const close of closers){try{results.push({status:'fulfilled',value:await close()});}catch(reason){results.push({status:'rejected',reason});}}
  return results;
}
