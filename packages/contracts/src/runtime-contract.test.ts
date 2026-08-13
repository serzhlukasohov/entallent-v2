import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeActionProposal,
  RuntimeErrorResponse,
  RuntimeProcessMessageRequest,
  RuntimeResult,
} from './index';
import {
  RUNTIME_OPENAPI_SCHEMA,
  validateRuntimeContract,
  validateRuntimeErrorResponse,
  validateRuntimeProcessMessageRequest,
  validateRuntimeResult,
} from './runtime-contract-validation';

type ValidFixture = {
  schemaName: string;
  path: string;
};

type InvalidFixture = ValidFixture & {
  expectedErrorCategory: string;
};

type FixtureManifest = {
  valid: ValidFixture[];
  invalid: InvalidFixture[];
};

const runtimeRoot = join(process.cwd(), 'runtime');
const schemaDocument = readJson('openapi.json');
const manifest = readJson('fixtures/manifest.json') as FixtureManifest;

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(runtimeRoot, relativePath), 'utf8'));
}

describe('Runtime contract DTO exports', () => {
  it('exposes framework-neutral request, result, and error DTO types', () => {
    const request = readJson(
      'fixtures/valid/process-message-request.json',
    ) as RuntimeProcessMessageRequest;
    const result = readJson('fixtures/valid/runtime-result.json') as RuntimeResult;
    const error: RuntimeErrorResponse = {
      traceId: 'trace-runtime-contract-valid-error',
      errorCategory: 'timeout',
      retryable: true,
      fallbackAllowed: true,
      message: 'Synthetic runtime timeout.',
    };
    const action: RuntimeActionProposal = result.proposedActions[0]!;

    expect(request.context.recentTurns[0]?.role).toBe('user');
    expect(
      (
        readJson('fixtures/valid/proactive-check-in-request.json') as RuntimeProcessMessageRequest
      ).requestPurpose,
    ).toBe('proactive_check_in');
    expect(result.diagnostics.runtimeVersion).toBe('maf-contract-fixture');
    expect(result.reply.metadata?.containsSurveyProbe).toBe(true);
    expect(result.diagnostics.runtimeAttempt).toBe(1);
    expect(result.diagnostics.retryCount).toBe(0);
    expect(result.diagnostics.modelRetryCount).toBe(0);
    expect(result.diagnostics.toolRetryCount).toBe(0);
    expect(result.diagnostics.httpRetryCount).toBe(0);
    expect(action.actionType).toBe('save_memory');
    expect(action.validationResult.status).toBe('pending');
    expect(action.executionStatus).toBe('not_started');
    expect(action.commitMarker).toBeNull();
    expect(error.errorCategory).toBe('timeout');
  });
});

describe('Runtime contract fixtures', () => {
  it('exports the canonical runtime OpenAPI schema document for runtime boundary validators', () => {
    expect(RUNTIME_OPENAPI_SCHEMA).toEqual(schemaDocument);
  });

  it('validates named runtime contract schemas through OpenAPI', () => {
    expect(
      validateRuntimeProcessMessageRequest({
        schemaDocument,
        value: readJson('fixtures/valid/process-message-request.json'),
      }),
    ).toEqual({ ok: true });

    expect(
      validateRuntimeResult({
        schemaDocument,
        value: readJson('fixtures/valid/runtime-result.json'),
      }),
    ).toEqual({ ok: true });

    expect(
      validateRuntimeErrorResponse({
        schemaDocument,
        value: {
          traceId: 'trace-runtime-contract-valid-error',
          errorCategory: 'timeout',
          retryable: true,
          fallbackAllowed: true,
          message: 'Synthetic runtime timeout.',
        },
      }),
    ).toEqual({ ok: true });
  });

  it('accepts an explicit reply plan and policy on runtime context', () => {
    const request = readJson(
      'fixtures/valid/process-message-request.json',
    ) as RuntimeProcessMessageRequest;

    const withPolicy: RuntimeProcessMessageRequest = {
      ...request,
      context: {
        ...request.context,
        replyPlan: {
          dialogueAct: 'acknowledgement',
          latestUserSubstance: null,
          topicAnchor: 'Synthetic previous user message.',
          memoryAnchors: [],
          responseMove: 'continue_existing_thread',
          mayInferFromBrevity: false,
          questionPolicy: {
            maxQuestions: 0,
            reason: 'acknowledgement_no_new_substance',
          },
          requiredGrounding: [],
          forbiddenMoves: ['comment_on_brevity'],
        },
        replyPolicy: {
          maxChars: 680,
          maxQuestions: 0,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      },
    };

    expect(
      validateRuntimeProcessMessageRequest({
        schemaDocument,
        value: withPolicy,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts typed social reply plans on runtime context', () => {
    const request = readJson(
      'fixtures/valid/process-message-request.json',
    ) as RuntimeProcessMessageRequest;

    const withSocialPlan: RuntimeProcessMessageRequest = {
      ...request,
      context: {
        ...request.context,
        replyPlan: {
          dialogueAct: 'social_checkin',
          latestUserSubstance: null,
          topicAnchor: null,
          memoryAnchors: [],
          responseMove: 'social_reply',
          mayInferFromBrevity: false,
          questionPolicy: {
            maxQuestions: 1,
            reason: 'social_checkin_returns_question',
          },
          requiredGrounding: [],
          forbiddenMoves: ['operational_status', 'survey_probe'],
        },
        replyPolicy: {
          maxChars: 120,
          maxQuestions: 1,
          allowReflectiveOpener: false,
          allowListFormatting: false,
        },
      },
    };

    expect(
      validateRuntimeProcessMessageRequest({
        schemaDocument,
        value: withSocialPlan,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts deterministic support-emotion renderer diagnostics', () => {
    const result = readJson('fixtures/valid/runtime-result.json') as RuntimeResult;
    const withSupportRenderer: RuntimeResult = {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        replyRenderer: 'deterministic_support_emotion_reply',
      },
    };

    expect(
      validateRuntimeResult({
        schemaDocument,
        value: withSupportRenderer,
      }),
    ).toEqual({ ok: true });
  });

  it.each(manifest.valid)('accepts valid $path', (fixture) => {
    const result = validateRuntimeContract({
      schemaDocument,
      schemaName: fixture.schemaName,
      value: readJson(`fixtures/${fixture.path}`),
    });

    expect(result).toEqual({ ok: true });
  });

  it.each(manifest.invalid)(
    'rejects invalid $path with $expectedErrorCategory',
    (fixture) => {
      const result = validateRuntimeContract({
        schemaDocument,
        schemaName: fixture.schemaName,
        value: readJson(`fixtures/${fixture.path}`),
      });

      expect(result).toMatchObject({
        ok: false,
        errorCategory: fixture.expectedErrorCategory,
      });
    },
  );
});
