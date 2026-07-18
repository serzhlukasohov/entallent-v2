# Memory Model

## Memory Taxonomy

Memory items are extracted facts about a user that persist across conversations. Every item has a `category`:

| Category | Description | Examples |
|----------|-------------|---------|
| `goal` | A professional or personal objective the user has stated | "wants to move into a senior role by Q3", "learning Spanish" |
| `preference` | Working style, communication preferences, constraints | "prefers async communication", "dislikes long meetings" |
| `concern` | A worry, pain point, or source of stress | "stressed about the upcoming reorg", "worried about team dynamics" |
| `achievement` | A recent success or milestone | "shipped the billing rewrite", "received positive feedback from manager" |
| `context` | Background information about role, team, or situation | "joined 6 months ago", "works in the Berlin office", "manages 4 engineers" |

## Extraction

Memory extraction runs asynchronously after each conversation turn (MemoryExtractionUseCase, triggered via the `memory-extraction` BullMQ queue).

Input: last 20 conversation turns + existing active memory items (for deduplication and conflict detection).

The AI prompt instructs the model to:
1. Identify new facts worth remembering
2. Flag conflicts with existing items (e.g., new goal contradicts old goal)
3. Suggest items to supersede (old fact is no longer accurate)
4. Assign importance score (0–1) reflecting how much the fact should influence future responses

Output (MemoryProposal, validated by Zod schema):
```typescript
{
  newItems: Array<{ category, content, importance, sourceMessageIds }>;
  supersedes: Array<{ existingId, reason }>;
  conflicts: Array<{ existingId, description }>;
}
```

## Retrieval

When generating a response, the orchestrator loads the 20 most important active memory items for the user (`findActiveByUser(userId, tenantId, 20)`). Items are sorted by importance descending.

The memory context is injected into the response generation prompt as a structured section:
```
User memory:
- [goal] wants to lead a team by end of year (importance: 0.9)
- [concern] feeling overwhelmed by context switching (importance: 0.8)
- [preference] works best in the morning (importance: 0.5)
```

## Conflicts

When a new item conflicts with an existing one:
1. The new item is saved with `status = active`
2. The conflicting existing item is marked `status = conflicted`
3. Both IDs are linked via `conflict_with` array
4. The AI prompt for future responses notes the conflict so it can probe for clarification

When a new item supersedes an existing one:
1. The new item is saved with `status = active`
2. The superseded item is marked `status = superseded`

## Expiry

Memory items do not expire by time. They are explicitly:
- Superseded: when new information contradicts or updates the old fact
- Conflicted: when a new item conflicts without clear resolution
- Deleted: when the user requests deletion (`DELETE /users/:userId/memory/:memoryId`) or when GDPR erasure runs

Default retention: 365 days (configurable per tenant).

## User Controls

Users can manage their memory through:
- `GET /users/:userId/memory` — list active memory items
- `DELETE /users/:userId/memory/:memoryId` — delete a specific item

Both endpoints require `X-Api-Key` authentication and write audit log entries.

In future versions, users should be able to view and edit their memory directly in the Slack interface.
