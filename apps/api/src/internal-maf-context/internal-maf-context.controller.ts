import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  InternalServiceAuthGuard,
  RequireInternalServiceAuth,
  type InternalServiceAuthenticatedRequest,
} from '../internal-auth';
import {
  InternalMafContextService,
  type InternalMafContextReadRequest,
  type InternalMafContextResponse,
} from './internal-maf-context.service';

interface InternalMafContextReadBody {
  tenantId?: unknown;
  workspaceId?: unknown;
  userId?: unknown;
  conversationId?: unknown;
  threadId?: unknown;
  sessionKey?: unknown;
  recentTurnLimit?: unknown;
  memoryLimit?: unknown;
  goalLimit?: unknown;
  riskLimit?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

@Controller('internal/maf/context')
@UseGuards(InternalServiceAuthGuard)
export class InternalMafContextController {
  constructor(private readonly service: InternalMafContextService) {}

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @RequireInternalServiceAuth({ permission: 'read' })
  async readContext(
    @Req() request: InternalServiceAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<InternalMafContextResponse> {
    const validated = validateBody(body);
    const claims = request.internalServiceAuth;
    if (!claims) {
      throw new ForbiddenException('Internal service credential is not allowed for this endpoint');
    }
    if (claims.tenantId !== validated.tenantId || claims.workspaceId !== validated.workspaceId) {
      throw new ForbiddenException('Internal service credential is not allowed for this endpoint');
    }

    return this.service.readContext({
      ...validated,
      traceId: claims.traceId,
    });
  }
}

function validateBody(body: unknown): Omit<InternalMafContextReadRequest, 'traceId'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Invalid MAF context read request.');
  }
  const record = body as InternalMafContextReadBody;
  const tenantId = readUuid(record.tenantId);
  const userId = readUuid(record.userId);
  const conversationId = readUuid(record.conversationId);
  const workspaceId = readSafeToken(record.workspaceId);
  const threadId = readOptionalSafeToken(record.threadId);
  const sessionKey = readOptionalSafeToken(record.sessionKey);

  return {
    tenantId,
    workspaceId,
    userId,
    conversationId,
    ...(threadId ? { threadId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    recentTurnLimit: readLimit(record.recentTurnLimit),
    memoryLimit: readLimit(record.memoryLimit),
    goalLimit: readLimit(record.goalLimit),
    riskLimit: readLimit(record.riskLimit),
  };
}

function readUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException('Invalid MAF context read request.');
  }
  return value;
}

function readSafeToken(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_TOKEN_PATTERN.test(value)) {
    throw new BadRequestException('Invalid MAF context read request.');
  }
  return value;
}

function readOptionalSafeToken(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readSafeToken(value);
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new BadRequestException('Invalid MAF context read request.');
  }
  return value;
}
