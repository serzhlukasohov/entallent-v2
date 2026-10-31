-- Synthetic database fixture for the real 0091 schema, not a historical application producer.
-- All clocks, receipt proofs, immutable identities and native guards remain enabled.
create schema if not exists rpt08_fixture;
create table if not exists rpt08_fixture.inventory(kind text not null,id uuid not null,tenant_id uuid not null,primary key(kind,id));
do $$
#variable_conflict use_variable
declare
 t uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); leader uuid:=gen_random_uuid();
 unit_id uuid:=gen_random_uuid(); team_id uuid:=gen_random_uuid(); definition_id uuid:=gen_random_uuid();
 source_definition_id uuid:=gen_random_uuid(); policy_id uuid:=gen_random_uuid();cycle_id uuid:=gen_random_uuid();
 scope_id uuid:=gen_random_uuid(); person uuid;participant uuid;window_id uuid;conversation_id uuid;
 question_id uuid;lineage uuid;prompt_id uuid;answer_id uuid;delivery_time timestamptz;ack timestamptz;received timestamptz;
 starts timestamptz:=clock_timestamp()+interval '2 seconds';ends timestamptz:=clock_timestamp()+interval '75 seconds';
 existing_tenant text:=nullif(current_setting('rpt08.existing_tenant',true),'');
 k integer;j integer; key text;form text;form_hash text;rubrics jsonb:=current_setting('rpt08.rubrics')::jsonb;
