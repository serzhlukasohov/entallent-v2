import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@entalent/config';
import {
  buildTraceExportReport,
  findFragment,
  parseTracedTurnPayload,
  preconditionFromTrace,
  TraceExtractionError,
  type FragmentSide,
  type TraceExtraction,
  type SuiteReport,
  type TracedTurnPayload,
  type TracedTurnRecord,
} from '@entalent/conversation-trace';
import { decryptField } from '@entalent/crypto-utils';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { ConversationTraceReader, type StoredTraceRow, type TraceCursor } from './conversation-trace.reader';

/** Bounds of one text search: each request decrypts at most this much. */
export const TRACE_SEARCH_BOUNDS = {
  pageSize: 100,
  maxScannedRows: 1_000,
  timeBudgetMs: 5_000,
  maxDays: 30,
  defaultDays: 7,
  maxMatches: 50,
  defaultMatches: 20,
  minFragment: 3,
  maxFragment: 500,
} as const;

export const TRACE_EXPORT_BOUNDS = { defaultTurns: 100, maxTurns: 200 } as const;

export type ScanStop = 'match_limit' | 'row_limit' | 'time_limit';

export interface TraceSearchMatch {
  traceRowId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  traceId: string | null;
  status: string;
  startedAt: string;
  completedAt: string;
  matchedIn: FragmentSide;
  snippet: string;
}

export interface TraceSearchResponse {
  tenantId: string;
  window: { days: number; since: string };
  limit: number;
  scanned: number;
  /** Rows that could not be decrypted or parsed; they are skipped, never returned. */
  skipped: number;
  /** Why the scan ended before the window was exhausted; null when every row in the window was read. */
  scanStopped: ScanStop | null;
  matches: TraceSearchMatch[];
}

export interface TraceSearchQuery {
  tenantId: string;
  text: string;
  days: number;
  limit: number;
}

export interface TraceExtractQuery {
  tenantId: string;
  traceRowId: string;
}

/** Why an extraction was refused; the controller maps each to its HTTP status. */
export type TraceExtractRefusal =
  | 'not_test_tenant'
  | 'traced_before_test_mark'
  | 'trace_not_found'
  | 'trace_payload_unreadable'
  | 'trace_state_not_captured'
  | 'trace_user_message_missing';

export type TraceExtractResult =
  | { ok: true; extraction: TraceExtraction; conversationId: string }
  | { ok: false; code: TraceExtractRefusal; conversationId?: string };

export interface TraceExportQuery {
  tenantId: string;
  conversationId: string;
  limit: number;
}

const ACTOR = { actorType: 'admin', actorId: 'admin' } as const;

/**
 * Admin read side of production conversation traces (SPEC CAP-7). Payloads are decrypted only here,
 * within one tenant and within fixed bounds. Every search and export is audited before its result is
 * returned; an audit failure fails the request. Logs carry counts only, never message text.
 */
@Injectable()
export class ConversationTraceAdminService {
  private readonly logger = new Logger(ConversationTraceAdminService.name);
  private readonly key: string;
  /** Clock for the scan budget; replaced in tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly reader: ConversationTraceReader,
    private readonly auditLog: AuditLogRepository,
    config: ConfigService<Env, true>,
  ) {
    this.key = config.get('FIELD_ENCRYPTION_KEY', { infer: true });
  }

  async search(query: TraceSearchQuery): Promise<TraceSearchResponse> {
    const startedAt = this.now();
    const since = new Date(startedAt - query.days * 24 * 60 * 60 * 1000);
    const matches: TraceSearchMatch[] = [];
    let scanned = 0;
    let skipped = 0;
    let scanStopped: ScanStop | null = null;
    let cursor: TraceCursor | null = null;

    scan: for (;;) {
      // The budget also covers the page queries, not only the decryption between them.
      if (this.now() - startedAt > TRACE_SEARCH_BOUNDS.timeBudgetMs) {
        scanStopped = 'time_limit';
        break;
      }
      const size = Math.min(TRACE_SEARCH_BOUNDS.pageSize, TRACE_SEARCH_BOUNDS.maxScannedRows - scanned);
      const page = await this.reader.page(query.tenantId, since, cursor, size);
      for (const row of page) {
        if (this.now() - startedAt > TRACE_SEARCH_BOUNDS.timeBudgetMs) {
          scanStopped = 'time_limit';
          break scan;
        }
        scanned += 1;
        const payload = this.open(row);
        if (!payload) {
          skipped += 1;
          continue;
        }
        const hit = findFragment(payload, query.text);
        if (hit) {
          matches.push(toMatch(row, hit.matchedIn, hit.snippet));
          if (matches.length >= query.limit) {
            scanStopped = 'match_limit';
            break scan;
          }
        }
      }
      if (page.length < size) break;
      const last = page.at(-1)!;
      cursor = { startedAt: last.startedAt, id: last.id };
      if (scanned >= TRACE_SEARCH_BOUNDS.maxScannedRows) {
        // Report a cut-off only when the window really holds more rows (ids only, nothing decrypted).
        const more = await this.reader.page(query.tenantId, since, cursor, 1);
        if (more.length) scanStopped = 'row_limit';
        break;
      }
    }

    if (skipped) this.logger.warn(`conversation_trace_payload_unreadable count=${skipped}`);
    await this.auditLog.append({
      tenantId: query.tenantId,
      ...ACTOR,
      action: 'admin.conversation_trace_searched',
      resourceType: 'tenant',
      resourceId: query.tenantId,
      reason: 'Admin searched conversation traces by message text',
      // The fragment itself is message text: only its length is kept.
      metadata: {
        days: query.days, limit: query.limit, fragmentLength: query.text.length,
        scanned, skipped, matches: matches.length, scanStopped,
        // Which conversations the response disclosed (ids only), so a later review can answer who saw what.
        matchedTraceRowIds: matches.map((match) => match.traceRowId),
        matchedConversationIds: [...new Set(matches.map((match) => match.conversationId))],
      },
    });
    return {
      tenantId: query.tenantId,
      window: { days: query.days, since: since.toISOString() },
      limit: query.limit,
      scanned,
      skipped,
      scanStopped,
      matches,
    };
  }

  /** The conversation as suite-report JSON, or null when the tenant has no trace of it. */
  async exportConversation(query: TraceExportQuery): Promise<SuiteReport | null> {
    const { rows, olderCount } = await this.reader.conversation(query.tenantId, query.conversationId, query.limit);
    const turns: TracedTurnRecord[] = rows.map((row, i) => ({
      id: row.id,
      conversationId: row.conversationId,
      inboundMessageId: row.inboundMessageId,
      outboundMessageId: row.outboundMessageId,
      traceId: row.traceId,
      status: row.status === 'failed' ? 'failed' : 'completed',
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      ordinal: olderCount + i + 1,
      payload: this.open(row),
    }));
    const unreadable = turns.filter((turn) => !turn.payload).length;
    if (unreadable) this.logger.warn(`conversation_trace_payload_unreadable count=${unreadable}`);
    await this.auditLog.append({
      tenantId: query.tenantId,
      ...ACTOR,
      action: 'admin.conversation_trace_exported',
      resourceType: 'conversation',
      resourceId: query.conversationId,
      reason: 'Admin exported a conversation trace',
      metadata: { limit: query.limit, turns: turns.length, totalTurns: olderCount + turns.length, unreadable },
    });
    if (!turns.length) return null;
    return buildTraceExportReport({
      tenantId: query.tenantId,
      conversationId: query.conversationId,
      turns,
      totalTurns: olderCount + turns.length,
      generatedAt: new Date(this.now()),
    });
  }

