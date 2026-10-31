-- Guarded old-schema sources; this is a synthetic DB fixture, not an old application producer.
do $$
#variable_conflict use_variable
declare
 t uuid:=current_setting('rpt08.last_tenant')::uuid;
 native_definition uuid;legacy_definition uuid;unknown_definition uuid:=gen_random_uuid();
 person uuid;native_window uuid;conversation uuid;question uuid;working uuid:=gen_random_uuid();
 source_id uuid:=gen_random_uuid();confirmation_id uuid:=gen_random_uuid();analytical uuid;
 window_id uuid;definition_id uuid;kind text;key text;policy uuid;version text;
 starts timestamptz;ends timestamptz;rubrics jsonb:=current_setting('rpt08.rubrics')::jsonb;
begin
 select c.survey_definition_id,c.scoring_policy_id into native_definition,policy from survey_cycle_scoring_policies c where c.id=current_setting('rpt08.last_cycle')::uuid;
 select d.id into legacy_definition from survey_definitions d where d.tenant_id=t and d.version='v2-policy-1.0.0';
 select w.id,w.user_id into native_window,person from survey_report_window_bindings b join survey_windows w on w.id=b.survey_window_id where b.tenant_id=t limit 1;
 select c.id into conversation from conversations c where c.tenant_id=t and c.user_id=person;
 insert into survey_definitions(id,tenant_id,name,version,active)values(unknown_definition,t,'Synthetic unsupported source','rpt08-unknown',false);
 for definition_id in select unnest(array[legacy_definition,unknown_definition]) loop
  for key in select jsonb_object_keys(rubrics) loop
   insert into survey_questions(survey_definition_id,stable_key,title,canonical_meaning,dimension,question_group,version,response_type)
   values(definition_id,key,rubrics->key->>'title',rubrics->key->>'canonicalMeaning',rubrics->key->>'questionGroup',rubrics->key->>'questionGroup','1.0.0','open_ended');
  end loop;
 end loop;
 insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at)
 values(source_id,t,person,conversation,'inbound','user','Synthetic work methods are delegated.',clock_timestamp()),
 (confirmation_id,t,person,conversation,'inbound','user','Synthetic explicit agreement.',clock_timestamp());
 select q.id into question from survey_questions q where q.survey_definition_id=native_definition and q.question_group='autonomy' and q.response_type='open_ended' order by q.stable_key limit 1;
 insert into survey_question_working_insights(id,tenant_id,user_id,survey_window_id,survey_question_id,question_version,status,working_summary,confirmed_semantic_summary,source_message_ids,confirmation_message_id)
 values(working,t,person,native_window,question,'1.0.0','confirmed','Synthetic work methods are delegated.','Synthetic work methods are delegated.',array[source_id],confirmation_id);
 for kind in select unnest(array['native_retained','native_missing','legacy_opened','legacy_without_opening','unknown_source']) loop
  if kind='native_retained' then
   definition_id:=native_definition;window_id:=native_window;
  else
   definition_id:=case when kind='native_missing' then native_definition when kind='unknown_source' then unknown_definition else legacy_definition end;
   window_id:=gen_random_uuid();starts:=clock_timestamp();ends:=starts+interval '10 minutes';
   insert into survey_windows(id,tenant_id,user_id,survey_definition_id,period_start,period_end,status)
   values(window_id,t,person,definition_id,starts,ends,'active');
   insert into survey_window_scoring_policies(survey_window_id,tenant_id,scoring_policy_id)values(window_id,t,policy) on conflict do nothing;
   if kind='legacy_opened' then
    insert into survey_report_legacy_cycle_openings(tenant_id,survey_definition_id,period_start,period_end,opened_at)
    values(t,definition_id,starts,ends,clock_timestamp());
   end if;
  end if;
  select q.id,q.version into question,version from survey_questions q where q.survey_definition_id=definition_id and q.question_group='autonomy' and q.response_type='open_ended' order by q.stable_key limit 1;
  analytical:=gen_random_uuid();
  insert into survey_question_insights(id,tenant_id,user_id,survey_window_id,survey_definition_id,survey_question_id,question_version,question_group,deidentified_summary,score,signal_direction,signal_severity,root_cause_category,scoring_policy_version,question_rubric_version,model_id,prompt_version,confidence,privacy_policy_version,confirmed_at,scored_at,working_insight_id,summary_support)
  values(analytical,t,person,window_id,definition_id,question,version,'autonomy','Synthetic employees describe delegated work methods.',case when kind='native_retained' then 70 else 7.5 end,'favorable','low','autonomy','1.0.0','1.0.0','synthetic-old-fixture','rpt08-old-v1',0.9,'question-deidentification-v2',clock_timestamp(),clock_timestamp(),case when kind='native_retained' then working else null end,'deidentified_employee_statement');
  insert into rpt08_fixture.inventory values(kind,analytical,t);
 end loop;
end $$;
