import {
  RUNTIME_OPENAPI_SCHEMA,
  validateRuntimeProcessMessageRequest,
  validateRuntimeResult,
} from '@entalent/contracts';
import type {
  RuntimeContext,
  RuntimeProcessMessageRequest,
  RuntimeResult,
} from '@entalent/contracts';
import type { AgentRuntimePort, ProcessMessageRequest, ProcessMessageResult } from '../ports/agent-runtime.port';

export type MafAgentRuntimeDiagnosticReasonCode =
  | 'maf_runtime_configuration_missing'
  | 'maf_runtime_configuration_invalid'
  | 'maf_runtime_url_invalid'
  | 'maf_runtime_boundary_request_invalid'
  | 'maf_runtime_response_invalid'
  | 'maf_runtime_http_failed'
  | 'maf_runtime_fetch_failed';

export type MafAgentRuntimeConfigKey =
  | 'AGENT_SERVICE_INTERNAL_URL'
  | 'AGENT_SERVICE_URL'
  | 'AGENT_SERVICE_TIMEOUT_MS';

export interface MafAgentRuntimeDiagnostic {
  reasonCode: MafAgentRuntimeDiagnosticReasonCode;
  missingConfigKeys?: MafAgentRuntimeConfigKey[];
  invalidConfigKeys?: MafAgentRuntimeConfigKey[];
  invalidFields?: string[];
  missingCanonicalFields?: string[];
}

export interface MafAgentRuntimeDiagnosticProvider {
  getConfigurationDiagnostic(request: ProcessMessageRequest): MafAgentRuntimeDiagnostic | null;
}

export interface MafAgentRuntimeCandidateProvider extends MafAgentRuntimeDiagnosticProvider {
  processCandidate(request: ProcessMessageRequest): Promise<RuntimeResult>;
}

export type MafAgentRuntimeFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: unknown;
  },
) => Promise<unknown>;

export interface MafAgentRuntimeClientOptions {
  serviceUrl?: string;
  serviceUrlConfigKey?: 'AGENT_SERVICE_INTERNAL_URL' | 'AGENT_SERVICE_URL';
  invalidConfigKeys?: MafAgentRuntimeConfigKey[];
  timeoutMs?: number;
  serviceAuthSecret?: string;
  fetch?: MafAgentRuntimeFetch;
}

export interface MafAgentRuntimeClientOptionsSnapshot {
  serviceUrl?: string;
  timeoutMs?: number;
  serviceAuthConfigured: boolean;
}

const DEFAULT_MAF_RUNTIME_TIMEOUT_MS = 5000;

type RuntimeDebugContext =
  | {
      [key: string]: string | boolean | number | string[] | undefined;
    }
  | null;

function isMafRuntimeDebugEnabled(): boolean {
  const runtimeGlobals = globalThis as {
    process?: { env?: Record<string, string | undefined> };
    MAF_DEBUG_RUNTIME_CONFIG?: string;
  };
  return (
    runtimeGlobals.MAF_DEBUG_RUNTIME_CONFIG === '1'
    || runtimeGlobals.process?.env?.MAF_DEBUG_RUNTIME_CONFIG === '1'
  );
}

function logMafRuntimeDebug(message: string, context: RuntimeDebugContext): void {
  if (!context) {
    return;
  }
  const logger = (globalThis as { console?: { debug: (...args: unknown[]) => void } }).console;
  logger?.debug?.(message, context);
}

export class MafAgentRuntimeConfigurationError extends Error {
  readonly reasonCode: MafAgentRuntimeDiagnosticReasonCode;
  readonly safeDiagnostic: MafAgentRuntimeDiagnostic;

  constructor(diagnostic: MafAgentRuntimeDiagnostic) {
    super(diagnostic.reasonCode);
    this.name = 'MafAgentRuntimeConfigurationError';
    this.reasonCode = diagnostic.reasonCode;
    this.safeDiagnostic = diagnostic;
  }
}

export class MafAgentRuntimeClient implements AgentRuntimePort, MafAgentRuntimeDiagnosticProvider {
  constructor(private readonly options: MafAgentRuntimeClientOptions = {}) {}

  async processMessage(request: ProcessMessageRequest): Promise<ProcessMessageResult> {
    const diagnostic = this.getConfigurationDiagnostic(request);
    if (diagnostic) {
      throw new MafAgentRuntimeConfigurationError(diagnostic);
    }

    throw new MafAgentRuntimeConfigurationError({
      reasonCode: 'maf_runtime_boundary_request_invalid',
      missingCanonicalFields: requiredCandidateDiagnostic(request).missingCanonicalFields ?? MISSING_CANONICAL_REQUEST_FIELDS,
    });
  }

