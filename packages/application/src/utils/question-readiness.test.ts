import { describe, expect, it } from 'vitest';
import { accumulateQuestionReadiness, needsDriver } from './question-readiness';

describe('question readiness (GC round 3 CAP-2)', () => {
  it('keeps a status without a driver not ready', () => {
    expect(accumulateQuestionReadiness(null, { sufficientMeaning: true, driverCaptured: false, driverDeclined: false }))
      .toEqual({ meaningSufficient: true, driverResolved: false, ready: false });
  });

  it('becomes ready when the driver arrives in a later message', () => {
    const first = accumulateQuestionReadiness(null, { sufficientMeaning: true, driverCaptured: false, driverDeclined: false });
    expect(accumulateQuestionReadiness(first, { sufficientMeaning: false, driverCaptured: true, driverDeclined: false }).ready)
      .toBe(true);
  });

  it('honours an explicit decline on the first refusal', () => {
    expect(accumulateQuestionReadiness(null, { sufficientMeaning: true, driverCaptured: false, driverDeclined: true }).ready)
      .toBe(true);
  });

  it('needs the driver only for a collecting status that is otherwise sufficient', () => {
    const base = { status: 'collecting', readyForConfirmation: false, meaningSufficient: true, driverResolved: false, driverRequested: false };
    expect(needsDriver(base)).toBe(true);
    expect(needsDriver({ ...base, meaningSufficient: false })).toBe(false);
    expect(needsDriver({ ...base, readyForConfirmation: true })).toBe(false);
    expect(needsDriver({ ...base, status: 'confirmed' })).toBe(false);
    expect(needsDriver({ ...base, driverRequested: true })).toBe(false);
  });
});
