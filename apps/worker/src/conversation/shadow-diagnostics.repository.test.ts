import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ShadowDiagnosticsRepository } from './shadow-diagnostics.repository';

const runtimeAttempt = {
  id: 'attempt-1',
  tenantId: 'tenant-1',
  messageId: 'message-1',
  runtimeMode: 'maf_shadow',
  traceId: 'trace-1',
};

function createDbMock() {
  const returning = vi.fn().mockResolvedValue([{ id: 'diagnostics-1' }]);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate, returning }));
  const insert = vi.fn(() => ({ values }));
  const limit = vi.fn().mockResolvedValue([runtimeAttempt]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
    callback({ insert, select }),
  );

  return {
    client: {
      insert,
      select,
      transaction,
    },
    calls: {
      insert,
      select,
      from,
      where,
      limit,
      values,
      onConflictDoUpdate,
      returning,
      transaction,
    },
  };
}

function makeDiagnostics(overrides: Partial<Parameters<ShadowDiagnosticsRepository['recordShadowDiagnostics']>[0]> = {}) {
  return {
    tenantId: 'tenant-1',
    messageId: 'message-1',
    runtimeAttemptId: 'attempt-1',
    runtimeMode: 'maf_shadow' as const,
    traceId: 'trace-1',
    runtimeVersion: 'ts-runtime@3.2-test',
    validationStatus: 'valid' as const,
    currentResult: { replyDigest: 'sha256:current', riskSeverity: 'none' },
    candidateResult: { replyDigest: 'sha256:candidate', riskSeverity: 'none' },
    riskComparison: { status: 'same' },
    memoryComparison: { status: 'same' },
    actionComparison: { status: 'same' },
    validationDetails: { reasonCodes: [] },
    latencyMs: 123,
    modelCallCount: 2,
    toolCallCount: 1,
    retryCount: 0,
    estimatedCost: 0.00042,
    ...overrides,
  };
}

describe('ShadowDiagnosticsRepository', () => {
  it('persists diagnostics idempotently for one runtime attempt and runtime version', async () => {
    const db = createDbMock();
    const repository = new ShadowDiagnosticsRepository(db as never);

    await expect(repository.recordShadowDiagnostics(makeDiagnostics())).resolves.toEqual({
      id: 'diagnostics-1',
    });

    expect(db.calls.transaction).toHaveBeenCalledTimes(1);
    expect(db.calls.values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        messageId: 'message-1',
        runtimeAttemptId: 'attempt-1',
        runtimeMode: 'maf_shadow',
        traceId: 'trace-1',
        runtimeVersion: 'ts-runtime@3.2-test',
        validationStatus: 'valid',
        redactionStatus: 'not_required',
        latencyMs: 123,
        modelCallCount: 2,
        toolCallCount: 1,
        retryCount: 0,
        estimatedCost: '0.000420',
      }),
    );
    expect(db.calls.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('requires an existing tenant-scoped runtime attempt', async () => {
    const db = createDbMock();
    db.calls.limit.mockResolvedValueOnce([]);
    const repository = new ShadowDiagnosticsRepository(db as never);

    await expect(repository.recordShadowDiagnostics(makeDiagnostics())).rejects.toThrow(
      'shadow_diagnostics_runtime_attempt_not_found',
    );
    expect(db.calls.values).not.toHaveBeenCalled();
  });

  it('requires diagnostics metadata to match the runtime attempt', async () => {
    const db = createDbMock();
    db.calls.limit.mockResolvedValueOnce([{ ...runtimeAttempt, traceId: 'trace-other' }]);
    const repository = new ShadowDiagnosticsRepository(db as never);

    await expect(repository.recordShadowDiagnostics(makeDiagnostics())).rejects.toThrow(
      'shadow_diagnostics_runtime_attempt_mismatch',
    );
    expect(db.calls.values).not.toHaveBeenCalled();
  });

  it('redacts raw candidate text, risk evidence, memory content, action payload, and provider errors before persistence', async () => {
    const db = createDbMock();
    const repository = new ShadowDiagnosticsRepository(db as never);

    await repository.recordShadowDiagnostics(
      makeDiagnostics({
        candidateResult: {
          text: 'I can quote the raw user message.',
          riskEvidence: ['raw crisis evidence'],
          memoryContent: 'raw memory content',
          actionPayload: { intent: 'raw follow-up payload' },
          providerError: 'raw provider stack trace',
        },
      }),
    );

    const persisted = db.calls.values.mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain('I can quote the raw user message');
    expect(JSON.stringify(persisted)).not.toContain('raw crisis evidence');
    expect(JSON.stringify(persisted)).not.toContain('raw memory content');
    expect(JSON.stringify(persisted)).not.toContain('raw follow-up payload');
    expect(JSON.stringify(persisted)).not.toContain('raw provider stack trace');
    expect(persisted).toMatchObject({
      redactionStatus: 'redacted',
      redactionDetails: {
        reasonCodes: expect.arrayContaining([
          'raw_text_redacted',
          'risk_evidence_redacted',
          'memory_content_redacted',
          'action_payload_redacted',
          'provider_error_redacted',
        ]),
      },
    });
  });

  it('redacts free-form diagnostic strings and identity names before persistence', async () => {
    const db = createDbMock();
    const repository = new ShadowDiagnosticsRepository(db as never);

    await repository.recordShadowDiagnostics(
      makeDiagnostics({
        currentResult: 'raw root diagnostic text',
        candidateResult: {
          reply: 'raw candidate reply',
          stackTrace: 'raw provider stack',
          tenantName: 'Acme People',
          workspaceName: 'People Ops',
          nested: {
            summary: 'raw unrecognized summary',
            reasonCodes: ['stable_reason_code'],
            correlationId: 'message-uuid-only',
          },
        },
      }),
    );

    const persisted = db.calls.values.mock.calls[0]?.[0];
    expect(JSON.stringify(persisted)).not.toContain('raw root diagnostic text');
    expect(JSON.stringify(persisted)).not.toContain('raw candidate reply');
    expect(JSON.stringify(persisted)).not.toContain('raw provider stack');
    expect(JSON.stringify(persisted)).not.toContain('Acme People');
    expect(JSON.stringify(persisted)).not.toContain('People Ops');
    expect(JSON.stringify(persisted)).not.toContain('raw unrecognized summary');
    expect(JSON.stringify(persisted)).toContain('stable_reason_code');
    expect(JSON.stringify(persisted)).toContain('message-uuid-only');
    expect(persisted).toMatchObject({
      redactionStatus: 'redacted',
      redactionDetails: {
        reasonCodes: expect.arrayContaining([
          'raw_text_redacted',
          'provider_error_redacted',
          'identity_text_redacted',
        ]),
      },
    });
  });

  it('does not introduce out-of-scope MAF service or client files', () => {
    const repoRoot = join(process.cwd(), '../..');

    expect(existsSync(join(repoRoot, 'agent-service'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/application/src/use-cases/maf-agent-runtime-client.ts'))).toBe(false);
  });
});