  async processCandidate(request: ProcessMessageRequest): Promise<RuntimeResult> {
    const diagnostic = this.getConfigurationDiagnostic(request);
    if (diagnostic) {
      throw new MafAgentRuntimeConfigurationError(diagnostic);
    }

    const runtimeRequest = buildRuntimeProcessMessageRequest(request);
    if (!runtimeRequest) {
      throw new MafAgentRuntimeConfigurationError(requiredCandidateDiagnostic(request));
    }

    const requestValidation = validateRuntimeProcessMessageRequest({
      schemaDocument: RUNTIME_OPENAPI_SCHEMA,
      value: runtimeRequest,
    });
    if (!requestValidation.ok) {
      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields: [requestValidation.path],
      });
    }

    const response = await this.postRuntimeRequest(runtimeRequest);
    const responseBody = await readJsonResponse(response);
    const resultValidation = validateRuntimeResult({
      schemaDocument: RUNTIME_OPENAPI_SCHEMA,
      value: responseBody,
    });
    if (!resultValidation.ok) {
      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_response_invalid',
        invalidFields: [resultValidation.path],
      });
    }

    return responseBody as RuntimeResult;
  }

  getConfigurationDiagnostic(request: ProcessMessageRequest): MafAgentRuntimeDiagnostic | null {
    if (isMafRuntimeDebugEnabled()) {
      const serviceUrl = normalizeOptionalString(this.options.serviceUrl);
      const serviceUrlConfigKey = this.options.serviceUrlConfigKey ?? 'AGENT_SERVICE_INTERNAL_URL';
      const missingRuntimeBoundary = invalidRuntimeBoundaryFields(request);
      const candidateDiagnostic = requiredCandidateDiagnostic(request);
      logMafRuntimeDebug('[debug] maf-runtime.getConfigurationDiagnostic', {
        reason: 'precheck',
        traceId: request.traceId,
        serviceUrlConfigKey,
        hasServiceUrl: Boolean(serviceUrl),
        serviceUrl: serviceUrl,
        hasFetch: Boolean(this.options.fetch ?? defaultFetch()),
        hasInvalidConfig: Boolean(this.options.invalidConfigKeys?.length),
        hasTimeout: this.options.timeoutMs !== undefined,
        invalidBoundaryFields: missingRuntimeBoundary,
        invalidCandidateFields: candidateDiagnostic.missingCanonicalFields,
      });
      if (this.options.invalidConfigKeys && this.options.invalidConfigKeys.length > 0) {
        return {
          reasonCode: 'maf_runtime_configuration_invalid',
          invalidConfigKeys: this.options.invalidConfigKeys,
        };
      }
      if (!serviceUrl) {
        return {
          reasonCode: 'maf_runtime_configuration_missing',
          missingConfigKeys: [serviceUrlConfigKey],
        };
      }
      if (!isHttpServiceUrl(serviceUrl)) {
        return {
          reasonCode: 'maf_runtime_url_invalid',
          invalidConfigKeys: [serviceUrlConfigKey],
        };
      }
      if (missingRuntimeBoundary.length > 0) {
        return {
          reasonCode: 'maf_runtime_boundary_request_invalid',
          invalidFields: missingRuntimeBoundary,
        };
      }
      if (candidateDiagnostic.missingCanonicalFields?.length) {
        return candidateDiagnostic;
      }
      return null;
    }

    if (this.options.invalidConfigKeys && this.options.invalidConfigKeys.length > 0) {
      return {
        reasonCode: 'maf_runtime_configuration_invalid',
        invalidConfigKeys: this.options.invalidConfigKeys,
      };
    }

    const serviceUrl = normalizeOptionalString(this.options.serviceUrl);
    const serviceUrlConfigKey = this.options.serviceUrlConfigKey ?? 'AGENT_SERVICE_INTERNAL_URL';
    if (!serviceUrl) {
      return {
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: [serviceUrlConfigKey],
      };
    }

    if (!isHttpServiceUrl(serviceUrl)) {
      return {
        reasonCode: 'maf_runtime_url_invalid',
        invalidConfigKeys: [serviceUrlConfigKey],
      };
    }

    const invalidFields = invalidRuntimeBoundaryFields(request);
    if (invalidFields.length > 0) {
      return {
        reasonCode: 'maf_runtime_boundary_request_invalid',
        invalidFields,
      };
    }

    const candidateDiagnostic = requiredCandidateDiagnostic(request);
    return candidateDiagnostic.missingCanonicalFields?.length ? candidateDiagnostic : null;
  }

  optionsSnapshot(): MafAgentRuntimeClientOptionsSnapshot {
    const serviceUrl = normalizeOptionalString(this.options.serviceUrl);
    return {
      ...(serviceUrl ? { serviceUrl } : {}),
      ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      serviceAuthConfigured: Boolean(normalizeOptionalString(this.options.serviceAuthSecret)),
    };
  }

  private async postRuntimeRequest(runtimeRequest: RuntimeProcessMessageRequest): Promise<unknown> {
    if (isMafRuntimeDebugEnabled()) {
      const fetchImpl = this.options.fetch ?? defaultFetch();
      const serviceUrl = normalizeOptionalString(this.options.serviceUrl);
      logMafRuntimeDebug('[debug] maf-runtime.postRuntimeRequest', {
        traceId: runtimeRequest.traceId,
        hasFetch: Boolean(fetchImpl),
        serviceUrlConfigKey: this.options.serviceUrlConfigKey ?? 'AGENT_SERVICE_INTERNAL_URL',
        hasServiceUrl: Boolean(serviceUrl),
        serviceUrl,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_MAF_RUNTIME_TIMEOUT_MS,
      });
    }

    const fetchImpl = this.options.fetch ?? defaultFetch();
    if (!fetchImpl) {
      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_fetch_failed',
      });
    }

    const serviceUrl = normalizeOptionalString(this.options.serviceUrl);
    if (!serviceUrl) {
      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_configuration_missing',
        missingConfigKeys: [this.options.serviceUrlConfigKey ?? 'AGENT_SERVICE_INTERNAL_URL'],
      });
    }

    try {
      const response = await fetchImpl(`${serviceUrl.replace(/\/+$/, '')}/runtime/process-message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-trace-id': runtimeRequest.traceId,
        },
        body: JSON.stringify(runtimeRequest),
        signal: createTimeoutSignal(this.options.timeoutMs ?? DEFAULT_MAF_RUNTIME_TIMEOUT_MS),
      });

      if (isHttpResponse(response) && !response.ok) {
        logMafRuntimeDebug('[debug] maf-runtime.http_failed_response', {
          reason: 'http_failed',
          traceId: runtimeRequest.traceId,
          status: response.status,
          endpoint: `${serviceUrl.replace(/\/+$/, '')}/runtime/process-message`,
        });
        throw new MafAgentRuntimeConfigurationError({
          reasonCode: 'maf_runtime_http_failed',
          invalidFields: [`http_status:${response.status}`],
        });
      }

      return response;
    } catch (error) {
      if (error instanceof MafAgentRuntimeConfigurationError) {
        throw error;
      }

      try {
        const fetchError = error as { name?: string; message?: string };
        const runtimeConsole = (globalThis as unknown as {
          console?: {
            warn: (...args: unknown[]) => void;
          };
        }).console;

        runtimeConsole?.warn('MAF runtime fetch failed', {
          reason: 'maf_runtime_fetch_failed',
          runtimeAttempt: runtimeRequest.idempotencyKey,
          errorName: fetchError?.name,
          errorMessage: fetchError?.message,
          endpoint: `${serviceUrl.replace(/\/+$/, '')}/runtime/process-message`,
        });
      } catch {
        // Logging diagnostics should never block runtime calls.
      }

      throw new MafAgentRuntimeConfigurationError({
        reasonCode: 'maf_runtime_fetch_failed',
      });
    }
  }
}

const MISSING_CANONICAL_REQUEST_FIELDS = [
  'idempotencyKey',
  'tenant',
  'user',
  'conversation.sessionKey',
  'message.text',
  'message.createdAt',
  'context',
];

const REQUIRED_CANDIDATE_FIELDS = [
  'conversation.sessionKey',
  'message.text',
  'message.createdAt',
  'context',
];

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isHttpServiceUrl(value: string): boolean {
  const ParsedUrl = (globalThis as unknown as {
    URL?: new (input: string) => { protocol: string; hostname: string };
  }).URL;
  if (!ParsedUrl) {
    return false;
  }

  try {
    const parsed = new ParsedUrl(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.trim() !== '';
  } catch {
    return false;
  }
}

function invalidRuntimeBoundaryFields(request: ProcessMessageRequest): string[] {
  const invalidFields: string[] = [];
  if (!normalizeOptionalString(request.requestId)) {
    invalidFields.push('requestId');
  }
  if (!normalizeOptionalString(request.eventId)) {
    invalidFields.push('eventId');
  }
  if (!Number.isInteger(request.runtimeAttempt) || request.runtimeAttempt === undefined || request.runtimeAttempt < 1) {
    invalidFields.push('runtimeAttempt');
  }
  if (!normalizeOptionalString(request.traceId)) {
    invalidFields.push('traceId');
  }
  return invalidFields;
}

function requiredCandidateDiagnostic(request: ProcessMessageRequest): MafAgentRuntimeDiagnostic {
  const missingCanonicalFields = REQUIRED_CANDIDATE_FIELDS.filter((field) => {
    if (field === 'conversation.sessionKey') {
      return !normalizeOptionalString(request.conversationSessionKey);
    }
    if (field === 'message.text') {
      return !normalizeOptionalString(request.messageText);
    }
    if (field === 'message.createdAt') {
      return !normalizeOptionalString(request.messageCreatedAt);
    }
    return !hasRuntimeContext(request.runtimeContext);
  });

  return {
    reasonCode: 'maf_runtime_boundary_request_invalid',
    missingCanonicalFields,
  };
}

function buildRuntimeProcessMessageRequest(request: ProcessMessageRequest): RuntimeProcessMessageRequest | null {
  const sessionKey = normalizeOptionalString(request.conversationSessionKey);
  const messageText = normalizeOptionalString(request.messageText);
  const messageCreatedAt = normalizeOptionalString(request.messageCreatedAt);
  const runtimeContext = hasRuntimeContext(request.runtimeContext) ? request.runtimeContext : null;
  if (!sessionKey || !messageText || !messageCreatedAt || !runtimeContext || request.runtimeAttempt === undefined) {
    return null;
  }

  const threadId = normalizeOptionalString(request.conversationThreadId);
    return {
      requestId: request.requestId ?? '',
      eventId: request.eventId ?? '',
      traceId: request.traceId,
    idempotencyKey: [
      'runtime',
      request.externalWorkspaceId,
      request.userId,
      request.externalConversationId,
      request.messageId,
      String(request.runtimeAttempt),
      ].join(':'),
      runtimeAttempt: request.runtimeAttempt,
      ...(request.requestPurpose ? { requestPurpose: request.requestPurpose } : {}),
      tenant: {
        id: request.tenantId,
        workspaceId: request.externalWorkspaceId,
    },
    user: {
      id: request.userId,
      ...optionalStringProperty('displayName', request.userDisplayName),
      ...optionalStringProperty('timezone', request.userTimezone),
      ...optionalStringProperty('locale', request.userLocale),
    },
    conversation: {
      id: request.conversationId,
      channel: 'slack',
      externalWorkspaceId: request.externalWorkspaceId,
      externalConversationId: request.externalConversationId,
      ...(threadId ? { threadId } : {}),
      sessionKey,
      },
      message: {
        id: request.messageId,
        text: messageText,
        createdAt: messageCreatedAt,
      },
      context: runtimeContext,
      ...(request.proactiveContext ? { proactiveContext: request.proactiveContext } : {}),
    };
  }

function optionalStringProperty<Key extends string>(
  key: Key,
  value: string | undefined,
): Record<Key, string> | Record<string, never> {
  const normalized = normalizeOptionalString(value);
  return normalized ? { [key]: normalized } as Record<Key, string> : {};
}

function hasRuntimeContext(value: RuntimeContext | undefined): value is RuntimeContext {
  return Boolean(value && Array.isArray(value.recentTurns) && Array.isArray(value.memoryItems) && Array.isArray(value.goals));
}

function isHttpResponse(value: unknown): value is { ok: boolean; status: number } {
  return typeof value === 'object' && value !== null && 'ok' in value && 'status' in value;
}

async function readJsonResponse(response: unknown): Promise<unknown> {
  if (
    typeof response === 'object' &&
    response !== null &&
    'json' in response &&
    typeof (response as { json?: unknown }).json === 'function'
  ) {
    return (response as { json: () => Promise<unknown> | unknown }).json();
  }

  return response;
}

function createTimeoutSignal(timeoutMs: number): unknown {
  const AbortControllerCtor = (globalThis as unknown as {
    AbortController?: new () => { abort: () => void; signal: unknown };
  }).AbortController;
  if (!AbortControllerCtor || timeoutMs <= 0) {
    return undefined;
  }

  const setTimeoutFn = (globalThis as unknown as {
    setTimeout?: (callback: () => void, timeoutMs: number) => unknown;
  }).setTimeout;
  if (!setTimeoutFn) {
    return undefined;
  }

  const controller = new AbortControllerCtor();
  setTimeoutFn(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function defaultFetch(): MafAgentRuntimeFetch | undefined {
  const fetchImpl = (globalThis as unknown as { fetch?: MafAgentRuntimeFetch }).fetch;
  return fetchImpl ? fetchImpl.bind(globalThis) : undefined;
}
