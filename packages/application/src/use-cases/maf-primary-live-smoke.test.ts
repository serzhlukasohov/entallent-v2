import { describe, expect, it, vi } from 'vitest';
import type { RuntimeResult } from '@entalent/contracts';
import { runMafPrimaryLiveSmoke } from './maf-primary-live-smoke';

const CANDIDATE_RESULT: RuntimeResult = {
  reply: {
    text: 'candidate text with sk-proj-secret',
    mode: 'normal',
  },
  riskAssessment: {
    type: null,
    severity: 'none',
    confidence: 0,
    evidence: ['candidate risk evidence must not leak'],
    immediateResponseRequired: false,
    escalationRecommended: false,
    surveyMustBeBlocked: false,
    proactiveMessagesMustBePaused: false,
  },
  memoryCandidates: [],
  proposedActions: [],
  classification: {
    primaryIntent: 'casual_conversation',
    secondaryIntents: [],
    emotionalState: [],
    urgency: 'low',
    confidence: 0.91,
    requiresSafetyCheck: false,
    surveyAllowed: true,
    reasoningSummary: 'primary candidate classification should stay internal',
    reminderRequest: null,
    dialogueAct: 'new_substance',
    latestUserSubstance: 'candidate user substance',
    topicAnchor: null,
  },
  diagnostics: {
    traceId: 'trace-live-maf-primary-smoke',
    runtimeVersion: 'agent-service-maf-core/1.13.0',
    runtimeAttempt: 1,
    modelCalls: 1,
    toolCalls: 0,
    latencyMs: 42,
    retryCount: 0,
    modelRetryCount: 0,
    toolRetryCount: 0,
    httpRetryCount: 0,
  },
};

describe('runMafPrimaryLiveSmoke', () => {
  it('returns redacted primary evidence after Python MAF output is persisted by TypeScript ports', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CANDIDATE_RESULT,
    }));

    const evidence = await runMafPrimaryLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toEqual({
      status: 'valid',
      validationStatus: 'contract_valid',
      traceId: 'trace-runtime-primary-smoke',
      primary: {
        mode: 'maf_primary',
        runtimeVersion: 'agent-service-maf-core/1.13.0',
        modelCalls: 1,
        toolCalls: 0,
        retryCount: 0,
        riskSeverity: 'none',
        outboundMessageSaved: true,
        messageSendQueued: true,
        memoryExtractionQueued: true,
        surveyEvidenceQueued: true,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('candidate text');
    expect(JSON.stringify(evidence)).not.toContain('sk-proj-secret');
    expect(JSON.stringify(evidence)).not.toContain('candidate risk evidence');
  });

  it('fails closed with a safe reason when the runtime response is invalid', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        classification: undefined,
        reply: {
          text: 'invalid candidate with bearer token',
        },
      }),
    }));

    const evidence = await runMafPrimaryLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toEqual({
      status: 'invalid',
      validationStatus: 'contract_invalid',
      traceId: 'trace-runtime-primary-smoke',
      failureReason: 'maf_runtime_response_invalid',
    });
    expect(JSON.stringify(evidence)).not.toContain('invalid candidate');
    expect(JSON.stringify(evidence)).not.toContain('bearer token');
  });

  it('reports non-none primary risk severity from the runtime result without leaking evidence', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        riskAssessment: {
          ...CANDIDATE_RESULT.riskAssessment,
          type: 'burnout',
          severity: 'high',
          confidence: 0.85,
          evidence: ['raw risk evidence must not leak'],
        },
      }),
    }));

    const evidence = await runMafPrimaryLiveSmoke({
      serviceUrl: 'http://127.0.0.1:8001',
      fetch: fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: 'valid',
      primary: {
        riskSeverity: 'high',
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('raw risk evidence');
  });

  it('treats modelCalls other than 1 as invalid primary smoke evidence', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...CANDIDATE_RESULT,
        diagnostics: {
          ...CANDIDATE_RESULT.diagnostics,
          modelCalls: 0,
        },
      }),
    }));

    await expect(
      runMafPrimaryLiveSmoke({
        serviceUrl: 'http://127.0.0.1:8001',
        fetch: fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: 'invalid',
      validationStatus: 'contract_valid',
      failureReason: 'model_call_count_invalid',
    });
  });
});
