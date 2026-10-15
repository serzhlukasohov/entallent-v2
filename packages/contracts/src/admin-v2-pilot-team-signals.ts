import type { AdminV2PilotCohortState } from './admin-v2-pilot';

/** A confirmed, de-identified insight; carries no participant, insight, or source identifiers. */
export interface AdminV2PilotTeamSignal {
  stableKey: string;
  title: string;
  group: string;
  summary: string;
  outcome: string;
  score: number | null;
  direction: string;
  severity: string;
  rootCause: string;
}

export interface AdminV2PilotTeamSignalsResponse {
  cohortId: string;
  periodStart: string;
  periodEnd: string;
  state: AdminV2PilotCohortState;
  checkedAt: string;
  signals: AdminV2PilotTeamSignal[];
}

/**
 * QA-only: a Team Signal with its author, so testers can compare the raw chat
 * with the de-identified result. It identifies the author; never use it for
 * manager-facing or aggregate views.
 */
export interface AdminV2PilotQaTeamSignal extends AdminV2PilotTeamSignal {
  author: { userId: string; displayName: string };
}

/** QA-only envelope for {@link AdminV2PilotQaTeamSignal}; same cohort, population and order as Team Signals. */
export interface AdminV2PilotQaTeamSignalsResponse {
  cohortId: string;
  periodStart: string;
  periodEnd: string;
  state: AdminV2PilotCohortState;
  checkedAt: string;
  signals: AdminV2PilotQaTeamSignal[];
}
