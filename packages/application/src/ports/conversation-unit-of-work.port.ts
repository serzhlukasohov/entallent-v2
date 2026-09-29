export interface ConversationUnitOfWorkPort {
  run<T>(operation: () => Promise<T>): Promise<T>;
}
