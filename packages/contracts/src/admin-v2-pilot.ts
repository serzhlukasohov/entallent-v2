export interface AdminV2PilotQuestion {
  stableKey: string;
  title: string;
  group: string;
  working: number;
  ready: number;
  noData: number;
  confirmed: number;
  finalScored: number;
  finalInsufficient: number;
}

/** Derived from the cohort period at read time: closed once period_end has passed. */
export type AdminV2PilotCohortState = 'upcoming' | 'active' | 'closed';

export interface AdminV2PilotCycle {
  cohortId: string;
  state: AdminV2PilotCohortState;
  definitionVersion: string;
  scoringPolicyVersion: string;
  periodStart: string;
  periodEnd: string;
  rosterSize: number;
  managerTargetConfigured: boolean;
  participants: number;
  inbound: number;
  processed: number;
  lastInboundAt: string | null;
  windows: number;
  readyMeanings: number;
  completeGroups: number;
  noDataMeanings: number;
  bundles: number;
  awaitingBundles: number;
  resolvedBundles: number;
  deliveredDisclosures: number;
  deliveredBundles: number;
  autonomyVerdicts: number;
  autonomyScoredParticipants: number;
  finalScored: number;
  finalInsufficient: number;
  reportSnapshots: number;
  sentReports: number;
  questions: AdminV2PilotQuestion[];
}

export interface AdminV2PilotResponse {
  tenantId: string;
  checkedAt: string;
  cycles: AdminV2PilotCycle[];
}
