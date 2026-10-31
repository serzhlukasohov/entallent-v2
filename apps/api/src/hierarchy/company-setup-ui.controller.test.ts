import { PULSE_SOURCE_ADMIN } from '@entalent/contracts';
import { describe, expect, it, vi } from 'vitest';
import { CompanySetupUiController } from './company-setup-ui.controller';

function response() {
  const headers = new Map<string, string>();
  let contentType = '';
  let body = '';
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return reply;
    }),
    type: vi.fn((value: string) => {
      contentType = value;
      return reply;
    }),
    send: vi.fn((value: string) => {
      body = value;
      return reply;
    }),
  };
  return {
    reply,
    headers,
    get contentType() {
      return contentType;
    },
    get body() {
      return body;
    },
  };
}

describe('dedicated Company setup UI', () => {
  it('serves a separate setup page with a same-origin script and a restrictive CSP', () => {
    const controller = new CompanySetupUiController();
    const html = response();
    controller.ui(html.reply as never);
    expect(html.contentType).toContain('text/html');
    expect(html.body).toContain('Company setup');
    expect(html.body).toContain('/api/v1/company-setup/ui.js');
    expect(html.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(html.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");

    const script = response();
    controller.script(script.reply as never);
    expect(script.contentType).toContain('application/javascript');
    expect(() => new Function(script.body)).not.toThrow();
    expect(script.body).toContain("credentials: 'same-origin'");
    expect(script.body).toContain("options.headers['x-csrf-token'] = csrf");
    expect(html.body).toContain('previous-lead-action');
    expect(html.body).toContain('Become an Employee in this Team');
    expect(script.body).toContain("'/promote-lead'");
    expect(html.body).toContain('previous-manager-action');
    expect(html.body).toContain('Become a direct Employee in this Unit');
    expect(script.body).toContain("'/promote-manager'");
    expect(html.body).toContain('advisor-units');
    expect(script.body).toContain("'/advisor-scope'");
    expect(html.body).toContain('deactivate-person-button');
    expect(script.body).toContain("'/deactivate'");
    expect(html.body).toContain('deactivate-team-lead-action');
    expect(script.body).toContain('{ leadAction }');
    expect(html.body).toContain('deactivate-unit-manager-action');
    expect(script.body).toContain("'/transfer-deactivate'");
    expect(html.body).toContain('edit-person-form');
    expect(html.body).toContain('edit-unit-form');
    expect(html.body).toContain('edit-team-form');
    expect(script.body).toContain("'/draft'");
    expect(html.body).toContain('draft-placement-person');
    expect(script.body).toContain("'/draft-placement'");
    expect(html.body).toContain('id="rollout-unit" multiple');
    expect(script.body).toContain("'/units/rollout/preview'");
    expect(script.body).toContain("'/units/rollout'");
    expect(script.body).toContain('renderHierarchy(snapshot)');
    expect(script.body).toContain('pending assignment');
    expect(html.body).toContain('First-contact delivery');
    expect(html.body).toContain('id="work-calendar"');
    expect(script.body).toContain('not configured by enTalent');
    expect(script.body).not.toContain('calendar-form');
    expect(html.body).toContain('report-language-form');
    expect(script.body).toContain('Enter a supported language tag, for example en or de-DE.');
    expect(script.body).toContain(
      'Company settings changed. Refresh the page before saving again.',
    );
    expect(script.body).toContain('Contact enTalent to finish report setup.');
    expect(script.body).not.toContain('config.unavailableReason.replaceAll');
    expect(script.body).toContain('Sending · verify before retry');
  });
  it('renders the aggregate onboarding summary without any per-person decision', () => {
    const controller = new CompanySetupUiController();
    const html = response();
    const script = response();
    controller.ui(html.reply as never);
    controller.script(script.reply as never);
    expect(html.body).toContain('onboarding-summary');
    expect(script.body).toContain('Hidden for groups under 5 people');
    expect(script.body).toContain('in progress');
    expect(script.body.slice(script.body.indexOf('function renderOnboardingSummary('),script.body.indexOf('async function refresh('))).not.toMatch(/participation|declined|deferred/i);
  });
});

describe('retained invalid report calendar display', () => {
  it.each([
    { holidays: {}, dateOverrides: [] },
    { holidays: [], dateOverrides: [null] },
  ])('keeps language repair usable with malformed JSON %j', (extras) => {
    const controller = new CompanySetupUiController(),
      script = response();
    controller.script(script.reply as never);
    const start = script.body.indexOf('function renderCalendar('),
      end = script.body.indexOf('function renderDeliveries(', start);
    const nodes = new Map<string, { value: string; textContent: string; className: string }>();
    const el = (id: string) => {
      if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', className: '' });
      return nodes.get(id)!;
    };
    const render = new Function('el', 't', script.body.slice(start, end) + ';return renderCalendar;')(
      el, (key:string)=>PULSE_SOURCE_ADMIN[key as keyof typeof PULSE_SOURCE_ADMIN],
    );
    expect(() =>
      render({
        calendarConfigured: true,
        calendar: {
          timezone: 'UTC',
          workingDays: [1],
          workStart: '09:00',
          workEnd: '18:00',
          ...extras,
        },
        reportConfiguration: {
          locale: 'de',
          unavailableReason: 'invalid_calendar',
          calendar: null,
        },
      }),
    ).not.toThrow();
    expect(el('report-locale').value).toBe('de');
    expect(el('work-calendar').textContent).toContain('needs review by enTalent');
    expect(el('report-language-status').textContent).toContain('needs review by enTalent');
  });
});

describe('RPT-LANG executable setup bootstrap',()=>{
 function fixture(authenticated=true,initialStatus='ready'){
  type FixtureNode={value:string;textContent:string;className:string;hidden:boolean;dataset:Record<string,string>;children:unknown[];elements:unknown[];options:unknown[];selectedOptions:unknown[];events:Map<string,(event:{preventDefault:()=>void})=>unknown>;addEventListener(name:string,fn:(event:{preventDefault:()=>void})=>unknown):void;append(child:unknown):void;replaceChildren(...children:unknown[]):void;reset():void;querySelectorAll():unknown[]};
  type FakeOptions={method:string;headers:Record<string,string>;body?:string};
  const nodes=new Map<string,FixtureNode>();
  const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',className:'',hidden:false,dataset:{},children:[],elements:[],options:[],selectedOptions:[],events:new Map(),addEventListener(name:string,fn:(event:{preventDefault:()=>void})=>unknown){this.events.set(name,fn);},append(child:unknown){this.children.push(child);},replaceChildren(...children:unknown[]){this.children=children;this.options=[];},reset(){},querySelectorAll(){return[];}});return nodes.get(id)!;};
  const sourceKey='setup.4fd596cf578a';node('translated-heading').dataset.copyKey=sourceKey;
  const language={locale:'de',status:initialStatus,resourceVersion:'pulse-copy-v1',resources:{admin:{texts:{...PULSE_SOURCE_ADMIN,[sourceKey]:'Berichtssprache des Unternehmens'}}}};
  const snapshot={persons:[],units:[],teams:[],placements:[],capabilities:[],slackLinks:[],workspaces:[],deliveries:[],advisorAssignments:[],hrbpScopes:[],onboardingSummary:[],calendarConfigured:false,calendar:null,reportConfiguration:{locale:'de',revision:4,unavailableReason:'missing_calendar'},companyLanguage:language};
  const requests:Array<{path:string;options:FakeOptions}>=[];
  const fetch=vi.fn(async(path:string,options:FakeOptions)=>{requests.push({path,options});if(path.endsWith('/me'))return{ok:authenticated,json:async()=>authenticated?{tenantId:'original-tenant-id',personId:'original-person-id',csrfToken:'fixture-csrf'}:{code:'unauthorized'}};return{ok:true,json:async()=>path.endsWith('/snapshot')?structuredClone(snapshot):{}};});
  const document={documentElement:{lang:'en'},getElementById:node,querySelectorAll:()=>[node('translated-heading')],createElement:()=>node('created-'+nodes.size)};
  const controller=new CompanySetupUiController(),reply=response();controller.script(reply.reply as never);
  const script=reply.body.replace('(async () => { try {','const bootstrap = (async () => { try {');
  const executed=new Function('document','fetch','location','URLSearchParams','confirm',script+';return {bootstrap,t,api,refresh};')(document,fetch,{search:'?tenantId=original-tenant-id',reload:vi.fn()},URLSearchParams,()=>{throw new Error('rollout/onboarding actions forbidden in fixture');});
  return{nodes,node,requests,document,executed,snapshot,language};
 }
 it('executes localization after verified snapshot while preserving machine payload keys and CSRF (fake requests only)',async()=>{
  const f=fixture();await f.executed.bootstrap;
  expect(f.document.documentElement.lang).toBe('de');expect(f.node('translated-heading').textContent).toBe('Berichtssprache des Unternehmens');
  f.node('report-locale').value='uk';f.node('report-language-form').events.get('submit')!({preventDefault:vi.fn()});
  await vi.waitFor(()=>expect(f.requests.some(r=>r.path.endsWith('/company-language'))).toBe(true));
  const save=f.requests.find(r=>r.path.endsWith('/company-language'))!;
  expect(JSON.parse(save.options.body!)).toEqual({locale:'uk',expectedConfigRevision:4});expect(save.options.headers['x-csrf-token']).toBe('fixture-csrf');
  expect(f.requests.filter(r=>r.options.method!=='GET').map(r=>r.path)).toEqual(['/api/v1/company-setup/company-language']);
 });
 it('R3 keeps initial unavailable company language visible and authenticated with an authorized recovery form',async()=>{
  const f=fixture(true,'language_unavailable');await f.executed.bootstrap;
  expect(f.node('login').hidden).toBe(true);expect(f.node('app').hidden).toBe(true);
  expect(f.node('language-recovery').hidden).toBe(false);expect(f.document.documentElement.lang).toBe('en');
  expect(f.node('language-unavailable-notice').textContent).toContain('de');
  expect(f.node('language-unavailable-notice').dataset.languageStatus).toBe('language_unavailable');
  expect(f.node('language-recovery-locale').value).toBe('de');
  expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/company-auth/me','/api/v1/company-setup/snapshot']);
 });
 it('R3 keeps post-save unavailability visible, then recovers through the same protected language endpoint',async()=>{
  const f=fixture();await f.executed.bootstrap;
  f.snapshot.companyLanguage.status='language_unavailable';f.snapshot.companyLanguage.locale='ja';
  f.node('report-locale').value='ja';f.node('report-language-form').events.get('submit')!({preventDefault:vi.fn()});
  await vi.waitFor(()=>expect(f.node('app').hidden).toBe(true));
  expect(f.node('login').hidden).toBe(true);expect(f.node('language-unavailable-notice').textContent).toContain('ja');
  f.node('language-recovery-locale').value='en';
  f.node('language-recovery-form').events.get('submit')!({preventDefault:vi.fn()});
  await vi.waitFor(()=>expect(f.requests.filter(r=>r.options.method==='POST').length).toBe(2));
  const request=f.requests.filter(r=>r.options.method==='POST')[1]!;
  expect(request.path).toBe('/api/v1/company-setup/company-language');expect(request.options.headers['x-csrf-token']).toBe('fixture-csrf');expect(JSON.parse(request.options.body!)).toEqual({locale:'en',expectedConfigRevision:4});
  f.snapshot.companyLanguage.status='ready';f.snapshot.companyLanguage.locale='en';
  await f.executed.refresh();
  expect(f.node('app').hidden).toBe(false);expect(f.node('language-recovery').hidden).toBe(true);expect(f.document.documentElement.lang).toBe('en');
  expect(f.requests.filter(r=>r.options.method!=='GET').every(r=>r.path.endsWith('/company-language'))).toBe(true);
 });
 it('R4 renders German lifecycle and active/pending employee templates without changing names or enums',async()=>{
  const f=fixture();
  Object.assign(f.language.resources.admin.texts,{'setup.lifecycle.active':'Aktiv','setup.lifecycle.draft':'Entwurf','setup.lifecycle.inactive':'Inaktiv','setup.hierarchy_status':'{lifecycle} · {active} aktiv / {pending} ausstehende Mitarbeitende','setup.person_status':'{lifecycle} · {assignment}'});
  const data={persons:[{id:'active-person',displayName:'Original Name',customerEmployeeId:'customer-key',primaryRole:'employee',lifecycleStatus:'active'},{id:'draft-person',displayName:'Unchanged Draft Name',customerEmployeeId:'draft-key',primaryRole:'employee',lifecycleStatus:'draft'}],units:[{id:'u',name:'Original Unit',customerUnitKey:'unit-key',managerPersonId:null,lifecycleStatus:'active'}],teams:[{id:'team',unitId:'u',name:'Original Team',customerTeamKey:'team-key',teamLeadPersonId:null,lifecycleStatus:'draft'}],placements:[{unitId:'u',teamId:'team',employeePersonId:'active-person',lifecycleStatus:'active'},{unitId:'u',teamId:'team',employeePersonId:'draft-person',lifecycleStatus:'draft'}]};
  Object.assign(f.snapshot,data);await f.executed.bootstrap;
  const rendered=JSON.stringify(f.node('hierarchy').children);
  expect(rendered).toContain('Aktiv · 1 aktiv / 1 ausstehende Mitarbeitende');expect(rendered).toContain('Entwurf · 1 aktiv / 1 ausstehende Mitarbeitende');
  expect(rendered).toContain('Original Name');expect(rendered).toContain('Original Unit');expect(rendered).not.toContain('pending Employees');expect(rendered).not.toContain(' active / ');
  expect(data.placements.map(p=>p.lifecycleStatus)).toEqual(['active','draft']);expect(data.persons[0]!.customerEmployeeId).toBe('customer-key');
 });
 it('keeps the exact tenantId query key and English bootstrap before authentication',async()=>{
  const f=fixture(false);await f.executed.bootstrap;expect(f.document.documentElement.lang).toBe('en');expect(f.node('tenant-id').value).toBe('original-tenant-id');expect(f.requests.map(r=>r.path)).toEqual(['/api/v1/company-auth/me']);
 });
});
