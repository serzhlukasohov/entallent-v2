import type { AdminV2PilotCohortState } from './admin-v2-pilot';

export interface AdminV2PilotPersonQuestion {
  stableKey: string;
  title: string;
  titleDisplay?: import('./pulse-language').DefinitionDisplay;
  group: string;
  status: string;
  ready: boolean;
  workingSummary: string | null;
  finalSummary: string | null;
  display?: import('./pulse-language').AnalyticalDisplay;
  originalSafeSummary?: string | null;
  proseProvenance?: import('./pulse-language').PulseProseProvenance | null;
  outcome: string | null;
  score: number | null;
}

export interface AdminV2PilotPerson {
  userId: string;
  displayName: string;
  inbound: number;
  /** Latest inbound message inside the cycle period. */
  lastInboundAt: string | null;
  questions: AdminV2PilotPersonQuestion[];
}

export interface AdminV2PilotPeopleResponse {
  companyLanguage?: import('./pulse-language').PulseLanguageReadMetadata;
  cohortId: string;
  periodStart: string;
  periodEnd: string;
  state: AdminV2PilotCohortState;
  checkedAt: string;
  people: AdminV2PilotPerson[];
}
