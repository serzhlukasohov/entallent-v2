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
#app[hidden],#login[hidden]{display:none}
</style></head><body>
<header><h1>enTalent · Company setup</h1><p>Prepare your hierarchy, connect Slack identities, and activate Units.</p></header>
<main>
<section class="card" id="login" hidden><h2>Corporate sign in</h2><p>Enter your company tenant ID to continue with your corporate identity provider.</p>
<label>Tenant ID<input id="tenant-id" autocomplete="off" placeholder="00000000-0000-0000-0000-000000000000"></label>
<button id="sign-in">Continue with SSO</button></section>
<section id="app" hidden>
<div class="card"><div class="grid"><div><h2>Setup overview</h2><p id="identity" class="muted"></p><p id="counts"></p></div><div><button id="refresh" class="secondary">Refresh</button><button id="logout" class="secondary">Sign out</button></div></div><p id="status" role="status"></p></div>
<div class="card"><h2>1. Import hierarchy</h2><p>Preview all detectable CSV errors before importing. Import is atomic and appends drafts.</p>
<label>CSV file<input id="csv-file" type="file" accept=".csv,text/csv"></label><label>CSV content<textarea id="csv" spellcheck="false"></textarea></label>
<button id="preview">Preview CSV</button><button id="import" disabled>Import drafts</button><div id="preview-result" class="scroll"></div></div>
<div class="card"><h2>2. Add individual drafts</h2><div class="grid">
<form id="person-form"><h3>Person</h3><label>Employee ID<input name="customerEmployeeId" required></label><label>Work email<input name="workEmail" type="email" required></label><label>Name<input name="displayName" required></label><label>Job title<input name="jobTitle"></label><label>Primary role<select name="primaryRole"><option value="employee">Employee</option><option value="team_lead">Team Lead</option><option value="manager">Manager</option><option value="hr">HR</option><option value="hrbp">HRBP</option><option value="leadership">Leadership</option></select></label><button>Add Person</button></form>
<form id="unit-form"><h3>Unit</h3><label>Unit key<input name="customerUnitKey" required></label><label>Name<input name="name" required></label><label>Manager<select name="managerPersonId" id="unit-manager"></select></label><button>Add Unit</button></form>
<form id="team-form"><h3>Team</h3><label>Team key<input name="customerTeamKey" required></label><label>Name<input name="name" required></label><label>Unit<select name="unitId" id="team-unit" required></select></label><label>Team Lead<select name="teamLeadPersonId" id="team-lead"></select></label><button>Add Team</button></form>
</div></div>
<div class="card"><h2>Edit drafts</h2><p>Choose a draft to load its fields. Active records use the operations below.</p><div class="grid">
<form id="edit-person-form"><h3>Person</h3><label>Draft Person<select id="edit-person"></select></label><label>Employee ID<input name="customerEmployeeId" required></label><label>Work email<input name="workEmail" type="email" required></label><label>Name<input name="displayName" required></label><label>Job title<input name="jobTitle"></label><label>Primary role<select name="primaryRole"><option value="employee">Employee</option><option value="team_lead">Team Lead</option><option value="manager">Manager</option><option value="hr">HR</option><option value="hrbp">HRBP</option><option value="leadership">Leadership</option></select></label><button>Save Person draft</button></form>
<form id="edit-unit-form"><h3>Unit</h3><label>Draft Unit<select id="edit-unit"></select></label><label>Unit key<input name="customerUnitKey" required></label><label>Name<input name="name" required></label><label>Manager<select name="managerPersonId" id="edit-unit-manager"></select></label><button>Save Unit draft</button></form>
<form id="edit-team-form"><h3>Team</h3><label>Draft Team<select id="edit-team"></select></label><label>Team key<input name="customerTeamKey" required></label><label>Name<input name="name" required></label><label>Unit<select name="unitId" id="edit-team-unit" required></select></label><label>Team Lead<select name="teamLeadPersonId" id="edit-team-lead"></select></label><button>Save Team draft</button></form>
</div></div>
<div class="card"><h2>Correct a draft Employee assignment</h2><p>Choose a Unit and optional Team, or leave Unit empty to remove the draft assignment. The Person remains draft.</p>
<div class="grid"><label>Draft Employee<select id="draft-placement-person"></select></label><label>Unit<select id="draft-placement-unit"></select></label><label>Team<select id="draft-placement-team"></select></label></div>
<button id="draft-placement-save">Save draft assignment</button></div>
<div class="card"><h2>3. Link Slack identities</h2><p>Automatic matching uses exact work email. Resolve missing or ambiguous matches manually.</p><div class="grid">
<label>Person<select id="link-person"></select></label><label>Slack workspace<select id="link-workspace"></select></label><label>Manual Slack user ID<input id="slack-user-id" placeholder="U…"></label></div>
<button id="link-email">Match by email</button><button id="link-manual" class="secondary">Link selected Slack user</button><button id="unlink" class="secondary">Unlink draft Person</button><div id="workspaces" class="scroll"></div></div>
<div class="card"><h2>4. Move an active Employee</h2><p>Moving a Person checks both the source and destination hierarchy. An active Team cannot lose its final Employee.</p>
<div class="grid"><label>Employee<select id="move-person"></select></label><label>Destination Unit<select id="move-unit"></select></label><label>Destination Team<select id="move-team"></select></label></div>
<button id="move">Move Employee</button></div>
<div class="card"><h2>5. Promote a Team Lead</h2><p>Select an Employee in the Team and explicitly choose what happens to its current Lead.</p>
<div class="grid"><label>Team<select id="promote-team"></select></label><label>New Lead<select id="promote-person"></select></label>
<label>Previous Lead<select id="previous-lead-action"><option value="">Choose an action</option><option value="become_employee">Become an Employee in this Team</option><option value="deactivate">Deactivate</option></select></label></div>
<button id="promote-lead">Promote Team Lead</button></div>
<div class="card"><h2>6. Promote a Manager</h2><p>Select an Employee in the Unit and explicitly choose what happens to its current Manager.</p>
<div class="grid"><label>Unit<select id="promote-unit"></select></label><label>New Manager<select id="promote-manager-person"></select></label>
<label>Previous Manager<select id="previous-manager-action"><option value="">Choose an action</option><option value="become_employee">Become a direct Employee in this Unit</option><option value="deactivate">Deactivate</option></select></label></div>
<button id="promote-manager">Promote Manager</button></div>
<div class="card"><h2>7. HR and HRBP scope</h2><p>Select one or more Units for HR, or selected Units or all Units for HRBP. Draft assignments remain pending until activation. To clear a draft scope before correcting its role, choose Selected Units, deselect every Unit, and save.</p>
<div class="grid"><label>Advisor<select id="advisor-person"></select></label><label>Scope<select id="advisor-mode"><option value="selected_units">Selected Units</option><option value="all_units">All Units</option></select></label>
<label>Units<select id="advisor-units" multiple size="6"></select></label></div><button id="advisor-save">Save scope</button></div>
<div class="card"><h2>8. Company Admin access</h2><p>Grant or revoke setup access. A new administrator also needs their corporate SSO identity linked by an operator before sign-in.</p>
<label>Person<select id="admin-person"></select></label><button id="admin-grant">Grant access</button><button id="admin-revoke" class="secondary">Revoke access</button></div>
<div class="card"><h2>9. Deactivate a Person</h2><p>Employee, HR, HRBP, and Leadership can be deactivated when the active hierarchy remains valid. Replace a Team Lead or Manager through a promotion first.</p>
<label>Active Person<select id="deactivate-person"></select></label><button id="deactivate-person-button" class="secondary">Deactivate Person</button></div>
<div class="card"><h2>10. Deactivate a Team</h2><p>Members become direct Employees of the same Unit. Choose what happens to the previous Team Lead.</p>
<div class="grid"><label>Team<select id="deactivate-team"></select></label><label>Previous Lead<select id="deactivate-team-lead-action"><option value="">Choose an action</option><option value="become_employee">Become a direct Employee</option><option value="deactivate">Deactivate</option></select></label></div>
<button id="deactivate-team-button" class="secondary">Deactivate Team</button></div>
<div class="card"><h2>11. Transfer and deactivate a Unit</h2><p>Move its Teams, Employees, and advisor assignments into another active Unit. Choose what happens to the previous Manager.</p>
<div class="grid"><label>Source Unit<select id="deactivate-unit"></select></label><label>Target Unit<select id="deactivate-unit-target"></select></label><label>Previous Manager<select id="deactivate-unit-manager-action"><option value="">Choose an action</option><option value="become_employee">Become a direct Employee in target Unit</option><option value="deactivate">Deactivate</option></select></label></div>
<button id="deactivate-unit-button" class="secondary">Transfer and deactivate Unit</button></div>
<div class="card"><h2>12. Activate Units</h2><p>Select one or more Units. All selected Units must pass structural checks; ready Persons activate together, while unlinked Persons remain draft.</p>
<div class="grid"><label>Units<select id="rollout-unit" multiple size="6"></select></label><label>Slack workspace<select id="rollout-workspace"></select></label></div>
<button id="rollout-preview" class="secondary">Check readiness</button><button id="rollout" disabled>Activate selected Units</button><div id="rollout-result" class="scroll"></div></div>
<div class="card"><h2>First-contact delivery</h2><p>Pending and failed messages are retried by the worker. A message left in sending needs delivery verification before any manual retry.</p><div id="onboarding-deliveries" class="scroll"></div></div>
<div class="card"><h2>Current hierarchy</h2><div id="hierarchy" class="scroll"></div></div>
</section></main><script src="/api/v1/company-setup/ui.js" defer></script></body></html>`;

const SCRIPT = String.raw`'use strict';
const base = '/api/v1/company-setup';
let csrf = '';
let snapshot = null;
let previewedCsv = null;
let previewedRollout = null;
const el = (id) => document.getElementById(id);
const value = (id) => el(id).value;
const rolloutUnitIds = () => [...el('rollout-unit').selectedOptions].map((option) => option.value).sort();
const rolloutKey = (unitIds, workspaceId) => JSON.stringify([unitIds, workspaceId]);
function message(text, error) { const node = el('status'); node.textContent = text; node.className = error ? 'error' : 'success'; }
async function api(path, method, body) {
  const options = { method: method || 'GET', credentials: 'same-origin', headers: {} };
  if (body !== undefined) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
  if (options.method !== 'GET') options.headers['x-csrf-token'] = csrf;
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || data.code || 'Request failed'); error.data = data; throw error; }
  return data;
}
function option(select, label, id) { const item = document.createElement('option'); item.value = id; item.textContent = label; select.append(item); }
function fill(selectId, rows, label, optional) {
  const select = el(selectId); select.replaceChildren();
  if (optional) option(select, 'No assignment yet', '');
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
      status: assignmentStatus ? person.lifecycleStatus + ' · ' + assignmentStatus : person.lifecycleStatus,
      slack: links.has(id) ? 'Linked' : 'Missing Slack' });
  }
  for (const unit of [...data.units].sort((a, b) => a.customerUnitKey.localeCompare(b.customerUnitKey))) {
    const unitPlacements = data.placements.filter((placement) =>
      placement.unitId === unit.id && placement.lifecycleStatus !== 'inactive');
    const activeCount = unitPlacements.filter((placement) => placement.lifecycleStatus === 'active' &&
      persons.get(placement.employeePersonId)?.lifecycleStatus === 'active').length;
    const pendingCount = unitPlacements.length - activeCount;
    rows.push({ level: 'Unit', name: unit.name, key: unit.customerUnitKey,
      status: unit.lifecycleStatus + ' · ' + activeCount + ' active / ' + pendingCount + ' pending Employees', slack: '' });
    personRow('  Manager', unit.managerPersonId);
    for (const placement of unitPlacements.filter((item) => item.teamId === null)
      .sort((a, b) => (persons.get(a.employeePersonId)?.displayName || '').localeCompare(persons.get(b.employeePersonId)?.displayName || ''))) {
      personRow('  Direct Employee', placement.employeePersonId,
        placement.lifecycleStatus === 'draft' ? 'pending assignment' : 'active assignment');
    }
    for (const team of data.teams.filter((item) => item.unitId === unit.id)
      .sort((a, b) => a.customerTeamKey.localeCompare(b.customerTeamKey))) {
      const members = unitPlacements.filter((placement) => placement.teamId === team.id);
      const activeMembers = members.filter((placement) => placement.lifecycleStatus === 'active' &&
        persons.get(placement.employeePersonId)?.lifecycleStatus === 'active').length;
      rows.push({ level: '  Team', name: team.name, key: team.customerTeamKey,
        status: team.lifecycleStatus + ' · ' + activeMembers + ' active / ' + (members.length - activeMembers) + ' pending Employees', slack: '' });
      personRow('    Team Lead', team.teamLeadPersonId);
      for (const placement of members.sort((a, b) =>
        (persons.get(a.employeePersonId)?.displayName || '').localeCompare(persons.get(b.employeePersonId)?.displayName || ''))) {
        personRow('    Employee', placement.employeePersonId,
          placement.lifecycleStatus === 'draft' ? 'pending assignment' : 'active assignment');
      }
    }
  }
  for (const person of data.persons.filter((item) => !shown.has(item.id))
    .map((item) => ({ ...item, name: item.displayName })).sort(sortByName)) {
    rows.push({ level: 'Outside line hierarchy', name: person.displayName,
      key: person.customerEmployeeId + ' · ' + person.primaryRole,
      status: person.lifecycleStatus, slack: links.has(person.id) ? 'Linked' : 'Missing Slack' });
  }
  table(el('hierarchy'), [['Level', (row) => row.level], ['Name', (row) => row.name],
    ['Key', (row) => row.key], ['Status', (row) => row.status], ['Slack', (row) => row.slack]], rows);
}
function renderDeliveries(data) {
  const persons = new Map(data.persons.map((person) => [person.id, person]));
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const labels = { pending: 'Queued', sending: 'Sending · verify before retry',
    delivered: 'Delivered', failed: 'Failed · retry scheduled', cancelled: 'Cancelled' };
  table(el('onboarding-deliveries'), [['Person', (row) => persons.get(row.personId)?.displayName || row.personId],
    ['Unit', (row) => units.get(row.unitId)?.name || row.unitId],
    ['State', (row) => labels[row.status] || row.status],
    ['Attempts', (row) => row.attemptCount],
    ['Last attempt', (row) => row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString() : '—'],
    ['Delivered', (row) => row.deliveredAt ? new Date(row.deliveredAt).toLocaleString() : '—']], data.deliveries);
}
async function refresh() {
  snapshot = await api(base + '/snapshot');
  previewedRollout = null; el('rollout').disabled = true;
  el('counts').textContent = snapshot.persons.length + ' Persons · ' + snapshot.units.length + ' Units · ' + snapshot.teams.length + ' Teams';
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
  fill('rollout-unit', snapshot.units.filter((u) => u.lifecycleStatus !== 'inactive'), (u) => u.name + ' · ' + u.lifecycleStatus, false);
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
  fill('link-person', snapshot.persons.filter((p) => p.lifecycleStatus === 'draft'), (p) => p.displayName + ' · ' + p.lifecycleStatus, false);
  const workspaces = snapshot.workspaces.filter((w) => w.channelType === 'slack' && w.status === 'active');
  table(el('workspaces'), [['Workspace', (w) => w.externalWorkspaceId], ['Status', (w) => w.status],
    ['Email matching', (w) => Array.isArray(w.scopes) && w.scopes.includes('users:read.email') ? 'Ready' : 'Needs users:read.email']], snapshot.workspaces.filter((w) => w.channelType === 'slack'));
  fill('link-workspace', workspaces, (w) => w.externalWorkspaceId, false);
  fill('rollout-workspace', workspaces, (w) => w.externalWorkspaceId, false);
  renderHierarchy(snapshot);
  renderDeliveries(snapshot);
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
async function run(task) { try { message('Working…', false); await task(); } catch (error) {
  const details = error.data && error.data.errors ? ': ' + error.data.errors.map((e) => 'row ' + e.rowNumber + ' ' + e.field + ' ' + e.code).join('; ') : '';
  message(error.message + details, true);
} }
el('sign-in').addEventListener('click', () => {
  const id = value('tenant-id').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) { alert('Enter a valid tenant UUID'); return; }
  location.assign('/api/v1/company-auth/start/' + encodeURIComponent(id));
});
el('refresh').addEventListener('click', () => run(async () => { await refresh(); message('Hierarchy refreshed.', false); }));
el('logout').addEventListener('click', () => run(async () => { await api('/api/v1/company-auth/logout', 'POST'); location.reload(); }));
el('csv-file').addEventListener('change', async (event) => { const file = event.target.files[0]; if (file) { el('csv').value = await file.text(); previewedCsv = null; el('import').disabled = true; } });
el('csv').addEventListener('input', () => { previewedCsv = null; el('import').disabled = true; });
el('preview').addEventListener('click', () => run(async () => {
  const csv = value('csv'); const result = await api(base + '/csv/preview', 'POST', { csv });
  previewedCsv = result.ok ? csv : null; el('import').disabled = !result.ok;
  if (result.ok) { el('preview-result').textContent = result.rows.length + ' rows ready to import.'; message('Preview passed.', false); }
  else { table(el('preview-result'), [['Row', (e) => e.rowNumber], ['Field', (e) => e.field], ['Issue', (e) => e.message]], result.errors); message(result.errors.length + ' issue(s) found.', true); }
}));
el('import').addEventListener('click', () => run(async () => {
  if (previewedCsv !== value('csv')) throw new Error('Preview the current CSV first');
  const result = await api(base + '/csv/import', 'POST', { csv: previewedCsv });
  previewedCsv = null; el('import').disabled = true; await refresh();
  message('Imported ' + result.personIds.length + ' draft Persons.', false);
}));
for (const spec of [['person-form','/persons'],['unit-form','/units'],['team-form','/teams']]) {
  el(spec[0]).addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
    const data = Object.fromEntries(new FormData(event.target).entries());
    await api(base + spec[1], 'POST', data); event.target.reset(); await refresh(); message('Draft saved.', false);
  }); });
}
for (const kind of ['person', 'unit', 'team']) {
  el('edit-' + kind).addEventListener('change', () => loadEditDraft(kind));
  el('edit-' + kind + '-form').addEventListener('submit', (event) => { event.preventDefault(); run(async () => {
    const id = value('edit-' + kind); if (!id) throw new Error('Select a draft ' + kind);
    const data = Object.fromEntries(new FormData(event.target).entries());
    await api(base + '/' + kind + 's/' + encodeURIComponent(id) + '/draft', 'POST', data);
    await refresh(); message('Draft updated.', false);
  }); });
}
el('draft-placement-person').addEventListener('change', loadDraftPlacement);
el('draft-placement-unit').addEventListener('change', fillDraftPlacementTeams);
el('draft-placement-save').addEventListener('click', () => run(async () => {
  const personId = value('draft-placement-person'); if (!personId) throw new Error('Select a draft Employee');
  await api(base + '/persons/' + encodeURIComponent(personId) + '/draft-placement', 'POST',
    { targetUnitId: value('draft-placement-unit') || null, targetTeamId: value('draft-placement-team') || null });
  await refresh(); message('Draft assignment saved.', false);
}));
el('link-email').addEventListener('click', () => run(async () => {
  const result = await api(base + '/persons/' + encodeURIComponent(value('link-person')) + '/slack/email', 'POST', { workspaceId: value('link-workspace') });
  await refresh(); message(result.status === 'matched' ? 'Slack identity linked.' : 'Match needs review: ' + result.status, result.status !== 'matched');
}));
el('link-manual').addEventListener('click', () => run(async () => {
  await api(base + '/persons/' + encodeURIComponent(value('link-person')) + '/slack/manual', 'POST', { workspaceId: value('link-workspace'), externalUserId: value('slack-user-id') });
  await refresh(); message('Slack identity linked.', false);
}));
el('unlink').addEventListener('click', () => run(async () => {
  const personId = value('link-person'); const workspaceId = value('link-workspace');
  if (!personId || !workspaceId) throw new Error('Select a draft Person and workspace');
  await api(base + '/persons/' + encodeURIComponent(personId) + '/slack/unlink', 'POST', { workspaceId });
  await refresh(); message('Slack account unlinked and reserved until reassigned.', false);
}));
el('move-unit').addEventListener('change', fillMoveTeams);
el('move').addEventListener('click', () => run(async () => {
  const personId = value('move-person'); const targetUnitId = value('move-unit');
  if (!personId || !targetUnitId) throw new Error('Select an active Employee and destination Unit');
  await api(base + '/persons/' + encodeURIComponent(personId) + '/move', 'POST',
    { targetUnitId, targetTeamId: value('move-team') || null });
  await refresh(); message('Employee moved.', false);
}));
el('promote-team').addEventListener('change', fillPromotePeople);
el('promote-lead').addEventListener('click', () => run(async () => {
  const teamId = value('promote-team'); const employeePersonId = value('promote-person');
  const previousLeadAction = value('previous-lead-action');
  if (!teamId || !employeePersonId || !previousLeadAction) throw new Error('Select a Team, Employee, and action for the previous Lead');
  await api(base + '/teams/' + encodeURIComponent(teamId) + '/promote-lead', 'POST', { employeePersonId, previousLeadAction });
  el('previous-lead-action').value = ''; await refresh(); message('Team Lead promoted.', false);
}));
el('promote-unit').addEventListener('change', fillPromoteManagerPeople);
el('promote-manager').addEventListener('click', () => run(async () => {
  const unitId = value('promote-unit'); const employeePersonId = value('promote-manager-person');
  const previousManagerAction = value('previous-manager-action');
  if (!unitId || !employeePersonId || !previousManagerAction) throw new Error('Select a Unit, Employee, and action for the previous Manager');
  await api(base + '/units/' + encodeURIComponent(unitId) + '/promote-manager', 'POST', { employeePersonId, previousManagerAction });
  el('previous-manager-action').value = ''; await refresh(); message('Manager promoted.', false);
}));
el('advisor-person').addEventListener('change', fillAdvisorScope);
el('advisor-mode').addEventListener('change', () => { el('advisor-units').disabled = value('advisor-mode') === 'all_units'; });
el('advisor-save').addEventListener('click', () => run(async () => {
  const personId = value('advisor-person'); if (!personId) throw new Error('Select an HR or HRBP Person');
  const scopeMode = value('advisor-mode');
  const unitIds = scopeMode === 'all_units' ? [] : Array.from(el('advisor-units').selectedOptions, (option) => option.value);
  await api(base + '/persons/' + encodeURIComponent(personId) + '/advisor-scope', 'POST', { scopeMode, unitIds });
  await refresh(); message('Advisor scope saved.', false);
}));
el('deactivate-person-button').addEventListener('click', () => run(async () => {
  const personId = value('deactivate-person'); if (!personId) throw new Error('Select an active Person');
  if (!confirm('Deactivate this Person and stop new activity?')) return;
  await api(base + '/persons/' + encodeURIComponent(personId) + '/deactivate', 'POST');
  await refresh(); message('Person deactivated.', false);
}));
el('deactivate-team-button').addEventListener('click', () => run(async () => {
  const teamId = value('deactivate-team'); const leadAction = value('deactivate-team-lead-action');
  if (!teamId || !leadAction) throw new Error('Select an active Team and action for its Lead');
  const memberCount = snapshot.placements.filter((p) => p.teamId === teamId && p.lifecycleStatus === 'active').length;
  if (!confirm('Deactivate this Team and move ' + memberCount + ' active Employees directly to its Unit?')) return;
  await api(base + '/teams/' + encodeURIComponent(teamId) + '/deactivate', 'POST', { leadAction });
  el('deactivate-team-lead-action').value = ''; await refresh(); message('Team deactivated.', false);
}));
el('deactivate-unit').addEventListener('change', fillDeactivateTargetUnits);
el('deactivate-unit-button').addEventListener('click', () => run(async () => {
  const unitId = value('deactivate-unit'); const targetUnitId = value('deactivate-unit-target');
  const managerAction = value('deactivate-unit-manager-action');
  if (!unitId || !targetUnitId || !managerAction) throw new Error('Select source and target Units and action for the previous Manager');
  const teamCount = snapshot.teams.filter((t) => t.unitId === unitId && t.lifecycleStatus !== 'inactive').length;
  const memberCount = snapshot.placements.filter((p) => p.unitId === unitId && p.lifecycleStatus !== 'inactive').length;
  if (!confirm('Transfer ' + teamCount + ' Teams and ' + memberCount + ' Employee placements to the target Unit, then deactivate the source Unit?')) return;
  await api(base + '/units/' + encodeURIComponent(unitId) + '/transfer-deactivate', 'POST', { targetUnitId, managerAction });
  el('deactivate-unit-manager-action').value = ''; await refresh(); message('Unit transferred and deactivated.', false);
}));
for (const spec of [['admin-grant','grant'],['admin-revoke','revoke']]) {
  el(spec[0]).addEventListener('click', () => run(async () => {
    const personId = value('admin-person'); if (!personId) throw new Error('Select a Person');
    await api(base + '/persons/' + encodeURIComponent(personId) + '/company-admin/' + spec[1], 'POST');
    await refresh(); message(spec[1] === 'grant' ? 'Company Admin access granted.' : 'Company Admin access revoked.', false);
  }));
}
for (const id of ['rollout-unit', 'rollout-workspace']) el(id).addEventListener('change', () => { previewedRollout = null; el('rollout').disabled = true; });
el('rollout-preview').addEventListener('click', () => run(async () => {
  const unitIds = rolloutUnitIds(); const workspaceId = value('rollout-workspace');
  if (!unitIds.length || !workspaceId) throw new Error('Select Units and a Slack workspace');
  const preview = await api(base + '/units/rollout/preview', 'POST', { unitIds, workspaceId });
  previewedRollout = preview.ready ? rolloutKey(unitIds, workspaceId) : null; el('rollout').disabled = !preview.ready;
  const linked = new Set(snapshot.slackLinks.filter((link) => link.externalWorkspaceId === workspaceId).map((link) => link.userId));
  const people = new Map(snapshot.persons.map((person) => [person.id, person]));
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  table(el('rollout-result'), [['Unit', (row) => units.get(row.unitId)?.name || row.unitId],
    ['Ready Persons', (row) => row.plan.activatePersonIds.filter((id) => people.get(id)?.lifecycleStatus === 'draft').length],
    ['Missing Slack', (row) => row.plan.pendingPersonIds.filter((id) => !linked.has(id)).length],
    ['Other pending', (row) => row.plan.pendingPersonIds.filter((id) => linked.has(id)).length],
    ['Already active', (row) => row.plan.activatePersonIds.filter((id) => people.get(id)?.lifecycleStatus === 'active').length],
    ['Issues', (row) => row.plan.issues.map((issue) => issue.code + ': ' + issue.entityId).join('; ') || 'None']], preview.units);
  message(preview.ready ? 'Selected Units are ready for rollout.' : 'Resolve structural issues before rollout.', !preview.ready);
}));
el('rollout').addEventListener('click', () => run(async () => {
  const unitIds = rolloutUnitIds(); const workspaceId = value('rollout-workspace');
  if (!unitIds.length || !workspaceId) throw new Error('Select Units and a Slack workspace');
  if (previewedRollout !== rolloutKey(unitIds, workspaceId)) throw new Error('Check readiness for these Units first');
  if (!confirm('Activate ' + unitIds.length + ' selected Unit(s) and queue first contact for ready Persons?')) return;
  const results = await api(base + '/units/rollout', 'POST', { unitIds, workspaceId });
  previewedRollout = null; el('rollout').disabled = true;
  await refresh(); message('Activated ' + results.reduce((sum, row) => sum + row.activatedPersonIds.length, 0) +
    ' Persons across ' + results.length + ' Units.', false);
}));
(async () => { try {
  const me = await api('/api/v1/company-auth/me'); csrf = me.csrfToken;
  el('identity').textContent = 'Tenant ' + me.tenantId + ' · Admin ' + me.personId;
  el('app').hidden = false; await refresh();
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
