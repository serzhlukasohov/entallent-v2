import type { ConversationTurn, MemoryContext } from '@entalent/application';
import { sanitizeTurnContent, INJECTION_GUARD } from './sanitize';

export function buildMemorySystemPrompt(): string {
  return `You are a memory extraction engine for an AI employee-mentor system.

Analyze the conversation and identify information worth remembering long-term about the employee.

Rules:
- Only extract durable facts, goals, concerns, preferences, commitments, and milestones
- Do NOT extract: temporary emotions without context, offhand remarks, guesses, inferences without evidence
- Do NOT store sensitive information that has no product value (medical conditions, diagnoses, personal secrets)
- For each memory item, decide: create (new item), update (refine existing — set existingItemId to the [id] from the existing-items list), supersede (replace existing by existingItemId), or ignore
- CRITICAL: before proposing "create", check the existing memory items list. If an item already captures the same fact — even worded differently — do NOT create another one. Use "ignore" if nothing changed, or "update"/"supersede" with that item's id if the fact evolved. Near-duplicate items are extraction errors.
- Most turns add nothing new. An empty memoryItems array is a perfectly good answer.
- Confidence reflects how certain you are this is a stable, meaningful fact
- Importance reflects how relevant this will be for future conversations (0=low, 1=high)
- expectedLifetime: "days" (7d), "weeks" (30d), "months" (90d), "long_term" (no expiry)

Categories: profile_fact, role, team_context, project_context, goal, concern, stressor, preference, communication_preference, commitment, milestone, relationship_context, achievement, recurring_topic, support_preference

Return a JSON object with exactly these fields:
{
  "memoryItems": [
    {
      "category": string,
      "canonicalKey": string | null,       // stable identifier like "current_role" or "assessment_goal_lead"
      "content": string,                    // human-readable summary of the memory
      "structuredValue": object | null,     // optional structured data e.g. { "date": "2024-09-01", "level": "Lead" }
      "confidence": number,                 // 0.0 to 1.0
      "importance": number,                 // 0.0 to 1.0
      "sensitivity": string,               // "normal", "sensitive", or "highly_sensitive"
      "expectedLifetime": string,           // "days", "weeks", "months", or "long_term"
      "sourceMessageIds": [],               // always empty array — populated by backend
      "action": string,                     // "create", "update", "supersede", or "ignore"
      "existingItemId": string | null       // required for "supersede", optional for "update"
    }
  ],
  "goalProposals": [
    {
      "title": string,
      "description": string | null,
      "category": string,
      "targetDate": string | null,          // ISO 8601 date or null
      "confidence": number,
      "sourceMessageIds": [],
      "action": string,                     // "create", "update", "complete", or "cancel"
      "existingGoalId": string | null
    }
  ],
  "commitmentProposals": [],
  "followUpCandidates": []
}

Output only valid JSON, no markdown.${INJECTION_GUARD}`;
}

export function buildMemoryUserPrompt(
  turns: ConversationTurn[],
  existing: MemoryContext,
): string {
  const transcript = turns
    .slice(-20)
    .map((t) => `${t.role === 'user' ? 'Employee' : 'Mentor'}: ${sanitizeTurnContent(t.content)}`)
    .join('\n');

  const existingItemsSummary =
    existing.items.length > 0
      ? existing.items
          .slice(0, 20)
          .map(
            (i) =>
              `  [${i.id}] (${i.category}, importance=${i.importance.toFixed(2)}): ${i.content}`,
          )
          .join('\n')
      : '  (none)';

  const existingGoalsSummary =
    existing.goals.length > 0
      ? existing.goals.map((g) => `  [${g.id}] (${g.status}): ${g.title}`).join('\n')
      : '  (none)';

  return `--- UNTRUSTED CONVERSATION TRANSCRIPT START ---
${transcript}
--- UNTRUSTED CONVERSATION TRANSCRIPT END ---


Existing memory items:
${existingItemsSummary}

Existing goals:
${existingGoalsSummary}

Extract memory proposals from this conversation.`;
}
