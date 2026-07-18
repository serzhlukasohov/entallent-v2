import type { WorkspaceConnectionRecord } from '../types/records';

export interface WorkspaceConnectionRepositoryPort {
  findByExternalWorkspace(
    channelType: string,
    externalWorkspaceId: string,
  ): Promise<WorkspaceConnectionRecord | null>;
  /** Find the first active workspace connection for a tenant+channel — used for proactive sends */
  findFirstByTenant(
    tenantId: string,
    channelType: string,
  ): Promise<WorkspaceConnectionRecord | null>;
}
