import type { MemoryItemRecord } from '../types/records';

export interface SaveMemoryItemParams {
  tenantId: string;
  userId: string;
  category: string;
  canonicalKey?: string;
  content: string;
  structuredValue?: Record<string, unknown>;
  confidence: number;
  importance: number;
  sensitivity: string;
  sourceMessageIds: string[];
  expiresAt?: Date;
  extractorVersion?: string;
}

export interface MemoryRepositoryPort {
  findActiveByUser(userId: string, tenantId: string, limit?: number): Promise<MemoryItemRecord[]>;
  findByCanonicalKey(
    userId: string,
    canonicalKey: string,
    tenantId: string,
  ): Promise<MemoryItemRecord | null>;
  findById(id: string, tenantId: string): Promise<MemoryItemRecord | null>;
  save(params: SaveMemoryItemParams): Promise<MemoryItemRecord>;
  supersede(oldItemId: string, newItemId: string): Promise<void>;
  softDelete(id: string, tenantId: string): Promise<void>;
}
