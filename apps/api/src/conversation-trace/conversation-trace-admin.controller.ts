import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SuiteReport, TraceExtraction } from '@entalent/conversation-trace';
import { ApiKeyGuard } from '../auth/api-key.guard';
import {
  ConversationTraceAdminService,
  TRACE_EXPORT_BOUNDS,
  TRACE_SEARCH_BOUNDS,
  type TraceExtractRefusal,
  type TraceSearchResponse,
} from './conversation-trace-admin.service';

/** Fixed refusal of a precondition extraction: status, stable `code`, message without data. */
const EXTRACT_REFUSALS: Record<TraceExtractRefusal, (body: { code: TraceExtractRefusal; message: string }) => HttpException> = {
  not_test_tenant: (body) => new ForbiddenException(body),
  traced_before_test_mark: (body) => new ForbiddenException(body),
  trace_not_found: (body) => new NotFoundException(body),
  trace_payload_unreadable: (body) => new ConflictException(body),
  trace_state_not_captured: (body) => new ConflictException(body),
  trace_user_message_missing: (body) => new ConflictException(body),
};

const EXTRACT_MESSAGES: Record<TraceExtractRefusal, string> = {
  not_test_tenant: 'Preconditions can be extracted only for tenants marked as test tenants (feature flag conversation_trace_test_tenant)',
  traced_before_test_mark: 'The turn was traced before the tenant was marked as a test tenant',
  trace_not_found: 'No traced turn with this id in this tenant',
  trace_payload_unreadable: 'The traced turn cannot be decrypted or read',
  trace_state_not_captured: 'The traced turn holds no captured state (traced before state capture, or cut to fit)',
  trace_user_message_missing: 'The traced turn has no employee message text',
};

/** Body of a text search. The fragment travels in the body so message text never lands in a URL or access log. */
export interface TraceSearchBody {
  text?: unknown;
  days?: unknown;
  limit?: unknown;
}

function boundedInt(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

/**
 * QA lookup of production conversation traces (SPEC CAP-7): find a traced turn by message text and
 * export its conversation as suite-report JSON for `render-report.mjs`. Admin key, explicit tenant,
 * audited; mounted only with CONVERSATION_TRACE_ADMIN_ENABLED.
 */
@Controller('admin/conversation-traces')
@UseGuards(ApiKeyGuard)
export class ConversationTraceAdminController {
  constructor(private readonly traces: ConversationTraceAdminService) {}

  @Post('search')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async search(
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: TraceSearchBody | undefined,
  ): Promise<TraceSearchResponse> {
    const raw = body?.text;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text.length < TRACE_SEARCH_BOUNDS.minFragment || text.length > TRACE_SEARCH_BOUNDS.maxFragment) {
      throw new BadRequestException(
        `text must be a string of ${TRACE_SEARCH_BOUNDS.minFragment} to ${TRACE_SEARCH_BOUNDS.maxFragment} characters`,
      );
    }
    return this.traces.search({
      tenantId,
      text,
      days: boundedInt(body?.days, 'days', 1, TRACE_SEARCH_BOUNDS.maxDays, TRACE_SEARCH_BOUNDS.defaultDays),
      limit: boundedInt(body?.limit, 'limit', 1, TRACE_SEARCH_BOUNDS.maxMatches, TRACE_SEARCH_BOUNDS.defaultMatches),
    });
  }

  /**
   * Precondition (state before the turn) and QA test draft for one traced turn (SPEC CAP-8); test
   * tenants only. The draft has no expected results yet, so it cannot run until QA fills them in.
   */
  @Get('turns/:traceRowId/precondition')
  @Header('Cache-Control', 'private, no-store')
  async extractPrecondition(
    @Param('traceRowId', ParseUUIDPipe) traceRowId: string,
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TraceExtraction> {
    const result = await this.traces.extractPrecondition({ tenantId, traceRowId });
    if (!result.ok) throw EXTRACT_REFUSALS[result.code]({ code: result.code, message: EXTRACT_MESSAGES[result.code] });
    return result.extraction;
  }

  @Get('conversations/:conversationId/export')
  @Header('Cache-Control', 'private, no-store')
  async exportConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('limit') limit?: string,
  ): Promise<SuiteReport> {
    const report = await this.traces.exportConversation({
      tenantId,
      conversationId,
      limit: boundedInt(limit, 'limit', 1, TRACE_EXPORT_BOUNDS.maxTurns, TRACE_EXPORT_BOUNDS.defaultTurns),
    });
    if (!report) throw new NotFoundException('No traced turns for this conversation in this tenant');
    return report;
  }
}
