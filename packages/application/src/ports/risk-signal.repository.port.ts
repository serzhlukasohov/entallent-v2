import type { RiskSignalRecord } from '../types/records';
export type { RiskSignalRecord };

export interface SaveRiskSignalParams {
  tenantId: string;
  userId: string;
  type: string;
  severity: string;
  confidence: number;
  evidenceMessageIds: string[];
  policyVersion?: string;
  expiresAt?: Date;
}

export interface RiskSignalRepositoryPort {
  save(params: SaveRiskSignalParams): Promise<RiskSignalRecord>;
  findActiveByUser(userId: string, tenantId: string): Promise<RiskSignalRecord[]>;
  resolve(id: string, tenantId: string): Promise<void>;
}
