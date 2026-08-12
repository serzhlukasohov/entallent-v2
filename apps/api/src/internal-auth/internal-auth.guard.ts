import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuditLogRepository } from '../audit/audit-log.repository';
import {
  buildInternalServiceAuditLog,
  InternalServiceAuthService,
  type InternalServicePermission,
  type InternalServiceClaims,
  type InternalServiceAuthRejectionReason,
} from './internal-auth.service';

export const INTERNAL_SERVICE_AUTH_POLICY = 'internalServiceAuthPolicy';

export interface InternalServiceAuthPolicy {
  permission: InternalServicePermission;
}

export interface InternalServiceAuthenticatedRequest extends FastifyRequest {
  internalServiceAuth?: InternalServiceClaims;
}

export const RequireInternalServiceAuth = (policy: InternalServiceAuthPolicy) =>
  SetMetadata(INTERNAL_SERVICE_AUTH_POLICY, policy);

@Injectable()
export class InternalServiceAuthGuard implements CanActivate {
  constructor(
    private readonly auth: InternalServiceAuthService,
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<InternalServiceAuthPolicy>(
      INTERNAL_SERVICE_AUTH_POLICY,
      context.getHandler(),
    );
    if (!policy) {
      throw new ForbiddenException('Internal service auth policy is required');
    }

    const request = context.switchToHttp().getRequest<InternalServiceAuthenticatedRequest>();
    const decision = this.auth.authorize({
      authorization: request.headers.authorization,
      endpoint: request.url.split('?')[0],
      requiredPermission: policy.permission,
    });
    const traceId = readTraceId(request);

    await this.auditLog.append(
      buildInternalServiceAuditLog({
        decision: decision.decision,
        reason: decision.decision === 'rejected' ? decision.reason : undefined,
        claims: decision.claims,
        endpoint: request.url.split('?')[0],
        requiredPermission: policy.permission,
        traceId,
      }),
    );

    if (decision.decision === 'authorized') {
      request.internalServiceAuth = decision.claims;
      return true;
    }

    throw exceptionForRejection(decision.reason);
  }
}

function exceptionForRejection(reason: InternalServiceAuthRejectionReason): UnauthorizedException | ForbiddenException {
  if (
    reason === 'missing_authorization' ||
    reason === 'missing_secret' ||
    reason === 'weak_secret' ||
    reason === 'malformed_token' ||
    reason === 'invalid_signature' ||
    reason === 'invalid_claims' ||
    reason === 'expired' ||
    reason === 'issued_in_future'
  ) {
    return new UnauthorizedException('Internal service credential is invalid');
  }

  return new ForbiddenException('Internal service credential is not allowed for this endpoint');
}

function readTraceId(request: FastifyRequest): string | undefined {
  const traceId = request.headers['x-trace-id'];
  return Array.isArray(traceId) ? traceId[0] : traceId;
}
