import type { StyleProfileRecord } from '../types/records';

export interface StyleProfileRepositoryPort {
  findByUser(userId: string, tenantId: string): Promise<StyleProfileRecord | null>;
  upsert(profile: StyleProfileRecord): Promise<StyleProfileRecord>;
}
