import type {
  AppliedQuestionVerdict,
  AwaitingQuestionBundle,
  CycleProgressSnapshot,
  PendingQuestionClarification,
  QuestionBundleKind,
  QuestionConfirmationPort,
  ReadyQuestionBundle,
} from '@entalent/application';

/**
 * Per-question status in the simulated V2 window. `confirmed` is an applied, agreed verdict.
 * `pending_clarification` is a statement disputed in a partial verdict (as in production);
 * fixtures seed the same state as `disputed` plus a pending clarification.
 */
export type SimQuestionStatus =
  | 'pending'
  | 'ready'
  | 'awaiting'
  | 'confirmed'
  | 'disputed'
  | 'pending_clarification'
  | 'declined';

/** Closed statuses: a group whose questions are all ready, confirmed or declined can be shown. */
const SHOWABLE_WITH_READY = new Set<SimQuestionStatus>(['ready', 'confirmed', 'declined']);

/**
 * The fake has no message store, so a staged or seeded clarification question counts as
 * delivered before any later employee message (production reads the prompt's `sentAt`).
 */
export const CLARIFICATION_PROMPT_DELIVERED_AT = new Date(0);
export const SEEDED_CLARIFICATION_PROMPT_ID = 'seeded-clarification-prompt';

export interface SimQuestion {
  surveyQuestionId: string;
  questionVersion: string;
  questionGroup: string;
  workingSummary: string;
  status: SimQuestionStatus;
}

interface StagedBundle extends AwaitingQuestionBundle {
  conversationId: string;
  promptMessageId: string;
  /** The inbound message whose verdict closed this bundle; null while it awaits a verdict. */
  answeredBy: string | null;
}

/**
 * Stateful in-memory `QuestionConfirmationPort` (one tenant, one user, one V2 window):
 * staged bundles, applied verdicts per inbound message and per question, and a pending
 * clarification. A ready bundle is derived from questions in status `ready`. It is a
 * simulation of the repository contract, not of its SQL; every write goes through the
 * port methods the orchestrator calls, plus `seed*` helpers for fixtures.
 */
export class InMemoryQuestionConfirmationRepository implements QuestionConfirmationPort {
  private window: { tenantId: string; userId: string; surveyWindowId: string } | null = null;
  private readonly questions: SimQuestion[] = [];
  private readonly staged: StagedBundle[] = [];
  private readonly applied = new Map<string, AppliedQuestionVerdict>();
  private pending: PendingQuestionClarification | null = null;
  /** Further disputed statements of the last partial verdict, asked after `pending` (production order). */
  private readonly queuedClarifications: PendingQuestionClarification[] = [];
  private sequence = 0;

  // ---------------------------------------------------------------------------
  // Fixture seeding (not part of the port)
  // ---------------------------------------------------------------------------

  /** Opens the V2 window with the given questions; replaces any earlier window. */
  seedWindow(input: { tenantId: string; userId: string; surveyWindowId: string; questions: SimQuestion[] }): void {
    this.window = { tenantId: input.tenantId, userId: input.userId, surveyWindowId: input.surveyWindowId };
    this.questions.splice(0, this.questions.length, ...input.questions.map((question) => ({ ...question })));
  }

  /**
   * Seeds a disputed statement whose clarification question was already asked and delivered
   * (the `confirmationState` fixture's "waiting for the employee's clarification"): a null
   * prompt id or sent time is filled with the seeded prompt, so the next employee message is
   * interpreted as the clarification, as in production.
   */
  seedPendingClarification(clarification: PendingQuestionClarification): void {
    this.pending = {
      ...clarification,
      clarificationPromptMessageId: clarification.clarificationPromptMessageId ?? SEEDED_CLARIFICATION_PROMPT_ID,
      clarificationPromptSentAt: clarification.clarificationPromptSentAt ?? CLARIFICATION_PROMPT_DELIVERED_AT,
    };
  }

  /** Bundles staged so far, including corrected statements (answered or not). */
  stagedBundleCount(): number {
    return this.staged.length;
  }

