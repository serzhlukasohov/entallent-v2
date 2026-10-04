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

export interface AdminV2PilotCycle {
  cohortId: string;
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
