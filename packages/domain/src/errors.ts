export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class TenantNotFoundError extends DomainError {
  constructor(tenantId: string) {
    super(`Tenant not found: ${tenantId}`, 'TENANT_NOT_FOUND', { tenantId });
  }
}

export class UserNotFoundError extends DomainError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, 'USER_NOT_FOUND', { userId });
  }
}

export class TenantIsolationError extends DomainError {
  constructor(resourceTenantId: string, requestTenantId: string) {
    super(
      `Tenant isolation violation: resource belongs to ${resourceTenantId}, request from ${requestTenantId}`,
      'TENANT_ISOLATION_VIOLATION',
      { resourceTenantId, requestTenantId },
    );
  }
}

export class UserDeletedError extends DomainError {
  constructor(userId: string) {
    super(`User is deleted: ${userId}`, 'USER_DELETED', { userId });
  }
}

export class ConversationNotFoundError extends DomainError {
  constructor(conversationId: string) {
    super(`Conversation not found: ${conversationId}`, 'CONVERSATION_NOT_FOUND', {
      conversationId,
    });
  }
}

export class DuplicateEventError extends DomainError {
  constructor(eventId: string) {
    super(`Duplicate event detected: ${eventId}`, 'DUPLICATE_EVENT', { eventId });
  }
}

export class PolicyViolationError extends DomainError {
  constructor(policy: string, reason: string) {
    super(`Policy violation [${policy}]: ${reason}`, 'POLICY_VIOLATION', { policy, reason });
  }
}
