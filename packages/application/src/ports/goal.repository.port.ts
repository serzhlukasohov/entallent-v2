import type { UserGoalRecord } from '../types/records';

export interface SaveGoalParams {
  tenantId: string;
  userId: string;
  title: string;
  description?: string;
  category: string;
  targetDate?: Date;
  sourceMessageIds: string[];
  confidence: number;
}

export interface GoalRepositoryPort {
  findActiveByUser(userId: string, tenantId: string): Promise<UserGoalRecord[]>;
  findById(id: string, tenantId: string): Promise<UserGoalRecord | null>;
  save(params: SaveGoalParams): Promise<UserGoalRecord>;
  updateStatus(
    id: string,
    status: 'active' | 'completed' | 'cancelled',
    tenantId: string,
  ): Promise<void>;
}
