# ADR-002: PostgreSQL as the Source of Truth

**Status:** Accepted  
**Date:** 2025-01

## Context

The system needs a primary database that can store multi-tenant data with strong consistency, support complex relational queries (conversations + memory + surveys), and provide the transactional guarantees needed for reliable event processing.

The main alternatives were:
- **MongoDB** — flexible schema, but weaker consistency guarantees and more complex multi-tenant isolation
- **CockroachDB** — distributed SQL, but operationally complex for MVP
- **DynamoDB** — managed, scalable, but poor fit for relational queries and JOINs needed for analytics
- **PostgreSQL** — mature, strongly consistent, excellent JSON support, pgvector extension

## Decision

Use **PostgreSQL 16** (with the `pgvector/pgvector` image) as the single source of truth for all persistent state.

Key points:
- All writes go to PostgreSQL first; BullMQ is treated as a delivery mechanism, not a source of truth
- A job is only considered complete when its result is persisted in PostgreSQL
- Redis (BullMQ) state is considered ephemeral and can be reconstructed from PostgreSQL on failure
- Drizzle ORM provides type-safe schema definitions; raw SQL is used only for migrations

## Consequences

**Positive:**
- ACID transactions prevent partial writes
- Row-level security / WHERE clause isolation provides strong multi-tenant boundaries
- pgvector supports semantic memory retrieval without a separate vector database at MVP scale
- Rich analytics queries without ETL
- Mature backup, replication, and managed hosting ecosystem

**Negative:**
- Vertical scaling limit — partitioning or read replicas needed at scale
- Schema migrations require downtime management
- pgvector index performance degrades above ~1M vectors; may need Qdrant/Pinecone later

## Migration path

If throughput exceeds PostgreSQL limits:
1. Extract vector storage to Qdrant (swap `VectorRepositoryPort` implementation)
2. Add read replicas for analytics
3. Introduce CockroachDB or Spanner for distributed write capacity

See ADR-003 for the pgvector decision specifically.