  /**
   * Confirmed questions over all questions of the window, or of `group` when given;
   * `{ 0, 0 }` without a window (or without questions in that group).
   */
  questionProgress(group?: string): { answered: number; total: number } {
    const questions = group === undefined ? this.questions : this.questions.filter((question) => question.questionGroup === group);
    return {
      answered: questions.filter((question) => question.status === 'confirmed').length,
      total: questions.length,
    };
  }

  pendingClarification(): PendingQuestionClarification | null {
    return this.pending ? { ...this.pending } : null;
  }

  // ---------------------------------------------------------------------------
  // QuestionConfirmationPort
  // ---------------------------------------------------------------------------

  async findCycleProgress(input: { tenantId: string; userId: string }): Promise<CycleProgressSnapshot | null> {
    if (!this.inScope(input)) return null;
    const groups = [...new Set(this.questions.map((question) => question.questionGroup))];
    return {
      surveyWindowId: this.window!.surveyWindowId,
      groups: groups.map((questionGroup) => ({
        questionGroup,
        questions: this.questions
          .filter((question) => question.questionGroup === questionGroup)
          .map((question) => ({ surveyQuestionId: question.surveyQuestionId, status: question.status })),
      })),
    };
  }

  async findAppliedQuestionVerdictForInbound(input: { inboundMessageId: string }): Promise<AppliedQuestionVerdict | null> {
    return this.applied.get(input.inboundMessageId) ?? null;
  }

  async findPendingQuestionClarification(input: { tenantId: string; userId: string }): Promise<PendingQuestionClarification | null> {
    return this.pending && this.pending.tenantId === input.tenantId && this.pending.userId === input.userId
      ? { ...this.pending }
      : null;
  }

  /**
   * Production (`question-insight.repository.ts` `previewPendingQuestionClarificationAfterBundleVerdict`):
   * before a partial verdict is applied, the clarification the first disputed statement (in
   * bundle order) will get, with no prompt yet. Null without disputed statements; a stale
   * bundle or an id outside its components throws as in production.
   */
  async previewPendingQuestionClarificationAfterBundleVerdict(input: {
    tenantId: string;
    userId: string;
    bundleId: string;
    disputedQuestionIds: string[];
  }): Promise<PendingQuestionClarification | null> {
    if (input.disputedQuestionIds.length === 0) return null;
    const awaiting = await this.findAwaitingQuestionBundle(input);
    if (!awaiting || awaiting.id !== input.bundleId) throw new Error('v2_clarification_preview_bundle_stale');
    const disputed = new Set(input.disputedQuestionIds);
    if (
      disputed.size !== input.disputedQuestionIds.length ||
      input.disputedQuestionIds.some((id) => !awaiting.components.some((component) => component.surveyQuestionId === id))
    ) {
      throw new Error('v2_clarification_preview_mapping_invalid');
    }
    const first = awaiting.components.find((component) => disputed.has(component.surveyQuestionId))!;
    return this.clarificationFor(awaiting, first);
  }

  /**
   * Production (`previewPendingQuestionClarificationAfterVerdict`): after the current
   * clarification is resolved, the next disputed statement of the same bundle, or null.
   */
  async previewPendingQuestionClarificationAfterVerdict(input: {
    workingInsightId: string;
  }): Promise<PendingQuestionClarification | null> {
    if (!this.pending || this.pending.workingInsightId !== input.workingInsightId) {
      throw new Error('v2_clarification_preview_scope_mismatch');
    }
    const next = this.queuedClarifications[0];
    return next ? { ...next } : null;
  }

  async stageQuestionClarificationPrompt(input: { workingInsightId: string; promptMessageId: string }): Promise<boolean> {
    if (!this.pending || this.pending.workingInsightId !== input.workingInsightId) return false;
    this.pending = {
      ...this.pending,
      clarificationPromptMessageId: input.promptMessageId,
      clarificationPromptSentAt: CLARIFICATION_PROMPT_DELIVERED_AT,
    };
    return true;
  }

