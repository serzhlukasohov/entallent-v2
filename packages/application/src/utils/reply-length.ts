import type { ReplyStrategy } from '@entalent/contracts';
import type { ResponseContext } from '../ports/ai-provider.port';

/**
 * Hard length ceiling (characters) per reply-length tier, tightened for a clearly terse user.
 * Verbosity comes from the observed style profile already carried in the response context.
 * Application-owned so every provider path and the orchestrator enforce the same budget.
 */
export function maxReplyChars(
  strategy: Pick<ReplyStrategy, 'maxResponseLength'>,
  context: Pick<ResponseContext, 'styleAdaptation' | 'replyPlan'>,
): number {
  // GC round 3 CAP-9: an explicit list, outline, or steps request needs room for its items.
  if (context.replyPlan?.formatRequest) return 980;
  const verbosity = context.styleAdaptation?.dimensions.verbosity;
  const terse = typeof verbosity === 'number' && verbosity <= 0.3;
  switch (strategy.maxResponseLength) {
    case 'short':
      return terse ? 140 : 360;
    case 'medium':
      return terse ? 340 : 680;
    default:
      return 980;
  }
}
