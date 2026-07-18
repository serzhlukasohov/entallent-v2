# ADR-003: pgvector for Initial Semantic Retrieval

**Status:** Accepted  
**Date:** 2025-01

## Context

Memory retrieval needs to find relevant memory items from potentially hundreds of items per user. Exact-match keyword search misses semantically similar content ("EM promotion" vs "engineering manager role").

The main alternatives:
- **pgvector** — PostgreSQL extension; zero new infrastructure, good for <1M vectors
- **Qdrant** — purpose-built, excellent performance, but another service to operate
- **Pinecone** — managed, simple API, but adds vendor lock-in and egress costs
- **Weaviate / Chroma** — open-source vector DBs; operationally complex

## Decision

Use **pgvector** for MVP semantic retrieval, accessed behind a `VectorRepositoryPort` abstraction.

Memory items with non-null `embeddingVector` columns are retrieved via cosine similarity:
```sql
SELECT * FROM memory_items
WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
ORDER BY embedding_vector <=> $3
LIMIT 10;
```

Embedding generation is the responsibility of the AI provider — the embedding model is called before inserting a memory item.

## Consequences

**Positive:**
- No new infrastructure at MVP
- Transactional consistency — memory item and its embedding are saved atomically
- `VectorRepositoryPort` abstraction allows future swap to Qdrant/Pinecone without domain changes

**Negative:**
- pgvector HNSW index degrades with very large vector sets (>500K per tenant)
- Embedding generation adds latency to memory extraction jobs
- No built-in metadata filtering performance optimization (must use combined SQL + vector queries)

## Migration path

When vector cardinality or query latency becomes an issue:
1. Implement `QdrantVectorRepository` implementing `VectorRepositoryPort`
2. Run a backfill job to migrate embeddings from PostgreSQL to Qdrant
3. Feature-flag the new implementation per tenant
4. Deprecate the pgvector columns once all tenants are migrated

See ADR-010 for the broader infrastructure migration path.
