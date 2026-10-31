-- Native old-schema Index sources authored under receipt/lineage guards.
do $$
#variable_conflict use_variable
declare
 t uuid:=current_setting('rpt08.last_tenant')::uuid;
 person uuid;window_id uuid;conversation uuid;definition uuid;question uuid;key text;
 source_id uuid;confirmation_id uuid;working uuid;score integer;
begin
 for person,window_id,definition in select w.user_id,w.id,w.survey_definition_id from survey_report_window_bindings b join survey_windows w on w.id=b.survey_window_id where b.tenant_id=t and b.cycle_scoring_policy_id=current_setting('rpt08.last_cycle')::uuid loop
  select c.id into conversation from conversations c where c.tenant_id=t and c.user_id=person;
  source_id:=gen_random_uuid();confirmation_id:=gen_random_uuid();
  insert into messages(id,tenant_id,user_id,conversation_id,direction,sender_type,text,occurred_at)
  values(source_id,t,person,conversation,'inbound','user','Synthetic confirmed autonomy meanings.',clock_timestamp()),
  (confirmation_id,t,person,conversation,'inbound','user','Synthetic explicit agreement with these meanings.',clock_timestamp());
  for question,key in select q.id,q.stable_key from survey_questions q where q.survey_definition_id=definition and q.question_group='autonomy' and q.response_type='open_ended' loop
   working:=gen_random_uuid();score:=case key when 'autonomy_control_work' then 60 when 'autonomy_voice_influence' then 80 else 70 end;
   insert into survey_question_working_insights(id,tenant_id,user_id,survey_window_id,survey_question_id,question_version,status,working_summary,confirmed_semantic_summary,source_message_ids,confirmation_message_id,meaning_sufficient,driver_resolved)
   values(working,t,person,window_id,question,'1.0.0','confirmed','Synthetic work methods are delegated.','Synthetic work methods are delegated.',array[source_id],confirmation_id,true,true);
   insert into survey_question_insights(tenant_id,user_id,survey_window_id,survey_definition_id,survey_question_id,question_version,question_group,deidentified_summary,score,signal_direction,signal_severity,root_cause_category,scoring_policy_version,question_rubric_version,model_id,prompt_version,confidence,privacy_policy_version,confirmed_at,scored_at,working_insight_id,summary_support)
   values(t,person,window_id,definition,question,'1.0.0','autonomy','Synthetic employees describe delegated work methods.',score,'favorable','low','autonomy','1.0.0','1.0.0','synthetic-old-fixture','rpt08-old-v1',0.9,'question-deidentification-v2',clock_timestamp(),clock_timestamp(),working,'deidentified_employee_statement');
  end loop;
  update survey_report_inbound_work set capture='applied',native_verdict='applied',evidence='applied',finalization='applied' where inbound_receipt_id in(source_id,confirmation_id);
 end loop;
end $$;