  async applyQuestionClarificationVerdict(input: {
    workingInsightId: string;
    inboundMessageId: string;
    verdict: { kind: 'clarified'; correctedSummary: string } | { kind: 'declined' };
  }): Promise<boolean> {
    if (!this.pending || this.pending.workingInsightId !== input.workingInsightId) return false;
    const question = this.question(this.pending.surveyQuestionId);
    if (question) {
      if (input.verdict.kind === 'clarified') question.workingSummary = input.verdict.correctedSummary;
      question.status = input.verdict.kind === 'clarified' ? 'ready' : 'declined';
    }
    this.applied.set(input.inboundMessageId, {
      kind: 'clarification',
      verdictKind: input.verdict.kind,
      questionGroup: this.pending.questionGroup,
      ...(input.verdict.kind === 'declined' ? { questionNotCollected: true } : {}),
    });
    this.pending = this.queuedClarifications.shift() ?? null;
    return true;
  }

  async findAwaitingQuestionBundle(input: { tenantId: string; userId: string }): Promise<AwaitingQuestionBundle | null> {
    if (!this.inScope(input)) return null;
    const bundle = [...this.staged].reverse().find((candidate) => candidate.answeredBy === null);
    if (!bundle) return null;
    return {
      id: bundle.id,
      tenantId: bundle.tenantId,
      userId: bundle.userId,
      surveyWindowId: bundle.surveyWindowId,
      questionGroup: bundle.questionGroup,
      displayedText: bundle.displayedText,
      components: bundle.components.map((component) => ({ ...component })),
      ...(bundle.kind ? { kind: bundle.kind } : {}),
    };
  }

  async applyQuestionBundleVerdict(input: {
    inboundMessageId: string;
    bundleId: string;
    verdict:
      | { kind: 'agree' }
      | { kind: 'reject' }
      | { kind: 'partial'; acceptedQuestionIds: string[]; disputedQuestionIds: string[]; declinedQuestionIds: string[] };
  }): Promise<boolean> {
    const bundle = this.staged.find((candidate) => candidate.id === input.bundleId);
    if (!bundle || bundle.answeredBy !== null) return false;
    bundle.answeredBy = input.inboundMessageId;
    const ids = bundle.components.map((component) => component.surveyQuestionId);
    const statusOf = (id: string): SimQuestionStatus => {
      if (input.verdict.kind === 'agree') return 'confirmed';
      if (input.verdict.kind === 'reject') return 'disputed';
      if (input.verdict.acceptedQuestionIds.includes(id)) return 'confirmed';
      if (input.verdict.declinedQuestionIds.includes(id)) return 'declined';
      return 'pending_clarification';
    };
    for (const id of ids) {
      const question = this.question(id);
      if (question) question.status = statusOf(id);
    }
    // Production: every disputed statement waits for a clarification, asked one at a time
    // in bundle order; the first one is pending now.
    if (input.verdict.kind === 'partial') {
      const disputed = new Set(input.verdict.disputedQuestionIds);
      const clarifications = bundle.components
        .filter((component) => disputed.has(component.surveyQuestionId))
        .map((component) => this.clarificationFor(bundle, component));
      this.pending = clarifications.shift() ?? null;
      this.queuedClarifications.splice(0, this.queuedClarifications.length, ...clarifications);
    }
    this.applied.set(input.inboundMessageId, {
      kind: 'bundle',
      verdictKind: input.verdict.kind,
      questionGroup: bundle.questionGroup,
    });
    return true;
  }

