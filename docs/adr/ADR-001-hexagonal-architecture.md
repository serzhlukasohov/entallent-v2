# ADR-001: Hexagonal Architecture

**Status:** Accepted  
**Date:** 2024-01-01

## Context

We need to build a platform that:
- Integrates with multiple messaging channels (Slack first, Teams/Telegram later)
- Uses multiple AI providers (OpenAI first, Anthropic/Gemini later)
- Keeps domain logic isolated from infrastructure details
- Allows replacing infrastructure components without rewriting business logic

## Decision

Adopt hexagonal architecture (ports and adapters):

- **Domain layer**: entities, value objects, domain policies — zero external dependencies
- **Application layer**: use cases, orchestrators — depends only on domain and port interfaces
- **Ports**: TypeScript interfaces that infrastructure must implement
- **Adapters**: concrete implementations (Slack, OpenAI, Drizzle, BullMQ)
- **Infrastructure**: all I/O — database, queues, external APIs

Rules enforced via ESLint import boundaries:
- `domain` → nothing from this repo
- `application` → `domain`, `contracts` only
- `channel-*` → implements `channel-core` port
- `ai-*` → implements `ai-core` port

## Consequences

**Good:**
- Channel adapters are swappable without touching conversation domain
- AI providers are swappable without touching memory or survey logic
- Domain logic is unit-testable without any database or network
- Architecture scales from modular monolith to microservices

**Bad:**
- More files and indirection compared to a simple layered architecture
- Teams must understand the pattern to add features correctly
