-- Add question_group and response_type to survey_questions
ALTER TABLE survey_questions
  ADD COLUMN IF NOT EXISTS question_group TEXT NOT NULL DEFAULT 'autonomy',
  ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'open_ended';

-- Teams: source of truth for manager–employee relationships
CREATE TABLE IF NOT EXISTS teams (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  manager_slack_user_id TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team memberships with soft-delete
CREATE TABLE IF NOT EXISTS team_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS team_memberships_team_idx ON team_memberships(team_id) WHERE left_at IS NULL;

-- Survey group states: tracks lifecycle of one dimension group per employee per window
CREATE TABLE IF NOT EXISTS survey_group_states (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_window_id  UUID NOT NULL REFERENCES survey_windows(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_group    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'in_progress',
  ai_summary        TEXT,
  employee_score    NUMERIC(5,2),
  personal_recs     JSONB,
  confirmed_at      TIMESTAMPTZ,
  report_sent_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (survey_window_id, user_id, question_group)
);

CREATE INDEX IF NOT EXISTS survey_group_states_user_idx ON survey_group_states(user_id, question_group);
