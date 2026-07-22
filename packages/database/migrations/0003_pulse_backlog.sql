CREATE TABLE pulse_backlog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  survey_question_id UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ignore_count INTEGER NOT NULL DEFAULT 0,
  proactive_sent_at TIMESTAMPTZ,
  evidence_captured_count INTEGER NOT NULL DEFAULT 0,
  resulted_in_coverage BOOLEAN,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pulse_backlog_window_user_question_key UNIQUE (survey_window_id, user_id, survey_question_id)
);

CREATE INDEX pulse_backlog_user_window_idx ON pulse_backlog (user_id, survey_window_id);
CREATE INDEX pulse_backlog_status_idx ON pulse_backlog (survey_window_id, user_id, status, position);
