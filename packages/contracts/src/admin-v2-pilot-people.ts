export interface AdminV2PilotPersonQuestion {
  stableKey: string;
  title: string;
  group: string;
  status: string;
  ready: boolean;
  workingSummary: string | null;
  finalSummary: string | null;
  outcome: string | null;
  score: number | null;
}

export interface AdminV2PilotPerson {
  userId: string;
  displayName: string;
  inbound: number;
  questions: AdminV2PilotPersonQuestion[];
}

export interface AdminV2PilotPeopleResponse {
  cohortId: string;
  checkedAt: string;
  people: AdminV2PilotPerson[];
}
