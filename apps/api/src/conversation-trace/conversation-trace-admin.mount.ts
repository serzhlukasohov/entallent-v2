export interface ConversationTraceAdminEnv {
  CONVERSATION_TRACE_ADMIN_ENABLED?: string;
}

/**
 * The trace lookup and export routes expose conversation text under the shared admin key, which the
 * reviewed production route boundary otherwise keeps out. They are mounted only when an operator opts in.
 */
export function shouldMountConversationTraceAdmin(env: ConversationTraceAdminEnv = process.env): boolean {
  const flag = env.CONVERSATION_TRACE_ADMIN_ENABLED;
  return flag === 'true' || flag === '1';
}
