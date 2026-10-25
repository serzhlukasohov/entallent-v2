import type { GeneratedResponse, MemoryProposal, RiskDetection, SituationClassification } from '@entalent/contracts';
import {
  ScriptedAiProvider,
  makeClassification,
  makeMemoryProposal,
  makeRisk,
  type ScriptedAiOptions,
} from '../../fakes/scripted-ai';
import type { ScriptedStep } from '../schema';
import { SuiteExecutionError } from './types';

type ScriptedOutput = 'classification' | 'risk' | 'memoryProposal' | 'response';

/** A scripted model keyed by the step the executor is sending. */
export interface L0ScriptedModel {
  provider: ScriptedAiProvider;
  /** Model calls from now on read the outputs scripted for `step` (0 = fixtures and seed). */
  setStep(step: number): void;
  /**
   * The first missing-output error raised so far, also when product code caught the
   * throw, so a swallowed miss still ends the case loudly.
   */
  missing(): SuiteExecutionError | null;
}

/**
 * Maps the test's `scripted` entries onto `ScriptedAiOptions` functions keyed by the
 * current step (AD-14: L0 feeds the test's own outputs, never a default reply). A model
 * call whose output the current step does not script throws `SuiteExecutionError`
 * (`product`, `scripted-output-missing:<step>`). Scripted `classification`, `risk` and
 * `memoryProposal` records are applied over the synthetic baselines of
 * `fakes/scripted-ai.ts`; the presence of the key is what scripts the call. Model methods
 * outside `ScriptedStep` (bundle composition and interpretation, clarification, survey
 * evidence) keep the fixed outputs of `ScriptedAiProvider`.
 */
export function createL0ScriptedModel(scripted: readonly ScriptedStep[]): L0ScriptedModel {
  let step = 0;
  let firstMissing: SuiteExecutionError | null = null;

  const entry = (output: ScriptedOutput): ScriptedStep => {
    const found = scripted.find((candidate) => candidate.step === step);
    if (found && found[output] !== undefined) return found;
    const error = new SuiteExecutionError({
      kind: 'product',
      step,
      reason: `scripted-output-missing:${step}`,
      message: `step ${step} has no scripted ${output}, which the model call needs`,
    });
    firstMissing ??= error;
    throw error;
  };

  const options: ScriptedAiOptions = {
    classifications: [
      () => makeClassification(entry('classification').classification as Partial<SituationClassification>),
    ],
    risks: [() => makeRisk(entry('risk').risk as Partial<RiskDetection>)],
    memoryProposals: [
      () => makeMemoryProposal(entry('memoryProposal').memoryProposal as Partial<MemoryProposal>),
    ],
    responses: [
      ({ context }): GeneratedResponse => {
        const response = entry('response').response!;
        // A bundle turn answers first and then shows the product's fixed text (GC round 3 CAP-4).
        const bundleText = response.bundleText ?? context.trailingBundle?.text;
        return bundleText
          ? {
              text: `${response.text}\n\n${bundleText}`,
              replyText: response.text,
              bundleText,
              confidence: 0.9,
              containsSurveyProbe: false,
            }
          : { text: response.text, confidence: 0.9, containsSurveyProbe: false };
      },
    ],
  };

  return {
    provider: new ScriptedAiProvider(options),
    setStep(next) {
      step = next;
    },
    missing: () => firstMissing,
  };
}