begin
 if existing_tenant is null then
 insert into tenants(id,name,timezone,locale)values(t,'RPT08-synthetic old0091 fixture','UTC','en');
 insert into rpt08_fixture.inventory values('tenant',t,t);

 insert into users(id,tenant_id,preferred_name,timezone)values(manager,t,'Synthetic manager','UTC'),(leader,t,'Synthetic leader','UTC');
 insert into people(id,tenant_id,customer_employee_id,work_email,display_name,primary_role,pulse_participant,lifecycle_status)
 values(manager,t,manager::text,manager::text||'@fixture.invalid','Synthetic manager','manager',false,'active'),
 (leader,t,leader::text,leader::text||'@fixture.invalid','Synthetic leader','team_lead',true,'active');
 insert into org_units(id,tenant_id,customer_unit_key,name,manager_person_id,lifecycle_status)values(unit_id,t,'old-unit','Synthetic unit',manager,'active');
 insert into org_teams(id,tenant_id,unit_id,customer_team_key,name,team_lead_person_id,lifecycle_status)values(team_id,t,unit_id,'old-team','Synthetic team',leader,'active');
 insert into survey_definitions(id,tenant_id,name,version,active)values(source_definition_id,t,'Synthetic old source','v2-policy-1.0.0',false);
 insert into survey_definitions(id,tenant_id,name,version,active,configuration)values(definition_id,t,'Synthetic old report definition','v2-report-engagement-1.0.0',false,'{"engagementAnswerContract":"engagement-1-10-v1"}');
 insert into survey_scoring_policies(id,tenant_id,version,rubrics,approved_at)values(policy_id,t,'1.0.0',rubrics,transaction_timestamp());
 for key in select jsonb_object_keys(rubrics) loop
   insert into survey_questions(survey_definition_id,stable_key,title,canonical_meaning,dimension,question_group,version,response_type)
   values(definition_id,key,rubrics->key->>'title',rubrics->key->>'canonicalMeaning',rubrics->key->>'questionGroup',rubrics->key->>'questionGroup','1.0.0','open_ended');
 end loop;
 for j in 1..3 loop
  key:=case j when 1 then 'engagement_nps' when 2 then 'engagement_motivation' else 'engagement_current' end;
  form:='Synthetic explicit integer response from one through ten for '||key||'?';
  form_hash:=encode(sha256(convert_to(form,'UTF8')),'hex');
  question_id:=gen_random_uuid();
  insert into survey_questions(id,survey_definition_id,stable_key,title,canonical_meaning,dimension,question_group,version,response_type,display_order)
  values(question_id,definition_id,key,form,form,'engagement','engagement','engagement-1-10-v1','numeric_1_10_integer',j);
  insert into survey_engagement_contract_questions values(question_id,definition_id,'engagement-1-10-v1',key,'engagement-1-10-v1',form_hash);
 end loop;
 insert into survey_engagement_collection_contracts values(definition_id,t,source_definition_id,'engagement-1-10-v1');
 update survey_definitions set active=true where id=definition_id;

 else
  t:=existing_tenant::uuid;
  select u.id,u.manager_person_id,tm.id,tm.team_lead_person_id into unit_id,manager,team_id,leader from org_units u join org_teams tm on tm.unit_id=u.id where u.tenant_id=t;
  select c.survey_definition_id,c.scoring_policy_id into definition_id,policy_id from survey_cycle_scoring_policies c where c.tenant_id=t order by c.period_start desc limit 1;
 end if;
 insert into survey_cycle_scoring_policies(id,tenant_id,survey_definition_id,period_start,period_end,scoring_policy_id)values(cycle_id,t,definition_id,starts,ends,policy_id);
 perform set_config('rpt08.last_tenant',t::text,false);
 perform set_config('rpt08.last_cycle',cycle_id::text,false);
 perform pg_sleep(greatest(0,extract(epoch from starts-clock_timestamp())));
 insert into survey_report_cycle_openings(cycle_scoring_policy_id,tenant_id)values(cycle_id,t);
 insert into survey_report_scopes(id,tenant_id,cycle_scoring_policy_id,kind,org_unit_id,label,opening_owner_person_id,history_key,boundary_fingerprint)
 values(scope_id,t,cycle_id,'manager_overall',unit_id,'Synthetic unit',manager,'rpt08-old-'||unit_id,encode(sha256(convert_to(unit_id::text,'UTF8')),'hex'));
 insert into rpt08_fixture.inventory values('cycle',cycle_id,t),('scope',scope_id,t),('manager',manager,t) on conflict do nothing;
 for k in 1..coalesce(nullif(current_setting('rpt08.participant_count',true),'')::integer,5) loop
  person:=gen_random_uuid();participant:=gen_random_uuid();window_id:=gen_random_uuid();conversation_id:=gen_random_uuid();
  if existing_tenant is null then
  insert into users(id,tenant_id,preferred_name,timezone)values(person,t,'Synthetic employee','UTC');
  insert into people(id,tenant_id,customer_employee_id,work_email,display_name,primary_role,pulse_participant,lifecycle_status)
   values(person,t,person::text,person::text||'@fixture.invalid','Synthetic employee','employee',true,'active');
  insert into org_employee_placements(tenant_id,employee_person_id,unit_id,team_id,lifecycle_status)values(t,person,unit_id,team_id,'active');
  else
   select p.user_id into person from (select distinct user_id from survey_report_participants where tenant_id=t) p order by p.user_id limit 1 offset k-1;
  end if;
  insert into survey_report_participants(id,tenant_id,cycle_scoring_policy_id,person_id,user_id,opening_role,origin_unit_id,origin_team_id)
   values(participant,t,cycle_id,person,person,'employee',unit_id,team_id);
  insert into survey_report_scope_memberships values(t,cycle_id,scope_id,participant);
  insert into survey_windows(id,tenant_id,user_id,survey_definition_id,period_start,period_end,status)values(window_id,t,person,definition_id,starts,ends,'active');
  insert into survey_report_window_bindings values(window_id,t,cycle_id,participant);
  insert into survey_report_question_lineages(tenant_id,cycle_scoring_policy_id,user_id,question_stable_key,survey_question_id,question_version,scoring_policy_id,answer_kind,answer_contract)
   select t,cycle_id,person,q.stable_key,q.id,q.version,policy_id,q.response_type,case when q.response_type='numeric_1_10_integer' then 'engagement-1-10-v1' else null end from survey_questions q where q.survey_definition_id=definition_id;
  if existing_tenant is null then
  insert into conversations(id,tenant_id,user_id,channel_type,external_conversation_id)values(conversation_id,t,person,'slack','D'||person);
  else select c.id into conversation_id from conversations c where c.tenant_id=t and c.user_id=person;end if;
  for question_id,key,form in select q.id,q.stable_key,q.title from survey_questions q where q.survey_definition_id=definition_id and q.response_type='numeric_1_10_integer' order by q.display_order loop
   select id into lineage from survey_report_question_lineages where tenant_id=t and user_id=person and survey_question_id=question_id and cycle_scoring_policy_id=cycle_id;
   form_hash:=encode(sha256(convert_to(form,'UTF8')),'hex');prompt_id:=gen_random_uuid();answer_id:=gen_random_uuid();
   insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at,metadata)
   values(prompt_id,t,person,conversation_id,'outbound','agent',form,clock_timestamp(),jsonb_build_object('engagementProbe',jsonb_build_object('contractVersion','engagement-1-10-v1','surveyDefinitionId',definition_id,'surveyWindowId',window_id,'questionId',question_id,'questionVersion','engagement-1-10-v1','stableKey',key,'displayedFormHash',form_hash)));
   update messages set delivery_attempted_at=clock_timestamp() where id=prompt_id;
   update messages set sent_at=clock_timestamp(),external_message_id='1793350000.000001' where id=prompt_id;
   select sent_at,delivery_recorded_at into delivery_time,ack from messages where id=prompt_id;
   insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at)values(answer_id,t,person,conversation_id,'inbound','user','8',clock_timestamp());
   select received_at into received from messages where id=answer_id;
   insert into survey_engagement_capture_events(inbound_receipt_id,tenant_id,user_id,status,answer_received_at,survey_window_id,lineage_id,contract_version)
   values(answer_id,t,person,'accepted',received,window_id,lineage,'engagement-1-10-v1');
   insert into survey_engagement_answer_revisions(inbound_receipt_id,tenant_id,user_id,survey_window_id,cycle_scoring_policy_id,lineage_id,survey_definition_id,survey_question_id,question_version,stable_key,contract_version,value,answer_received_at,prompt_message_id,prompt_sent_at,prompt_acknowledged_at,displayed_form_hash,permission_revision,proof_kind,expires_at)
   values(answer_id,t,person,window_id,cycle_id,lineage,definition_id,question_id,'engagement-1-10-v1',key,'engagement-1-10-v1',8,received,prompt_id,delivery_time,ack,form_hash,0,'direct_explicit_answer',received+interval '1 day');
   update survey_report_inbound_work set capture='applied',native_verdict='not_applicable',evidence='not_applicable',finalization='not_applicable' where inbound_receipt_id=answer_id;
  end loop;
 end loop;
 if existing_tenant is null then
 insert into channel_accounts(tenant_id,user_id,channel_type,external_workspace_id,external_user_id)values(t,manager,'slack','T'||t,'U'||manager);
 insert into workspace_connections(tenant_id,channel_type,external_workspace_id,encrypted_credentials)values(t,'slack','T'||t,'synthetic-old-fixture');
end if;
end $$;