  /**
   * Precondition and QA test draft for the state before one traced turn (SPEC CAP-8). Only for a
   * tenant marked as a test tenant, and only for turns traced after it was marked: the marker is
   * checked before the row is read. Every call, refused, failed or not, is audited before anything
   * is returned; an unexpected failure is audited as `failed` and rethrown.
   */
  async extractPrecondition(query: TraceExtractQuery): Promise<TraceExtractResult> {
    let result: TraceExtractResult;
    try {
      result = await this.extract(query);
    } catch (error) {
      await this.auditLog.append({
        tenantId: query.tenantId,
        ...ACTOR,
        action: 'admin.conversation_trace_precondition_extracted',
        resourceType: 'conversation_turn_trace',
        resourceId: query.traceRowId,
        reason: 'Admin extracted a test precondition from a traced turn',
        metadata: { outcome: 'failed' },
      });
      throw error;
    }
    await this.auditLog.append({
      tenantId: query.tenantId,
      ...ACTOR,
      action: 'admin.conversation_trace_precondition_extracted',
      resourceType: 'conversation_turn_trace',
      resourceId: query.traceRowId,
      reason: 'Admin extracted a test precondition from a traced turn',
      metadata: result.ok
        ? { outcome: 'extracted', conversationId: result.conversationId, name: result.extraction.name,
          gaps: result.extraction.gaps.length, historyMessages: result.extraction.precondition.history.length }
        : { outcome: `refused:${result.code}`, ...(result.conversationId ? { conversationId: result.conversationId } : {}) },
    });
    return result;
  }

  private async extract(query: TraceExtractQuery): Promise<TraceExtractResult> {
    const markedSince = await this.reader.testTenantSince(query.tenantId);
    if (!markedSince) return { ok: false, code: 'not_test_tenant' };
    const row = await this.reader.turn(query.tenantId, query.traceRowId);
    if (!row) return { ok: false, code: 'trace_not_found' };
    const { conversationId } = row;
    // A turn traced before the tenant was marked may hold a real employee's data: never a fixture.
    if (row.startedAt.getTime() < markedSince.getTime()) return { ok: false, code: 'traced_before_test_mark', conversationId };
    const payload = this.open(row);
    if (!payload) {
      this.logger.warn('conversation_trace_payload_unreadable count=1');
      return { ok: false, code: 'trace_payload_unreadable', conversationId };
    }
    try {
      return {
        ok: true,
        conversationId,
        extraction: preconditionFromTrace(payload, {
          tenantId: query.tenantId,
          conversationId: row.conversationId,
          traceRowId: row.id,
          startedAt: row.startedAt,
          status: row.status === 'failed' ? 'failed' : 'completed',
        }),
      };
    } catch (error) {
      if (error instanceof TraceExtractionError) return { ok: false, code: error.code, conversationId };
      throw error;
    }
  }

  /** Decrypts and parses one row; null for a row this key or reader cannot read. */
  private open(row: StoredTraceRow): TracedTurnPayload | null {
    try {
      return parseTracedTurnPayload(decryptField(row.payloadEncrypted, this.key));
    } catch {
      return null;
    }
  }
}

function toMatch(row: StoredTraceRow, matchedIn: FragmentSide, snippet: string): TraceSearchMatch {
  return {
    traceRowId: row.id,
    conversationId: row.conversationId,
    inboundMessageId: row.inboundMessageId,
    outboundMessageId: row.outboundMessageId,
    traceId: row.traceId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    matchedIn,
    snippet,
  };
}
