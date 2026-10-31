import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Company setup · enTalent</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#153047;background:#f4f7f9}*{box-sizing:border-box}
body{margin:0}header{background:#153047;color:white;padding:1.5rem max(1rem,calc((100vw - 1120px)/2))}
header h1{margin:0;font-size:1.5rem}header p{margin:.25rem 0 0;color:#d5e3e9}
main{max-width:1120px;margin:2rem auto;padding:0 1rem;display:grid;gap:1.25rem}
.card{background:white;border:1px solid #d7e2e8;border-radius:12px;padding:1.25rem;box-shadow:0 2px 8px #1530470b}
h2{font-size:1.2rem;margin:0 0 1rem}h3{font-size:1rem;margin:.75rem 0}p{margin:.5rem 0 1rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1rem}
label{display:block;font-weight:600;margin:.5rem 0}input,select,textarea{display:block;width:100%;font:inherit;padding:.6rem;border:1px solid #aabcc6;border-radius:6px;background:white}
textarea{min-height:9rem}button{font:inherit;font-weight:650;border:0;border-radius:7px;background:#067b79;color:white;padding:.65rem 1rem;cursor:pointer;margin:.6rem .5rem .3rem 0}
button.secondary{background:#34556b}button:disabled{opacity:.55;cursor:wait}.muted{color:#537082}.error{color:#a62228}.success{color:#146f48}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:.55rem;border-bottom:1px solid #e0e8ec;vertical-align:top}
.scroll{overflow-x:auto}.pill{display:inline-block;border-radius:1rem;background:#e7f1f3;padding:.1rem .55rem}
#hierarchy td:first-child{white-space:pre}
#app[hidden],#login[hidden],#language-recovery[hidden]{display:none}
</style></head><body>
<header><h1><span data-copy-key="setup.c9bfc5e1b04c">enTalent · Company setup</span></h1><p><span data-copy-key="setup.6d0dcb9b759d">Prepare your hierarchy, connect Slack identities, and activate Units.</span></p></header>
<main>
<section class="card" id="login" hidden><h2><span data-copy-key="setup.2d45e0e3bc6f">Corporate sign in</span></h2><p><span data-copy-key="setup.4e04dc99e8b0">Enter your company tenant ID to continue with your corporate identity provider.</span></p>
<label><span data-copy-key="setup.de1f5fff3413">Tenant ID</span><input id="tenant-id" autocomplete="off" placeholder="00000000-0000-0000-0000-000000000000"></label>
<button id="sign-in"><span data-copy-key="setup.aa60655c5349">Continue with SSO</span></button></section>
<section class="card" id="language-recovery" hidden lang="en"><h2>Company language unavailable</h2><p id="language-unavailable-notice" role="status"></p><form id="language-recovery-form"><label>Company language tag<input id="language-recovery-locale" required maxlength="100" autocomplete="off"></label><button type="submit">Save company language</button></form><p id="language-recovery-status" role="status"></p></section>
<section id="app" hidden>
<div class="card"><div class="grid"><div><h2><span data-copy-key="setup.1b93144401fc">Setup overview</span></h2><p id="identity" class="muted"></p><p id="counts"></p></div><div><button id="refresh" class="secondary"><span data-copy-key="setup.0e9161011702">Refresh</span></button><button id="logout" class="secondary"><span data-copy-key="setup.48f0d3d397d4">Sign out</span></button></div></div><p id="status" role="status"></p></div>
<div class="card"><h2><span data-copy-key="setup.5e5bfd948218">1. Import hierarchy</span></h2><p><span data-copy-key="setup.dc1647392a7e">Preview all detectable CSV errors before importing. Import is atomic and appends drafts.</span></p>
<label><span data-copy-key="setup.73aad53a5abb">CSV file</span><input id="csv-file" type="file" accept=".csv,text/csv"></label><label><span data-copy-key="setup.af497e28dbf2">CSV content</span><textarea id="csv" spellcheck="false"></textarea></label>
<button id="preview"><span data-copy-key="setup.6ece463bdce4">Preview CSV</span></button><button id="import" disabled><span data-copy-key="setup.1f9077652c1b">Import drafts</span></button><div id="preview-result" class="scroll"></div></div>
<div class="card"><h2><span data-copy-key="setup.3753906fa359">2. Add individual drafts</span></h2><div class="grid">
<form id="person-form"><h3><span data-copy-key="setup.6007db63e18e">Person</span></h3><label><span data-copy-key="setup.564bc04ebb5f">Employee ID</span><input name="customerEmployeeId" required></label><label><span data-copy-key="setup.932f815786ae">Work email</span><input name="workEmail" type="email" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="displayName" required></label><label><span data-copy-key="setup.86db80a8096b">Job title</span><input name="jobTitle"></label><label><span data-copy-key="setup.e8baefef21d1">Primary role</span><select name="primaryRole"><option value="employee"><span data-copy-key="setup.14014e6a5703">Employee</span></option><option value="team_lead"><span data-copy-key="setup.f61e13727dcc">Team Lead</span></option><option value="manager"><span data-copy-key="setup.8b2085f74dfa">Manager</span></option><option value="hr"><span data-copy-key="setup.15e68b1f4657">HR</span></option><option value="hrbp"><span data-copy-key="setup.a12d80941bab">HRBP</span></option><option value="leadership"><span data-copy-key="setup.ec75f79040af">Leadership</span></option></select></label><button><span data-copy-key="setup.86f10803a2bc">Add Person</span></button></form>
<form id="unit-form"><h3><span data-copy-key="setup.4e545960f1bf">Unit</span></h3><label><span data-copy-key="setup.bb6d8a9f2cf6">Unit key</span><input name="customerUnitKey" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="name" required></label><label><span data-copy-key="setup.8b2085f74dfa">Manager</span><select name="managerPersonId" id="unit-manager"></select></label><button><span data-copy-key="setup.a4dd9ef3400c">Add Unit</span></button></form>
<form id="team-form"><h3><span data-copy-key="setup.5985039f106d">Team</span></h3><label><span data-copy-key="setup.030f3cbcb6ac">Team key</span><input name="customerTeamKey" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="name" required></label><label><span data-copy-key="setup.4e545960f1bf">Unit</span><select name="unitId" id="team-unit" required></select></label><label><span data-copy-key="setup.f61e13727dcc">Team Lead</span><select name="teamLeadPersonId" id="team-lead"></select></label><button><span data-copy-key="setup.ffbbac1184a1">Add Team</span></button></form>
</div></div>
<div class="card"><h2><span data-copy-key="setup.0326896ea5e7">Edit drafts</span></h2><p><span data-copy-key="setup.4bdc5439cff1">Choose a draft to load its fields. Active records use the operations below.</span></p><div class="grid">
<form id="edit-person-form"><h3><span data-copy-key="setup.6007db63e18e">Person</span></h3><label><span data-copy-key="setup.f0dcc815d5de">Draft Person</span><select id="edit-person"></select></label><label><span data-copy-key="setup.564bc04ebb5f">Employee ID</span><input name="customerEmployeeId" required></label><label><span data-copy-key="setup.932f815786ae">Work email</span><input name="workEmail" type="email" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="displayName" required></label><label><span data-copy-key="setup.86db80a8096b">Job title</span><input name="jobTitle"></label><label><span data-copy-key="setup.e8baefef21d1">Primary role</span><select name="primaryRole"><option value="employee"><span data-copy-key="setup.14014e6a5703">Employee</span></option><option value="team_lead"><span data-copy-key="setup.f61e13727dcc">Team Lead</span></option><option value="manager"><span data-copy-key="setup.8b2085f74dfa">Manager</span></option><option value="hr"><span data-copy-key="setup.15e68b1f4657">HR</span></option><option value="hrbp"><span data-copy-key="setup.a12d80941bab">HRBP</span></option><option value="leadership"><span data-copy-key="setup.ec75f79040af">Leadership</span></option></select></label><button><span data-copy-key="setup.ab4b8785edf2">Save Person draft</span></button></form>
<form id="edit-unit-form"><h3><span data-copy-key="setup.4e545960f1bf">Unit</span></h3><label><span data-copy-key="setup.cb4ca034fdf5">Draft Unit</span><select id="edit-unit"></select></label><label><span data-copy-key="setup.bb6d8a9f2cf6">Unit key</span><input name="customerUnitKey" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="name" required></label><label><span data-copy-key="setup.8b2085f74dfa">Manager</span><select name="managerPersonId" id="edit-unit-manager"></select></label><button><span data-copy-key="setup.ddf4180f1121">Save Unit draft</span></button></form>
<form id="edit-team-form"><h3><span data-copy-key="setup.5985039f106d">Team</span></h3><label><span data-copy-key="setup.15d7b50a88e5">Draft Team</span><select id="edit-team"></select></label><label><span data-copy-key="setup.030f3cbcb6ac">Team key</span><input name="customerTeamKey" required></label><label><span data-copy-key="setup.dcd1d5223f73">Name</span><input name="name" required></label><label><span data-copy-key="setup.4e545960f1bf">Unit</span><select name="unitId" id="edit-team-unit" required></select></label><label><span data-copy-key="setup.f61e13727dcc">Team Lead</span><select name="teamLeadPersonId" id="edit-team-lead"></select></label><button><span data-copy-key="setup.908259116d4e">Save Team draft</span></button></form>
</div></div>
<div class="card"><h2><span data-copy-key="setup.58f2069986a9">Correct a draft Employee assignment</span></h2><p><span data-copy-key="setup.39adaff475a9">Choose a Unit and optional Team, or leave Unit empty to remove the draft assignment. The Person remains draft.</span></p>
<div class="grid"><label><span data-copy-key="setup.aee18007008b">Draft Employee</span><select id="draft-placement-person"></select></label><label><span data-copy-key="setup.4e545960f1bf">Unit</span><select id="draft-placement-unit"></select></label><label><span data-copy-key="setup.5985039f106d">Team</span><select id="draft-placement-team"></select></label></div>
<button id="draft-placement-save"><span data-copy-key="setup.2a4256dc94b1">Save draft assignment</span></button></div>
<div class="card"><h2><span data-copy-key="setup.87c0b5a8b51d">3. Link Slack identities</span></h2><p><span data-copy-key="setup.96688fb69856">Automatic matching uses exact work email. Resolve missing or ambiguous matches manually.</span></p><div class="grid">
<label><span data-copy-key="setup.6007db63e18e">Person</span><select id="link-person"></select></label><label><span data-copy-key="setup.66b905fa46e9">Slack workspace</span><select id="link-workspace"></select></label><label><span data-copy-key="setup.e7836119d1c3">Manual Slack user ID</span><input id="slack-user-id" placeholder="U…"></label></div>
<button id="link-email"><span data-copy-key="setup.61384289c822">Match by email</span></button><button id="link-manual" class="secondary"><span data-copy-key="setup.acd7fcbc9f05">Link selected Slack user</span></button><button id="unlink" class="secondary"><span data-copy-key="setup.ce1b6e6cea84">Unlink draft Person</span></button><div id="workspaces" class="scroll"></div></div>
<div class="card"><h2><span data-copy-key="setup.bcde13ffa787">4. Move an active Employee</span></h2><p><span data-copy-key="setup.3f166caa4c6e">Moving a Person checks both the source and destination hierarchy. An active Team cannot lose its final Employee.</span></p>
<div class="grid"><label><span data-copy-key="setup.14014e6a5703">Employee</span><select id="move-person"></select></label><label><span data-copy-key="setup.30ea00111c68">Destination Unit</span><select id="move-unit"></select></label><label><span data-copy-key="setup.02a1e9784593">Destination Team</span><select id="move-team"></select></label></div>
<button id="move"><span data-copy-key="setup.570e386efab1">Move Employee</span></button></div>
<div class="card"><h2><span data-copy-key="setup.1b49152e4788">5. Promote a Team Lead</span></h2><p><span data-copy-key="setup.e488f7f800fa">Select an Employee in the Team and explicitly choose what happens to its current Lead.</span></p>
<div class="grid"><label><span data-copy-key="setup.5985039f106d">Team</span><select id="promote-team"></select></label><label><span data-copy-key="setup.8e7f709a7389">New Lead</span><select id="promote-person"></select></label>
<label><span data-copy-key="setup.dae130a650d0">Previous Lead</span><select id="previous-lead-action"><option value=""><span data-copy-key="setup.769239f13d47">Choose an action</span></option><option value="become_employee"><span data-copy-key="setup.37151d5cbd27">Become an Employee in this Team</span></option><option value="deactivate"><span data-copy-key="setup.fb1e6fa55327">Deactivate</span></option></select></label></div>
<button id="promote-lead"><span data-copy-key="setup.d6cd69253434">Promote Team Lead</span></button></div>
<div class="card"><h2><span data-copy-key="setup.f3678e50bf1f">6. Promote a Manager</span></h2><p><span data-copy-key="setup.a334915143a6">Select an Employee in the Unit and explicitly choose what happens to its current Manager.</span></p>
<div class="grid"><label><span data-copy-key="setup.4e545960f1bf">Unit</span><select id="promote-unit"></select></label><label><span data-copy-key="setup.760c291a907f">New Manager</span><select id="promote-manager-person"></select></label>
<label><span data-copy-key="setup.4889a4903a10">Previous Manager</span><select id="previous-manager-action"><option value=""><span data-copy-key="setup.769239f13d47">Choose an action</span></option><option value="become_employee"><span data-copy-key="setup.da395b278f6b">Become a direct Employee in this Unit</span></option><option value="deactivate"><span data-copy-key="setup.fb1e6fa55327">Deactivate</span></option></select></label></div>
<button id="promote-manager"><span data-copy-key="setup.a238ed9e5ac3">Promote Manager</span></button></div>
<div class="card"><h2><span data-copy-key="setup.e97f86e7295d">7. HR and HRBP scope</span></h2><p><span data-copy-key="setup.e44b897caea4">Select one or more Units for HR, or selected Units or all Units for HRBP. Draft assignments remain pending until activation. To clear a draft scope before correcting its role, choose Selected Units, deselect every Unit, and save.</span></p>
<div class="grid"><label><span data-copy-key="setup.28da8c1f9ede">Advisor</span><select id="advisor-person"></select></label><label><span data-copy-key="setup.b073f6c68ef8">Scope</span><select id="advisor-mode"><option value="selected_units"><span data-copy-key="setup.00775121af1d">Selected Units</span></option><option value="all_units"><span data-copy-key="setup.e5d878b1ace0">All Units</span></option></select></label>
<label><span data-copy-key="setup.9fb6669a77ea">Units</span><select id="advisor-units" multiple size="6"></select></label></div><button id="advisor-save"><span data-copy-key="setup.c28801f5bad6">Save scope</span></button></div>
<div class="card"><h2><span data-copy-key="setup.f33e3a0d3abe">8. Company Admin access</span></h2><p><span data-copy-key="setup.15695bd78373">Grant or revoke setup access. A new administrator also needs their corporate SSO identity linked by an operator before sign-in.</span></p>
<label><span data-copy-key="setup.6007db63e18e">Person</span><select id="admin-person"></select></label><button id="admin-grant"><span data-copy-key="setup.8693768c7e08">Grant access</span></button><button id="admin-revoke" class="secondary"><span data-copy-key="setup.ab292ddb87d6">Revoke access</span></button></div>
<div class="card"><h2><span data-copy-key="setup.52dd1412b028">9. Deactivate a Person</span></h2><p><span data-copy-key="setup.cd762c97e67b">Employee, HR, HRBP, and Leadership can be deactivated when the active hierarchy remains valid. Replace a Team Lead or Manager through a promotion first.</span></p>
<label><span data-copy-key="setup.de34505b6e99">Active Person</span><select id="deactivate-person"></select></label><button id="deactivate-person-button" class="secondary"><span data-copy-key="setup.23b6d977feee">Deactivate Person</span></button></div>
<div class="card"><h2><span data-copy-key="setup.13f06a72aeae">10. Deactivate a Team</span></h2><p><span data-copy-key="setup.2e6fde7d1f4c">Members become direct Employees of the same Unit. Choose what happens to the previous Team Lead.</span></p>
<div class="grid"><label><span data-copy-key="setup.5985039f106d">Team</span><select id="deactivate-team"></select></label><label><span data-copy-key="setup.dae130a650d0">Previous Lead</span><select id="deactivate-team-lead-action"><option value=""><span data-copy-key="setup.769239f13d47">Choose an action</span></option><option value="become_employee"><span data-copy-key="setup.5cb5bd69dca9">Become a direct Employee</span></option><option value="deactivate"><span data-copy-key="setup.fb1e6fa55327">Deactivate</span></option></select></label></div>
<button id="deactivate-team-button" class="secondary"><span data-copy-key="setup.0c3dd6d42194">Deactivate Team</span></button></div>
<div class="card"><h2><span data-copy-key="setup.7a7a564decd4">11. Transfer and deactivate a Unit</span></h2><p><span data-copy-key="setup.2219b490c303">Move its Teams, Employees, and advisor assignments into another active Unit. Choose what happens to the previous Manager.</span></p>
<div class="grid"><label><span data-copy-key="setup.3fdc28f01267">Source Unit</span><select id="deactivate-unit"></select></label><label><span data-copy-key="setup.b6a023aaf4a8">Target Unit</span><select id="deactivate-unit-target"></select></label><label><span data-copy-key="setup.4889a4903a10">Previous Manager</span><select id="deactivate-unit-manager-action"><option value=""><span data-copy-key="setup.769239f13d47">Choose an action</span></option><option value="become_employee"><span data-copy-key="setup.4be5d8b8a265">Become a direct Employee in target Unit</span></option><option value="deactivate"><span data-copy-key="setup.fb1e6fa55327">Deactivate</span></option></select></label></div>
<button id="deactivate-unit-button" class="secondary"><span data-copy-key="setup.b96755edf9c8">Transfer and deactivate Unit</span></button></div>
<div class="card"><h2><span data-copy-key="setup.175739fd70c5">12. Activate Units</span></h2><p><span data-copy-key="setup.cab11deda4b5">Select one or more Units. All selected Units must pass structural checks; ready Persons activate together, while unlinked Persons remain draft.</span></p>
<div class="grid"><label><span data-copy-key="setup.9fb6669a77ea">Units</span><select id="rollout-unit" multiple size="6"></select></label><label><span data-copy-key="setup.66b905fa46e9">Slack workspace</span><select id="rollout-workspace"></select></label></div>
<button id="rollout-preview" class="secondary"><span data-copy-key="setup.1e2cac582fd3">Check readiness</span></button><button id="rollout" disabled><span data-copy-key="setup.9ded7e1fc0a7">Activate selected Units</span></button><div id="rollout-result" class="scroll"></div></div>
<div class="card"><h2><span data-copy-key="setup.4fd596cf578a">Company report language</span></h2><p><span data-copy-key="setup.868df5ddbc43">Language for future report formation. Personal chat and onboarding language are unchanged.</span></p><form id="report-language-form"><label><span data-copy-key="setup.6bdc544210bd">Language tag (for example en or de-DE)</span><input id="report-locale" required maxlength="100" autocomplete="off"></label><p id="report-language-status" class="muted"></p><button type="submit"><span data-copy-key="setup.b61b06a98d8f">Save report language</span></button></form></div>
<div class="card"><h2><span data-copy-key="setup.b9de9b6ebfee">Work calendar</span></h2><p id="work-calendar" class="muted"></p></div>
<div class="card"><h2><span data-copy-key="setup.ae53bf97f697">First-contact delivery</span></h2><p><span data-copy-key="setup.7ab647c1efc1">Pending and failed messages are retried by the worker. A message left in sending needs delivery verification before any manual retry.</span></p><div id="onboarding-deliveries" class="scroll"></div></div>
<div class="card"><h2><span data-copy-key="setup.ad8a0dac00a2">Onboarding progress</span></h2><p class="muted"><span data-copy-key="setup.dda128f91883">Aggregate counts per Unit. Groups under 5 people are hidden.</span></p><div id="onboarding-summary" class="scroll"></div></div>
<div class="card"><h2><span data-copy-key="setup.9a593237fa2e">Current hierarchy</span></h2><div id="hierarchy" class="scroll"></div></div>
</section></main><script src="/api/v1/company-setup/ui.js" defer></script></body></html>`;

const SCRIPT = String.raw`'use strict';
const englishCopy = {"ui.001":"Organization","ui.002":"Legacy Slack teams","ui.003":"Not configured","ui.004":"No employees","ui.005":"Not assigned","ui.006":"People:","ui.007":"Manager","ui.008":"Team Lead","ui.009":"Members","ui.010":"Direct reports to manager","ui.011":"No legacy team","ui.012":"not assigned","ui.013":"Outside the organization","ui.014":"Members of legacy Slack teams and the current V2 cohort without an organizational placement.","ui.015":"V2 cohort","ui.016":"Team","ui.017":"Named team membership is available only in private QA mode.","ui.018":"The team hierarchy is currently unavailable.","ui.019":"The hierarchy has not been configured yet.","ui.020":"Cause:","ui.021":"Author:","ui.022":"Drafts · not confirmed","ui.023":"No drafts","ui.024":"Ready for confirmation","ui.025":"Team Signals · deidentified","ui.026":"No signals yet","ui.027":"Participants:","ui.028":"Topic group","ui.029":"All groups","ui.030":"across the entire cycle","ui.031":"Current cycle","ui.032":"Drafts and Team Signals are available only in private QA mode.","ui.033":"Participants","ui.034":"Drafts","ui.035":"not yet confirmed by the participant","ui.036":"confirmed and deidentified","ui.037":"Left: participant drafts, which may change. Right: confirmed results without names. Rows match only by topic. The five-participant threshold does not apply in QA mode.","ui.038":"Participant drafts are currently unavailable.","ui.039":"Team Signals are currently unavailable.","ui.040":"No confirmed signals yet.","ui.041":"No topics in this cycle yet.","ui.042":"More","ui.043":"topic","ui.044":"topics","ui.045":"topics","ui.046":"without data","ui.047":"Draft · may change","ui.048":"Deidentified result","ui.049":"Score —","ui.050":"No text at this stage","ui.051":"← Current cycle","ui.052":"Records unavailable","ui.053":"Drafts are visible before confirmation; afterward, only the deidentified result remains.","ui.054":"· finalized","ui.055":"ready for confirmation","ui.056":"Participant records are available only in private QA mode with a working API.","ui.057":"V2 cycles","ui.058":"Newest first. Time: Warsaw. Participated means at least one inbound message during the cycle.","ui.059":"Data unavailable. Check the API connection and internal dashboard settings.","ui.060":"No V2 cycles yet.","ui.061":"Period","ui.062":"State","ui.063":"Participated","ui.064":"Autonomy 3/3","ui.065":"Report","ui.066":"Manager report:","ui.067":"Manager route not configured","ui.068":"at least one message during the cycle","ui.069":"Inbound messages processed","ui.070":"Meanings ready","ui.071":"Bundles delivered","ui.072":"groups awaiting confirmation","ui.073":"participants; report threshold","ui.074":"Cohort membership","ui.075":"Membership unavailable: the API did not respond.","ui.076":"Membership is available only in QA mode.","ui.077":"The cohort has no members.","ui.078":"Participant","ui.079":"Messages during cycle","ui.080":"Participated","ui.081":"Autonomy","ui.082":"Yes","ui.083":"No","ui.084":"Cycles","ui.085":"Refresh","ui.086":"How to read","ui.087":"Topic journey","ui.088":"“Confirmed” means the participant agreed with the text; the result is still being calculated. “Result scored” means the deidentified result and score are ready.","ui.089":"— the assistant is asking the participant to clarify.","ui.090":"— the participant declined this topic; the draft was deleted.","ui.091":"— the participant rejected the entire bundle; collection restarts.","ui.092":"— no topic record, or the cycle closed before confirmation.","ui.093":"— a result exists without a score.","ui.094":"Signal colors","ui.095":"Positive","ui.096":"Mixed","ui.097":"Negative","ui.098":"No score","ui.099":"Score","ui.100":"From 0 to 100: higher is better.","ui.101":"Deidentified","ui.102":"The text was rewritten without names or recognizable details. The author is shown for deidentification QA: compare the result with the original conversation.","ui.103":"no messages in this cycle","ui.104":"Verification time unknown","ui.105":"Active","ui.106":"Upcoming","ui.107":"Closed","ui.108":"participant","ui.109":"participants","ui.110":"participants","ui.111":"The cycle has not started yet","ui.112":"Report sent","ui.113":"Cycle closed; report delivery unconfirmed","ui.114":"Threshold reached; report review and delivery are separate","ui.115":"Threshold not reached before cutoff","ui.116":"Result ready for report threshold review","ui.117":"Review topics with insufficient data","ui.118":"Conversation not started","ui.119":"Awaiting the first conversation","ui.120":"Three meanings ready","ui.121":"Review bundle and participant response","ui.122":"Review remaining Autonomy topics","ui.123":"Continue the conversation on missing topics","ui.124":"Records exist in other groups","ui.125":"Review Autonomy coverage","ui.126":"Conversation exists; no records yet","ui.127":"Review processing and continue the conversation","ui.128":"Adverse","ui.129":"Mixed","ui.130":"Favorable","ui.131":"Low","ui.132":"Moderate","ui.133":"High","ui.134":"Scored","ui.135":"Insufficient evidence","ui.136":"Workload","ui.137":"Clarity","ui.138":"Growth","ui.139":"Purpose","ui.140":"Belonging","ui.141":"Support","ui.142":"Recognition","ui.143":"Other","ui.144":"Unnamed","ui.145":"Draft","ui.146":"Awaiting confirmation","ui.147":"Clarification needed","ui.148":"Confirmed","ui.149":"Declined","ui.150":"No data","ui.151":"Collecting again","ui.152":"Result scored","ui.153":"Employee","ui.154":"Leadership","ui.need":"Need {count} more participants with Autonomy 3/3","ui.last_message":"Last message in cycle: {date}","ui.checked":"Checked {date} (Warsaw)","ui.cohort_active":"Current cycle · {start} → {end} (Warsaw)","ui.cohort_upcoming":"Cycle has not started · {start} → {end} (Warsaw)","ui.cohort_closed":"Closed cycle · {start} → {end} (Warsaw) · no active cycle","ui.autonomy_done":"Autonomy complete · {count}/3 scored","ui.autonomy_result":"Autonomy results {count}/3","ui.autonomy_work":"Autonomy in progress · {count}/3 ready","ui.signal_score":"{direction} · {score}/100 · {severity} importance","ui.legacy_home":"Legacy team: {team} · Manager: {manager}","ui.hierarchy_source":"Reporting relationships. Source: {source}.","ui.unplaced_count":"Outside the organization: {count}.","ui.score":"Score {score}/100","ui.cycle_title":"Cycle · {state}","ui.groups_count":"topics; complete groups: {count}","ui.participated_period":"Participated · {start} → {end}","ui.translation_pending":"Translation pending","ui.language_unavailable":"Language unavailable","ui.cycle_note":"{note} · across the entire cycle","setup.c9bfc5e1b04c":"enTalent · Company setup","setup.6d0dcb9b759d":"Prepare your hierarchy, connect Slack identities, and activate Units.","setup.2d45e0e3bc6f":"Corporate sign in","setup.4e04dc99e8b0":"Enter your company tenant ID to continue with your corporate identity provider.","setup.de1f5fff3413":"Tenant ID","setup.aa60655c5349":"Continue with SSO","setup.1b93144401fc":"Setup overview","setup.0e9161011702":"Refresh","setup.48f0d3d397d4":"Sign out","setup.5e5bfd948218":"1. Import hierarchy","setup.dc1647392a7e":"Preview all detectable CSV errors before importing. Import is atomic and appends drafts.","setup.73aad53a5abb":"CSV file","setup.af497e28dbf2":"CSV content","setup.6ece463bdce4":"Preview CSV","setup.1f9077652c1b":"Import drafts","setup.3753906fa359":"2. Add individual drafts","setup.6007db63e18e":"Person","setup.564bc04ebb5f":"Employee ID","setup.932f815786ae":"Work email","setup.dcd1d5223f73":"Name","setup.86db80a8096b":"Job title","setup.e8baefef21d1":"Primary role","setup.14014e6a5703":"Employee","setup.f61e13727dcc":"Team Lead","setup.8b2085f74dfa":"Manager","setup.15e68b1f4657":"HR","setup.a12d80941bab":"HRBP","setup.ec75f79040af":"Leadership","setup.86f10803a2bc":"Add Person","setup.4e545960f1bf":"Unit","setup.bb6d8a9f2cf6":"Unit key","setup.a4dd9ef3400c":"Add Unit","setup.5985039f106d":"Team","setup.030f3cbcb6ac":"Team key","setup.ffbbac1184a1":"Add Team","setup.0326896ea5e7":"Edit drafts","setup.4bdc5439cff1":"Choose a draft to load its fields. Active records use the operations below.","setup.f0dcc815d5de":"Draft Person","setup.ab4b8785edf2":"Save Person draft","setup.cb4ca034fdf5":"Draft Unit","setup.ddf4180f1121":"Save Unit draft","setup.15d7b50a88e5":"Draft Team","setup.908259116d4e":"Save Team draft","setup.58f2069986a9":"Correct a draft Employee assignment","setup.39adaff475a9":"Choose a Unit and optional Team, or leave Unit empty to remove the draft assignment. The Person remains draft.","setup.aee18007008b":"Draft Employee","setup.2a4256dc94b1":"Save draft assignment","setup.87c0b5a8b51d":"3. Link Slack identities","setup.96688fb69856":"Automatic matching uses exact work email. Resolve missing or ambiguous matches manually.","setup.66b905fa46e9":"Slack workspace","setup.e7836119d1c3":"Manual Slack user ID","setup.61384289c822":"Match by email","setup.acd7fcbc9f05":"Link selected Slack user","setup.ce1b6e6cea84":"Unlink draft Person","setup.bcde13ffa787":"4. Move an active Employee","setup.3f166caa4c6e":"Moving a Person checks both the source and destination hierarchy. An active Team cannot lose its final Employee.","setup.30ea00111c68":"Destination Unit","setup.02a1e9784593":"Destination Team","setup.570e386efab1":"Move Employee","setup.1b49152e4788":"5. Promote a Team Lead","setup.e488f7f800fa":"Select an Employee in the Team and explicitly choose what happens to its current Lead.","setup.8e7f709a7389":"New Lead","setup.dae130a650d0":"Previous Lead","setup.769239f13d47":"Choose an action","setup.37151d5cbd27":"Become an Employee in this Team","setup.fb1e6fa55327":"Deactivate","setup.d6cd69253434":"Promote Team Lead","setup.f3678e50bf1f":"6. Promote a Manager","setup.a334915143a6":"Select an Employee in the Unit and explicitly choose what happens to its current Manager.","setup.760c291a907f":"New Manager","setup.4889a4903a10":"Previous Manager","setup.da395b278f6b":"Become a direct Employee in this Unit","setup.a238ed9e5ac3":"Promote Manager","setup.e97f86e7295d":"7. HR and HRBP scope","setup.e44b897caea4":"Select one or more Units for HR, or selected Units or all Units for HRBP. Draft assignments remain pending until activation. To clear a draft scope before correcting its role, choose Selected Units, deselect every Unit, and save.","setup.28da8c1f9ede":"Advisor","setup.b073f6c68ef8":"Scope","setup.00775121af1d":"Selected Units","setup.e5d878b1ace0":"All Units","setup.9fb6669a77ea":"Units","setup.c28801f5bad6":"Save scope","setup.f33e3a0d3abe":"8. Company Admin access","setup.15695bd78373":"Grant or revoke setup access. A new administrator also needs their corporate SSO identity linked by an operator before sign-in.","setup.8693768c7e08":"Grant access","setup.ab292ddb87d6":"Revoke access","setup.52dd1412b028":"9. Deactivate a Person","setup.cd762c97e67b":"Employee, HR, HRBP, and Leadership can be deactivated when the active hierarchy remains valid. Replace a Team Lead or Manager through a promotion first.","setup.de34505b6e99":"Active Person","setup.23b6d977feee":"Deactivate Person","setup.13f06a72aeae":"10. Deactivate a Team","setup.2e6fde7d1f4c":"Members become direct Employees of the same Unit. Choose what happens to the previous Team Lead.","setup.5cb5bd69dca9":"Become a direct Employee","setup.0c3dd6d42194":"Deactivate Team","setup.7a7a564decd4":"11. Transfer and deactivate a Unit","setup.2219b490c303":"Move its Teams, Employees, and advisor assignments into another active Unit. Choose what happens to the previous Manager.","setup.3fdc28f01267":"Source Unit","setup.b6a023aaf4a8":"Target Unit","setup.4be5d8b8a265":"Become a direct Employee in target Unit","setup.b96755edf9c8":"Transfer and deactivate Unit","setup.175739fd70c5":"12. Activate Units","setup.cab11deda4b5":"Select one or more Units. All selected Units must pass structural checks; ready Persons activate together, while unlinked Persons remain draft.","setup.1e2cac582fd3":"Check readiness","setup.9ded7e1fc0a7":"Activate selected Units","setup.4fd596cf578a":"Company report language","setup.868df5ddbc43":"Language for future report formation. Personal chat and onboarding language are unchanged.","setup.6bdc544210bd":"Language tag (for example en or de-DE)","setup.b61b06a98d8f":"Save report language","setup.b9de9b6ebfee":"Work calendar","setup.ae53bf97f697":"First-contact delivery","setup.7ab647c1efc1":"Pending and failed messages are retried by the worker. A message left in sending needs delivery verification before any manual retry.","setup.ad8a0dac00a2":"Onboarding progress","setup.dda128f91883":"Aggregate counts per Unit. Groups under 5 people are hidden.","setup.9a593237fa2e":"Current hierarchy","setup.7d53affc21d3":"Enter a supported language tag, for example en or de-DE.","setup.870019643bf2":"Company settings changed. Refresh the page before saving again.","setup.cfce761befa8":"Request failed","setup.917b44c0324e":"No assignment yet","setup.bfda026e6c59":"Linked","setup.f14586de7cf1":"Missing Slack","setup.8c196517bc71":"  Manager","setup.f550ec45eba5":"  Direct Employee","setup.156e80e5b599":"pending assignment","setup.8a2585678943":"active assignment","setup.c25c46ee0d88":"  Team","setup.d74c458b8678":"    Team Lead","setup.0421a5484892":"    Employee","setup.4310076fa4ee":"Outside line hierarchy","setup.1709305c9fa9":"Level","setup.99a52df3ff3d":"Key","setup.920e413c7d41":"Status","setup.b27fb38ba323":"Slack","setup.0f170b12f4cb":"The company work calendar is not configured. Contact enTalent to finish report setup.","setup.e35987ce2a9a":"The company work calendar needs review by enTalent.","setup.d5c5c13b3589":"Choose a supported report language to finish setup.","setup.4fb9cf2094b8":"Company settings need review. Contact enTalent before forming reports.","setup.98c0636a5c68":"Report setup needs review.","setup.3feced40135b":"Report configuration ready.","setup.30608890f50b":"The work calendar is not configured by enTalent. Unit rollout is blocked until enTalent configures it.","setup.c81415417617":"Configured by enTalent: ","setup.00ab6bc2587a":". Date overrides: ","setup.661ff40a07e0":"Queued","setup.0d9575c5def0":"Sending · verify before retry","setup.906115657390":"Delivered","setup.d59124a421fc":"Failed · retry scheduled","setup.d353a99eb455":"Cancelled","setup.a3b50c476732":"State","setup.06e70139fcf5":"Attempts","setup.967533ec1d19":"Last attempt","setup.a2198f472ce2":"Onboarding","setup.3bdc171c5193":"Hidden for groups under 5 people","setup.17afb982142e":"Onboarding: ","setup.e7c361f180d7":" in progress","setup.6c2dfbc0adcb":" Persons · ","setup.074a76b81c2d":" Units · ","setup.8cfbc7bc3d22":" Teams","setup.87bb59ba2f92":"Workspace","setup.1d594faa1256":"Email matching","setup.5fa7aac5375c":"Ready","setup.0f9097930235":"Needs users:read.email","setup.5474eef8d0f1":"Working…","setup.e0847c0a78c0":"Enter a valid tenant UUID","setup.538273c3aea9":"Company report language saved.","setup.b84d3b3ae113":"Hierarchy refreshed.","setup.46d415174149":" rows ready to import.","setup.c07e1a72d83b":"Preview passed.","setup.95110d74c4c0":"Row","setup.f45fc1dfdc96":"Field","setup.48dc76dfa23a":"Issue","setup.9143afbb4dbd":"Preview the current CSV first","setup.9465031def6c":"Imported ","setup.be997844b2a8":"Draft saved.","setup.c69f7ecd28d9":"Select a draft ","setup.d5c0e60cce93":"Draft updated.","setup.a04f573fe2cf":"Select a draft Employee","setup.3f12bd38d8b0":"Draft assignment saved.","setup.8cdd7b1d517e":"Slack identity linked.","setup.d0d50b51121e":"Match needs review: ","setup.b25d8677657d":"Select a draft Person and workspace","setup.1a26b30c0291":"Slack account unlinked and reserved until reassigned.","setup.2bd1af561ac0":"Select an active Employee and destination Unit","setup.ba25e295cd94":"Employee moved.","setup.9ad6027f2b24":"Select a Team, Employee, and action for the previous Lead","setup.cf24f305291f":"Team Lead promoted.","setup.56a6952d8494":"Select a Unit, Employee, and action for the previous Manager","setup.a71f8d809fbf":"Manager promoted.","setup.983b1b2ce4f9":"Select an HR or HRBP Person","setup.bb44e19b626b":"Advisor scope saved.","setup.907d5e259411":"Select an active Person","setup.e1b9b1a9e644":"Deactivate this Person and stop new activity?","setup.ecdb00c288ac":"Person deactivated.","setup.dfd87f29a814":"Select an active Team and action for its Lead","setup.e7dc0b439622":"Deactivate this Team and move ","setup.5856474d5418":" active Employees directly to its Unit?","setup.df238594dd76":"Team deactivated.","setup.83815ff86cb9":"Select source and target Units and action for the previous Manager","setup.65733f5541ad":"Transfer ","setup.5a4b78d01f19":" Teams and ","setup.0a2d8b9481af":" Employee placements to the target Unit, then deactivate the source Unit?","setup.f9d32c6a43ff":"Unit transferred and deactivated.","setup.e3a8f32d6f81":"Select a Person","setup.e2c236a1f014":"Company Admin access granted.","setup.a221c63ec750":"Company Admin access revoked.","setup.724b01414119":"Select Units and a Slack workspace","setup.79ee0149d593":"Ready Persons","setup.46323f7bf2cb":"Other pending","setup.5e7754e283a3":"Already active","setup.666067dd376e":"Issues","setup.dc937b598926":"None","setup.4ed4d2d275dd":"Selected Units are ready for rollout.","setup.fd8f561a6732":"The work calendar is not configured by enTalent. Rollout is blocked until it is set.","setup.5aed8707e2bd":"Resolve structural issues before rollout.","setup.1c9fec524758":"Check readiness for these Units first","setup.46f6c51f7ff1":"Activate ","setup.0c1cc94e291a":" selected Unit(s) and queue first contact for ready Persons?","setup.306929552816":"Activated ","setup.268e1b7ded7a":" Persons across ","setup.e1e0fda4563f":" Units.","setup.e8440b52c3a3":"Tenant ","setup.de9302825c7d":"Configured by enTalent: {arg0}, days {arg1}, {arg2}-{arg3}. Holidays: {arg4}. Date overrides: {arg5}.","setup.b269281a4aaa":"Onboarding: {arg0} delivered, {arg1} completed, {arg2} in progress","setup.c2aaa918df3a":"{arg0} Persons · {arg1} Units · {arg2} Teams","setup.c04fcf3a7696":"{arg0} rows ready to import.","setup.da1140bf1eb7":"Imported {arg0} draft Persons.","setup.2c33adada975":"Select a draft {arg0}","setup.ccdf5345b040":"Match needs review: {arg0}","setup.df460806c635":"Deactivate this Team and move {arg0} active Employees directly to its Unit?","setup.529e3c5c3b68":"Transfer {arg0} Teams and {arg1} Employee placements to the target Unit, then deactivate the source Unit?","setup.da72602a240e":"Activate {arg0} selected Unit(s) and queue first contact for ready Persons?","setup.7e6e18768ede":"Activated {arg0} Persons across {arg1} Units.","setup.45c187856ebc":"Tenant {arg0} · Admin {arg1}","setup.lifecycle.active":"Active","setup.lifecycle.draft":"Draft","setup.lifecycle.inactive":"Inactive","setup.person_status":"{lifecycle} · {assignment}","setup.hierarchy_status":"{lifecycle} · {active} active / {pending} pending Employees"};
let companyLanguage = {locale:'en',status:'ready',resources:{}};
function t(key, values) {
 const resource=companyLanguage.resources.admin;
 const source=companyLanguage.locale==='en' ? englishCopy[key] : resource && resource.texts[key];
 if(typeof source!=='string') throw new Error('language_unavailable');
 return source.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_,slot)=>{if(!values || !(slot in values)) throw new Error('language_interpolation_missing');return typeof values[slot]==='number' ? new Intl.NumberFormat(companyLanguage.locale).format(values[slot]) : String(values[slot]);});
}
function applyCompanyLanguage(language) {
 if (!language || language.status!=='ready') {
  companyLanguage={locale:'en',status:'ready',resources:{}};
  document.documentElement.lang='en'; document.title='Company language unavailable · enTalent';
  el('app').hidden=true; el('login').hidden=true; el('language-recovery').hidden=false;
  const notice=el('language-unavailable-notice');notice.dataset.languageStatus='language_unavailable';
  notice.textContent='Language unavailable: '+(language?.locale || 'unknown')+'. Your session is active. Save a company language with accepted resources to continue.';
  el('language-recovery-locale').value=language?.locale || '';
  return false;
 }
 companyLanguage=language; el('language-recovery').hidden=true;el('app').hidden=false;el('login').hidden=true;
 document.documentElement.lang=language.locale; document.title=t("setup.c9bfc5e1b04c");
 document.querySelectorAll('[data-copy-key]').forEach(node=>{node.textContent=t(node.dataset.copyKey);});
 return true;
}

const base = '/api/v1/company-setup';
let csrf = '';
let snapshot = null;
let previewedCsv = null;
let previewedRollout = null;
const el = (id) => document.getElementById(id);
const value = (id) => el(id).value;
const rolloutUnitIds = () => [...el('rollout-unit').selectedOptions].map((option) => option.value).sort();
const rolloutKey = (unitIds, workspaceId) => JSON.stringify([unitIds, workspaceId]);
function message(text, error) { const node = el(el('app').hidden ? 'language-recovery-status' : 'status'); node.textContent = text; node.className = error ? 'error' : 'success'; }
async function api(path, method, body) {
  const options = { method: method || 'GET', credentials: 'same-origin', headers: {} };
  if (body !== undefined) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
  if (options.method !== 'GET') options.headers['x-csrf-token'] = csrf;
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const copy = { invalid_locale: t("setup.7d53affc21d3"), stale_config_revision: t("setup.870019643bf2") };
    const error = new Error(copy[data.code] || data.message || data.code || t("setup.cfce761befa8")); error.data = data; throw error;
  }
  return data;
}
function option(select, label, id) { const item = document.createElement('option'); item.value = id; item.textContent = label; select.append(item); }
function fill(selectId, rows, label, optional) {
  const select = el(selectId); select.replaceChildren();
  if (optional) option(select, t("setup.917b44c0324e"), '');
  rows.forEach((row) => option(select, label(row), row.id || row.externalWorkspaceId));
}
function table(container, columns, rows) {
  const node = document.createElement('table'); const head = document.createElement('thead'); const hr = document.createElement('tr');
  columns.forEach((column) => { const th = document.createElement('th'); th.textContent = column[0]; hr.append(th); });
  head.append(hr); node.append(head); const body = document.createElement('tbody');
  rows.forEach((row) => { const tr = document.createElement('tr'); columns.forEach((column) => {
    const td = document.createElement('td'); td.textContent = String(column[1](row) ?? ''); tr.append(td);
  }); body.append(tr); }); node.append(body); container.replaceChildren(node);
}
function lifecycleLabel(value) {
 return ['active','draft','inactive'].includes(value) ? t('setup.lifecycle.'+value) : t('ui.language_unavailable');
}
function renderHierarchy(data) {
  const persons = new Map(data.persons.map((person) => [person.id, person]));
  const links = new Set(data.slackLinks.map((link) => link.userId));
  const rows = [];
  const shown = new Set();
  const sortByName = (a, b) => a.name.localeCompare(b.name);
  function personRow(level, id, assignmentStatus) {
    const person = persons.get(id);
    if (!person) return;
    shown.add(id);
    rows.push({ level, name: person.displayName, key: person.customerEmployeeId,
      status: assignmentStatus ? t('setup.person_status',{lifecycle:lifecycleLabel(person.lifecycleStatus),assignment:assignmentStatus}) : lifecycleLabel(person.lifecycleStatus),
      slack: links.has(id) ? t("setup.bfda026e6c59") : t("setup.f14586de7cf1") });
  }
  for (const unit of [...data.units].sort((a, b) => a.customerUnitKey.localeCompare(b.customerUnitKey))) {
    const unitPlacements = data.placements.filter((placement) =>
      placement.unitId === unit.id && placement.lifecycleStatus !== 'inactive');
    const activeCount = unitPlacements.filter((placement) => placement.lifecycleStatus === 'active' &&
      persons.get(placement.employeePersonId)?.lifecycleStatus === 'active').length;
    const pendingCount = unitPlacements.length - activeCount;
    rows.push({ level: t("setup.4e545960f1bf"), name: unit.name, key: unit.customerUnitKey,
      status: t('setup.hierarchy_status',{lifecycle:lifecycleLabel(unit.lifecycleStatus),active:activeCount,pending:pendingCount}), slack: '' });
    personRow(t("setup.8c196517bc71"), unit.managerPersonId);
    for (const placement of unitPlacements.filter((item) => item.teamId === null)
      .sort((a, b) => (persons.get(a.employeePersonId)?.displayName || '').localeCompare(persons.get(b.employeePersonId)?.displayName || ''))) {
      personRow(t("setup.f550ec45eba5"), placement.employeePersonId,
        placement.lifecycleStatus === 'draft' ? t("setup.156e80e5b599") : t("setup.8a2585678943"));
    }
    for (const team of data.teams.filter((item) => item.unitId === unit.id)
      .sort((a, b) => a.customerTeamKey.localeCompare(b.customerTeamKey))) {
      const members = unitPlacements.filter((placement) => placement.teamId === team.id);
      const activeMembers = members.filter((placement) => placement.lifecycleStatus === 'active' &&
        persons.get(placement.employeePersonId)?.lifecycleStatus === 'active').length;
      rows.push({ level: t("setup.c25c46ee0d88"), name: team.name, key: team.customerTeamKey,
        status: t('setup.hierarchy_status',{lifecycle:lifecycleLabel(team.lifecycleStatus),active:activeMembers,pending:members.length-activeMembers}), slack: '' });
      personRow(t("setup.d74c458b8678"), team.teamLeadPersonId);
      for (const placement of members.sort((a, b) =>
        (persons.get(a.employeePersonId)?.displayName || '').localeCompare(persons.get(b.employeePersonId)?.displayName || ''))) {
        personRow(t("setup.0421a5484892"), placement.employeePersonId,
          placement.lifecycleStatus === 'draft' ? t("setup.156e80e5b599") : t("setup.8a2585678943"));
      }
    }
  }
  for (const person of data.persons.filter((item) => !shown.has(item.id))
    .map((item) => ({ ...item, name: item.displayName })).sort(sortByName)) {
    rows.push({ level: t("setup.4310076fa4ee"), name: person.displayName,
      key: person.customerEmployeeId + ' · ' + person.primaryRole,
      status: lifecycleLabel(person.lifecycleStatus), slack: links.has(person.id) ? t("setup.bfda026e6c59") : t("setup.f14586de7cf1") });
  }
  table(el('hierarchy'), [[t("setup.1709305c9fa9"), (row) => row.level], [t("setup.dcd1d5223f73"), (row) => row.name],
    [t("setup.99a52df3ff3d"), (row) => row.key], [t("setup.920e413c7d41"), (row) => row.status], [t("setup.b27fb38ba323"), (row) => row.slack]], rows);
}
function renderCalendar(data) {
  const config=data.reportConfiguration;
  el('report-locale').value=config?.locale || '';
  const readinessCopy = { missing_calendar: t("setup.0f170b12f4cb"), invalid_calendar: t("setup.e35987ce2a9a"), invalid_locale: t("setup.d5c5c13b3589"), source_out_of_sync: t("setup.4fb9cf2094b8") };
  el('report-language-status').textContent=config?.unavailableReason ? (readinessCopy[config.unavailableReason] || t("setup.98c0636a5c68")) : t("setup.3feced40135b");
  const node = el('work-calendar');
  if (!data.calendarConfigured) { node.className = 'error'; node.textContent = t("setup.30608890f50b"); return; }
  const c = config?.calendar;
  if (!c || config.unavailableReason === 'source_out_of_sync') { node.className = 'error'; node.textContent = t("setup.e35987ce2a9a"); return; }
  node.className = 'muted';
  node.textContent = t("setup.de9302825c7d",{arg0:c.timezone,arg1:c.workingDays.join(','),arg2:c.workStart,arg3:c.workEnd,arg4:(c.holidays || []).join(', '),arg5:(c.dateOverrides || []).map(o => o.date + ' ' + (o.kind === 'closed' ? 'closed' : o.workStart + '-' + o.workEnd)).join(', ')});
}
function renderDeliveries(data) {
  const persons = new Map(data.persons.map((person) => [person.id, person]));
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const labels = { pending: t("setup.661ff40a07e0"), sending: t("setup.0d9575c5def0"),
    delivered: t("setup.906115657390"), failed: t("setup.d59124a421fc"), cancelled: t("setup.d353a99eb455") };
  table(el('onboarding-deliveries'), [[t("setup.6007db63e18e"), (row) => persons.get(row.personId)?.displayName || row.personId],
    [t("setup.4e545960f1bf"), (row) => units.get(row.unitId)?.name || row.unitId],
    [t("setup.a3b50c476732"), (row) => labels[row.status] || row.status],
    [t("setup.06e70139fcf5"), (row) => row.attemptCount],
    [t("setup.967533ec1d19"), (row) => row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString(companyLanguage.locale,{timeZone:snapshot?.calendar?.timezone || 'UTC'}) : '—'],
    [t("setup.906115657390"), (row) => row.deliveredAt ? new Date(row.deliveredAt).toLocaleString(companyLanguage.locale,{timeZone:snapshot?.calendar?.timezone || 'UTC'}) : '—']], data.deliveries);
}
function renderOnboardingSummary(data) {
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  table(el('onboarding-summary'), [[t("setup.4e545960f1bf"), (row) => units.get(row.unitId)?.name || row.unitId],
    [t("setup.a2198f472ce2"), (row) => row.suppressed ? t("setup.3bdc171c5193")
      : t("setup.b269281a4aaa",{arg0:row.delivered,arg1:row.completed,arg2:row.inProgress})]], data.onboardingSummary);
}
async function refresh() {
  snapshot = await api(base + '/snapshot');
  if (!applyCompanyLanguage(snapshot.companyLanguage)) return;
  previewedRollout = null; el('rollout').disabled = true;
  el('counts').textContent = t("setup.c2aaa918df3a",{arg0:snapshot.persons.length,arg1:snapshot.units.length,arg2:snapshot.teams.length});
  fill('unit-manager', snapshot.persons.filter((p) => p.primaryRole === 'manager' && p.lifecycleStatus !== 'inactive'), (p) => p.displayName + ' · ' + p.customerEmployeeId, true);
  fill('team-lead', snapshot.persons.filter((p) => p.primaryRole === 'team_lead' && p.lifecycleStatus !== 'inactive'), (p) => p.displayName + ' · ' + p.customerEmployeeId, true);
  fill('team-unit', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'), (u) => u.name + ' · ' + u.customerUnitKey, false);
  fill('edit-person', snapshot.persons.filter((p) => p.lifecycleStatus === 'draft'), (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
  fill('edit-unit', snapshot.units.filter((u) => u.lifecycleStatus === 'draft'), (u) => u.name + ' · ' + u.customerUnitKey, false);
  fill('edit-team', snapshot.teams.filter((t) => t.lifecycleStatus === 'draft'), (t) => t.name + ' · ' + t.customerTeamKey, false);
  fill('edit-unit-manager', snapshot.persons.filter((p) => p.primaryRole === 'manager' && p.lifecycleStatus !== 'inactive'), (p) => p.displayName + ' · ' + p.customerEmployeeId, true);
  fill('edit-team-lead', snapshot.persons.filter((p) => p.primaryRole === 'team_lead' && p.lifecycleStatus !== 'inactive'), (p) => p.displayName + ' · ' + p.customerEmployeeId, true);
  fill('edit-team-unit', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'), (u) => u.name + ' · ' + u.customerUnitKey, false);
  loadEditDraft('person'); loadEditDraft('unit'); loadEditDraft('team');
  fill('draft-placement-person', snapshot.persons.filter((p) => p.lifecycleStatus === 'draft' && p.primaryRole === 'employee'),
    (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
  fill('draft-placement-unit', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'),
    (u) => u.name + ' · ' + u.customerUnitKey, true);
  loadDraftPlacement();
  fill('rollout-unit', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'), (u) => u.name + ' · ' + lifecycleLabel(u.lifecycleStatus), false);
  fill('move-person', snapshot.persons.filter((p) => p.primaryRole === 'employee' && p.lifecycleStatus === 'active'), (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
  fill('admin-person', snapshot.persons.filter((p) => p.lifecycleStatus !== 'inactive'), (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
  fill('move-unit', snapshot.units.filter((u) => u.lifecycleStatus === 'active'), (u) => u.name + ' · ' + u.customerUnitKey, false);
  fillMoveTeams();
  fill('promote-team', snapshot.teams.filter((t) => t.lifecycleStatus === 'active'), (t) => t.name + ' · ' + t.customerTeamKey, false);
  fillPromotePeople();
  fill('promote-unit', snapshot.units.filter((u) => u.lifecycleStatus === 'active'), (u) => u.name + ' · ' + u.customerUnitKey, false);
  fillPromoteManagerPeople();
  fill('advisor-person', snapshot.persons.filter((p) => ['hr', 'hrbp'].includes(p.primaryRole) && p.lifecycleStatus !== 'inactive'),
    (p) => p.displayName + ' · ' + p.primaryRole, false);
  fillAdvisorScope();
  fill('deactivate-person', snapshot.persons.filter((p) => p.lifecycleStatus === 'active' &&
    ['employee', 'hr', 'hrbp', 'leadership'].includes(p.primaryRole)),
    (p) => p.displayName + ' · ' + p.primaryRole, false);
  fill('deactivate-team', snapshot.teams.filter((t) => t.lifecycleStatus === 'active'),
    (t) => t.name + ' · ' + t.customerTeamKey, false);
  fill('deactivate-unit', snapshot.units.filter((u) => u.lifecycleStatus === 'active'),
    (u) => u.name + ' · ' + u.customerUnitKey, false);
  fillDeactivateTargetUnits();
  fill('link-person', snapshot.persons.filter((p) => p.lifecycleStatus === 'draft'), (p) => p.displayName + ' · ' + lifecycleLabel(p.lifecycleStatus), false);
  const workspaces = snapshot.workspaces.filter((w) => w.channelType === 'slack' && w.status === 'active');
  table(el('workspaces'), [[t("setup.87bb59ba2f92"), (w) => w.externalWorkspaceId], [t("setup.920e413c7d41"), (w) => w.status],
    [t("setup.1d594faa1256"), (w) => Array.isArray(w.scopes) && w.scopes.includes('users:read.email') ? t("setup.5fa7aac5375c") : t("setup.0f9097930235")]], snapshot.workspaces.filter((w) => w.channelType === 'slack'));
  fill('link-workspace', workspaces, (w) => w.externalWorkspaceId, false);
  fill('rollout-workspace', workspaces, (w) => w.externalWorkspaceId, false);
  renderHierarchy(snapshot);
  renderCalendar(snapshot);
  renderDeliveries(snapshot);
  renderOnboardingSummary(snapshot);
}
function loadEditDraft(kind) {
  if (!snapshot) return;
  const id = value('edit-' + kind);
  const rows = kind === 'person' ? snapshot.persons : kind === 'unit' ? snapshot.units : snapshot.teams;
  const row = rows.find((item) => item.id === id);
  const form = el('edit-' + kind + '-form');
  for (const field of form.elements) {
    if (!field.name) continue;
    field.value = row ? (row[field.name] ?? '') : '';
  }
}
function fillDraftPlacementTeams() {
  if (!snapshot) return;
  fill('draft-placement-team', snapshot.teams.filter((t) =>
    t.unitId === value('draft-placement-unit') && t.lifecycleStatus !== 'inactive'),
    (t) => t.name + ' · ' + t.customerTeamKey, true);
}
function loadDraftPlacement() {
  if (!snapshot) return;
  const placement = snapshot.placements.find((p) =>
    p.employeePersonId === value('draft-placement-person') && p.lifecycleStatus === 'draft');
  el('draft-placement-unit').value = placement?.unitId || '';
  fillDraftPlacementTeams();
  el('draft-placement-team').value = placement?.teamId || '';
}
function fillMoveTeams() {
  if (!snapshot) return;
  fill('move-team', snapshot.teams.filter((t) => t.unitId === value('move-unit') && t.lifecycleStatus === 'active'),
    (t) => t.name + ' · ' + t.customerTeamKey, true);
}
function fillPromotePeople() {
  if (!snapshot) return;
  const teamId = value('promote-team');
  const ids = new Set(snapshot.placements.filter((p) => p.teamId === teamId && p.lifecycleStatus === 'active').map((p) => p.employeePersonId));
  fill('promote-person', snapshot.persons.filter((p) => ids.has(p.id) && p.primaryRole === 'employee' && p.lifecycleStatus === 'active'),
    (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
}
function fillPromoteManagerPeople() {
  if (!snapshot) return;
  const unitId = value('promote-unit');
  const ids = new Set(snapshot.placements.filter((p) => p.unitId === unitId && p.lifecycleStatus === 'active').map((p) => p.employeePersonId));
  fill('promote-manager-person', snapshot.persons.filter((p) => ids.has(p.id) && p.primaryRole === 'employee' && p.lifecycleStatus === 'active'),
    (p) => p.displayName + ' · ' + p.customerEmployeeId, false);
}
function fillAdvisorScope() {
  if (!snapshot) return;
  const person = snapshot.persons.find((p) => p.id === value('advisor-person'));
  const scope = snapshot.hrbpScopes.find((row) => row.personId === person?.id);
  el('advisor-mode').value = person?.primaryRole === 'hrbp' ? scope?.scopeMode || 'selected_units' : 'selected_units';
  el('advisor-mode').disabled = person?.primaryRole !== 'hrbp';
  fill('advisor-units', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'),
    (u) => u.name + ' · ' + u.customerUnitKey, false);
  const assigned = new Set(snapshot.advisorAssignments.filter((row) =>
    row.advisorPersonId === person?.id && row.lifecycleStatus !== 'inactive').map((row) => row.unitId));
  for (const option of el('advisor-units').options) option.selected = assigned.has(option.value);
  el('advisor-units').disabled = value('advisor-mode') === 'all_units';
}
function fillDeactivateTargetUnits() {
  if (!snapshot) return;
  fill('deactivate-unit-target', snapshot.units.filter((u) => u.lifecycleStatus === 'active' &&
    u.id !== value('deactivate-unit')), (u) => u.name + ' · ' + u.customerUnitKey, false);
}
async function run(task) { try { message(t("setup.5474eef8d0f1"), false); await task(); } catch (error) {
  const details = error.data && error.data.errors ? ': ' + error.data.errors.map((e) => 'row ' + e.rowNumber + ' ' + e.field + ' ' + e.code).join('; ') : '';
  message(error.message + details, true);
} }
el('sign-in').addEventListener('click', () => {
  const id = value('tenant-id').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) { alert(t("setup.e0847c0a78c0")); return; }
  location.assign('/api/v1/company-auth/start/' + encodeURIComponent(id));
});
el('language-recovery-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await api(base + '/company-language','POST',{locale:value('language-recovery-locale'),expectedConfigRevision:snapshot.reportConfiguration.revision});
  await refresh(); message(t("setup.538273c3aea9"),false);
}); });
el('report-language-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await api(base + '/company-language','POST',{locale:value('report-locale'),expectedConfigRevision:snapshot.reportConfiguration.revision});
  await refresh(); message(t("setup.538273c3aea9"),false);
}); });
el('refresh').addEventListener('click', () => run(async () => { await refresh(); message(t("setup.b84d3b3ae113"), false); }));
el('logout').addEventListener('click', () => run(async () => { await api('/api/v1/company-auth/logout', 'POST'); location.reload(); }));
el('csv-file').addEventListener('change', async (event) => { const file = event.target.files[0]; if (file) { el('csv').value = await file.text(); previewedCsv = null; el('import').disabled = true; } });
el('csv').addEventListener('input', () => { previewedCsv = null; el('import').disabled = true; });
el('preview').addEventListener('click', () => run(async () => {
  const csv = value('csv'); const result = await api(base + '/csv/preview', 'POST', { csv });
  previewedCsv = result.ok ? csv : null; el('import').disabled = !result.ok;
  if (result.ok) { el('preview-result').textContent = t("setup.c04fcf3a7696",{arg0:result.rows.length}); message(t("setup.c07e1a72d83b"), false); }
  else { table(el('preview-result'), [[t("setup.95110d74c4c0"), (e) => e.rowNumber], [t("setup.f45fc1dfdc96"), (e) => e.field], [t("setup.48dc76dfa23a"), (e) => e.message]], result.errors); message(result.errors.length + ' issue(s) found.', true); }
}));
el('import').addEventListener('click', () => run(async () => {
  if (previewedCsv !== value('csv')) throw new Error(t("setup.9143afbb4dbd"));
  const result = await api(base + '/csv/import', 'POST', { csv: previewedCsv });
  previewedCsv = null; el('import').disabled = true; await refresh();
  message(t("setup.da1140bf1eb7",{arg0:result.personIds.length}), false);
}));
for (const spec of [['person-form','/persons'],['unit-form','/units'],['team-form','/teams']]) {
  el(spec[0]).addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
    const data = Object.fromEntries(new FormData(event.target).entries());
    await api(base + spec[1], 'POST', data); event.target.reset(); await refresh(); message(t("setup.be997844b2a8"), false);
  }); });
}
for (const kind of ['person', 'unit', 'team']) {
  el('edit-' + kind).addEventListener('change', () => loadEditDraft(kind));
  el('edit-' + kind + '-form').addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
    const id = value('edit-' + kind); if (!id) throw new Error(t("setup.2c33adada975",{arg0:kind}));
    const data = Object.fromEntries(new FormData(event.target).entries());
    await api(base + '/' + kind + 's/' + encodeURIComponent(id) + '/draft', 'POST', data);
    await refresh(); message(t("setup.d5c0e60cce93"), false);
  }); });
}
el('draft-placement-person').addEventListener('change', loadDraftPlacement);
el('draft-placement-unit').addEventListener('change', fillDraftPlacementTeams);
el('draft-placement-save').addEventListener('click', () => run(async () => {
  const personId = value('draft-placement-person'); if (!personId) throw new Error(t("setup.a04f573fe2cf"));
  await api(base + '/persons/' + encodeURIComponent(personId) + '/draft-placement', 'POST',
    { targetUnitId: value('draft-placement-unit') || null, targetTeamId: value('draft-placement-team') || null });
  await refresh(); message(t("setup.3f12bd38d8b0"), false);
}));
el('link-email').addEventListener('click', () => run(async () => {
  const result = await api(base + '/persons/' + encodeURIComponent(value('link-person')) + '/slack/email', 'POST', { workspaceId: value('link-workspace') });
  await refresh(); message(result.status === 'matched' ? t("setup.8cdd7b1d517e") : t("setup.ccdf5345b040",{arg0:result.status}), result.status !== 'matched');
}));
el('link-manual').addEventListener('click', () => run(async () => {
  await api(base + '/persons/' + encodeURIComponent(value('link-person')) + '/slack/manual', 'POST', { workspaceId: value('link-workspace'), externalUserId: value('slack-user-id') });
  await refresh(); message(t("setup.8cdd7b1d517e"), false);
}));
el('unlink').addEventListener('click', () => run(async () => {
  const personId = value('link-person'); const workspaceId = value('link-workspace');
  if (!personId || !workspaceId) throw new Error(t("setup.b25d8677657d"));
  await api(base + '/persons/' + encodeURIComponent(personId) + '/slack/unlink', 'POST', { workspaceId });
  await refresh(); message(t("setup.1a26b30c0291"), false);
}));
el('move-unit').addEventListener('change', fillMoveTeams);
el('move').addEventListener('click', () => run(async () => {
  const personId = value('move-person'); const targetUnitId = value('move-unit');
  if (!personId || !targetUnitId) throw new Error(t("setup.2bd1af561ac0"));
  await api(base + '/persons/' + encodeURIComponent(personId) + '/move', 'POST',
    { targetUnitId, targetTeamId: value('move-team') || null });
  await refresh(); message(t("setup.ba25e295cd94"), false);
}));
el('promote-team').addEventListener('change', fillPromotePeople);
el('promote-lead').addEventListener('click', () => run(async () => {
  const teamId = value('promote-team'); const employeePersonId = value('promote-person');
  const previousLeadAction = value('previous-lead-action');
  if (!teamId || !employeePersonId || !previousLeadAction) throw new Error(t("setup.9ad6027f2b24"));
  await api(base + '/teams/' + encodeURIComponent(teamId) + '/promote-lead', 'POST', { employeePersonId, previousLeadAction });
  el('previous-lead-action').value = ''; await refresh(); message(t("setup.cf24f305291f"), false);
}));
el('promote-unit').addEventListener('change', fillPromoteManagerPeople);
el('promote-manager').addEventListener('click', () => run(async () => {
  const unitId = value('promote-unit'); const employeePersonId = value('promote-manager-person');
  const previousManagerAction = value('previous-manager-action');
  if (!unitId || !employeePersonId || !previousManagerAction) throw new Error(t("setup.56a6952d8494"));
  await api(base + '/units/' + encodeURIComponent(unitId) + '/promote-manager', 'POST', { employeePersonId, previousManagerAction });
  el('previous-manager-action').value = ''; await refresh(); message(t("setup.a71f8d809fbf"), false);
}));
el('advisor-person').addEventListener('change', fillAdvisorScope);
el('advisor-mode').addEventListener('change', () => { el('advisor-units').disabled = value('advisor-mode') === 'all_units'; });
el('advisor-save').addEventListener('click', () => run(async () => {
  const personId = value('advisor-person'); if (!personId) throw new Error(t("setup.983b1b2ce4f9"));
  const scopeMode = value('advisor-mode');
  const unitIds = scopeMode === 'all_units' ? [] : Array.from(el('advisor-units').selectedOptions, (option) => option.value);
  await api(base + '/persons/' + encodeURIComponent(personId) + '/advisor-scope', 'POST', { scopeMode, unitIds });
  await refresh(); message(t("setup.bb44e19b626b"), false);
}));
el('deactivate-person-button').addEventListener('click', () => run(async () => {
  const personId = value('deactivate-person'); if (!personId) throw new Error(t("setup.907d5e259411"));
  if (!confirm(t("setup.e1b9b1a9e644"))) return;
  await api(base + '/persons/' + encodeURIComponent(personId) + '/deactivate', 'POST');
  await refresh(); message(t("setup.ecdb00c288ac"), false);
}));
el('deactivate-team-button').addEventListener('click', () => run(async () => {
  const teamId = value('deactivate-team'); const leadAction = value('deactivate-team-lead-action');
  if (!teamId || !leadAction) throw new Error(t("setup.dfd87f29a814"));
  const memberCount = snapshot.placements.filter((p) => p.teamId === teamId && p.lifecycleStatus === 'active').length;
  if (!confirm(t("setup.df460806c635",{arg0:memberCount}))) return;
  await api(base + '/teams/' + encodeURIComponent(teamId) + '/deactivate', 'POST', { leadAction });
  el('deactivate-team-lead-action').value = ''; await refresh(); message(t("setup.df238594dd76"), false);
}));
el('deactivate-unit').addEventListener('change', fillDeactivateTargetUnits);
el('deactivate-unit-button').addEventListener('click', () => run(async () => {
  const unitId = value('deactivate-unit'); const targetUnitId = value('deactivate-unit-target');
  const managerAction = value('deactivate-unit-manager-action');
  if (!unitId || !targetUnitId || !managerAction) throw new Error(t("setup.83815ff86cb9"));
  const teamCount = snapshot.teams.filter((t) => t.unitId === unitId && t.lifecycleStatus !== 'inactive').length;
  const memberCount = snapshot.placements.filter((p) => p.unitId === unitId && p.lifecycleStatus !== 'inactive').length;
  if (!confirm(t("setup.529e3c5c3b68",{arg0:teamCount,arg1:memberCount}))) return;
  await api(base + '/units/' + encodeURIComponent(unitId) + '/transfer-deactivate', 'POST', { targetUnitId, managerAction });
  el('deactivate-unit-manager-action').value = ''; await refresh(); message(t("setup.f9d32c6a43ff"), false);
}));
for (const spec of [['admin-grant','grant'],['admin-revoke','revoke']]) {
  el(spec[0]).addEventListener('click', () => run(async () => {
    const personId = value('admin-person'); if (!personId) throw new Error(t("setup.e3a8f32d6f81"));
    await api(base + '/persons/' + encodeURIComponent(personId) + '/company-admin/' + spec[1], 'POST');
    await refresh(); message(spec[1] === 'grant' ? t("setup.e2c236a1f014") : t("setup.a221c63ec750"), false);
  }));
}
for (const id of ['rollout-unit', 'rollout-workspace']) el(id).addEventListener('change', () => { previewedRollout = null; el('rollout').disabled = true; });
el('rollout-preview').addEventListener('click', () => run(async () => {
  const unitIds = rolloutUnitIds(); const workspaceId = value('rollout-workspace');
  if (!unitIds.length || !workspaceId) throw new Error(t("setup.724b01414119"));
  const preview = await api(base + '/units/rollout/preview', 'POST', { unitIds, workspaceId });
  previewedRollout = preview.ready ? rolloutKey(unitIds, workspaceId) : null; el('rollout').disabled = !preview.ready;
  const linked = new Set(snapshot.slackLinks.filter((link) => link.externalWorkspaceId === workspaceId).map((link) => link.userId));
  const people = new Map(snapshot.persons.map((person) => [person.id, person]));
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  table(el('rollout-result'), [[t("setup.4e545960f1bf"), (row) => units.get(row.unitId)?.name || row.unitId],
    [t("setup.79ee0149d593"), (row) => row.plan.activatePersonIds.filter((id) => people.get(id)?.lifecycleStatus === 'draft').length],
    [t("setup.f14586de7cf1"), (row) => row.plan.pendingPersonIds.filter((id) => !linked.has(id)).length],
    [t("setup.46323f7bf2cb"), (row) => row.plan.pendingPersonIds.filter((id) => linked.has(id)).length],
    [t("setup.5e7754e283a3"), (row) => row.plan.activatePersonIds.filter((id) => people.get(id)?.lifecycleStatus === 'active').length],
    [t("setup.666067dd376e"), (row) => row.plan.issues.map((issue) => issue.code + ': ' + issue.entityId).join('; ') || t("setup.dc937b598926")]], preview.units);
  const calendarBlocked = preview.units.some((row) => row.plan.issues.some((issue) => issue.code === 'work_calendar_not_configured'));
  message(preview.ready ? t("setup.4ed4d2d275dd") : calendarBlocked ? t("setup.fd8f561a6732") : t("setup.5aed8707e2bd"), !preview.ready);
}));
el('rollout').addEventListener('click', () => run(async () => {
  const unitIds = rolloutUnitIds(); const workspaceId = value('rollout-workspace');
  if (!unitIds.length || !workspaceId) throw new Error(t("setup.724b01414119"));
  if (previewedRollout !== rolloutKey(unitIds, workspaceId)) throw new Error(t("setup.1c9fec524758"));
  if (!confirm(t("setup.da72602a240e",{arg0:unitIds.length}))) return;
  const results = await api(base + '/units/rollout', 'POST', { unitIds, workspaceId });
  previewedRollout = null; el('rollout').disabled = true;
  await refresh(); message(t("setup.7e6e18768ede",{arg0:results.reduce((sum, row) => sum + row.activatedPersonIds.length, 0),arg1:results.length}), false);
}));
(async () => { try {
  const me = await api('/api/v1/company-auth/me'); csrf = me.csrfToken;
  el('identity').textContent = t("setup.45c187856ebc",{arg0:me.tenantId,arg1:me.personId});
  el('login').hidden = true; await refresh();
} catch (error) { el('login').hidden = false; const id = new URLSearchParams(location.search).get('tenantId'); if (id) el('tenant-id').value = id; } })();`;

@Controller('company-setup')
export class CompanySetupUiController {
  @Get('ui')
  ui(@Res() reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    reply.type('text/html; charset=utf-8').send(HTML);
  }

  @Get('ui.js')
  script(@Res() reply: FastifyReply): void {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.type('application/javascript; charset=utf-8').send(SCRIPT);
  }
}