  /**
   * Production (`findReadyQuestionBundle`): nothing while a shown bundle awaits its verdict or a
   * clarification is pending; otherwise the first group (in window order) with at least one
   * ready question whose every question is ready or already closed (confirmed or declined).
   * A group with a question still collecting evidence is not ready.
   */
  async findReadyQuestionBundle(input: { tenantId: string; userId: string }): Promise<ReadyQuestionBundle | null> {
    if (!this.inScope(input)) return null;
    if (this.staged.some((bundle) => bundle.answeredBy === null) || this.pending !== null) return null;
    const groups = [...new Set(this.questions.map((question) => question.questionGroup))];
    for (const questionGroup of groups) {
      const questions = this.questions.filter((question) => question.questionGroup === questionGroup);
      const ready = questions.filter((question) => question.status === 'ready');
      if (ready.length === 0 || !questions.every((question) => SHOWABLE_WITH_READY.has(question.status))) continue;
      return {
        tenantId: this.window!.tenantId,
        userId: this.window!.userId,
        surveyWindowId: this.window!.surveyWindowId,
        questionGroup,
        questions: ready.map((question) => ({
          surveyQuestionId: question.surveyQuestionId,
          questionVersion: question.questionVersion,
          workingSummary: question.workingSummary,
        })),
      };
    }
    return null;
  }

  async hasReadyQuestionBundle(input: { tenantId: string; userId: string }): Promise<boolean> {
    return (await this.findReadyQuestionBundle(input)) !== null;
  }

  async stageQuestionConfirmationBundle(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    promptMessageId: string;
    displayedText: string;
    components: Array<{ surveyQuestionId: string; questionVersion: string; statement: string; expectedWorkingSummary: string }>;
  }): Promise<string> {
    return this.stage(input, input.components, undefined);
  }

  async stageCorrectedStatementConfirmation(input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    surveyWindowId: string;
    questionGroup: string;
    workingInsightId: string;
    surveyQuestionId: string;
    questionVersion: string;
    promptMessageId: string;
    displayedText: string;
    statement: string;
    expectedWorkingSummary: string;
  }): Promise<string> {
    return this.stage(
      input,
      [{ surveyQuestionId: input.surveyQuestionId, questionVersion: input.questionVersion, statement: input.statement }],
      'corrected_statement',
    );
  }

  // ---------------------------------------------------------------------------

  private stage(
    input: {
      tenantId: string;
      userId: string;
      conversationId: string;
      surveyWindowId: string;
      questionGroup: string;
      promptMessageId: string;
      displayedText: string;
    },
    components: Array<{ surveyQuestionId: string; questionVersion: string; statement: string }>,
    kind: QuestionBundleKind | undefined,
  ): string {
    const id = `bundle-${++this.sequence}`;
    this.staged.push({
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId: input.conversationId,
      surveyWindowId: input.surveyWindowId,
      questionGroup: input.questionGroup,
      promptMessageId: input.promptMessageId,
      displayedText: input.displayedText,
      components: components.map(({ surveyQuestionId, questionVersion, statement }) => ({
        surveyQuestionId,
        questionVersion,
        statement,
      })),
      ...(kind ? { kind } : {}),
      answeredBy: null,
    });
    for (const component of components) {
      const question = this.question(component.surveyQuestionId);
      if (question) question.status = 'awaiting';
    }
    return id;
  }

  private clarificationFor(
    bundle: Pick<AwaitingQuestionBundle, 'tenantId' | 'userId' | 'surveyWindowId' | 'questionGroup'>,
    component: { surveyQuestionId: string; questionVersion: string; statement: string },
  ): PendingQuestionClarification {
    const question = this.question(component.surveyQuestionId);
    return {
      workingInsightId: `working-insight-${component.surveyQuestionId}`,
      tenantId: bundle.tenantId,
      userId: bundle.userId,
      surveyWindowId: bundle.surveyWindowId,
      surveyQuestionId: component.surveyQuestionId,
      questionVersion: component.questionVersion,
      questionGroup: bundle.questionGroup,
      workingSummary: question?.workingSummary ?? component.statement,
      disputedStatement: component.statement,
      clarificationPromptMessageId: null,
      clarificationPromptSentAt: null,
    };
  }

  private question(surveyQuestionId: string): SimQuestion | undefined {
    return this.questions.find((question) => question.surveyQuestionId === surveyQuestionId);
  }

  private inScope(input: { tenantId: string; userId: string }): boolean {
    return this.window !== null && this.window.tenantId === input.tenantId && this.window.userId === input.userId;
  }
}
