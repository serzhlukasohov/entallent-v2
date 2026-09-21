import type { AiProviderPort } from '../ports/ai-provider.port';
import type {
  ConfirmedGroupReportStateRecord,
  SurveyRepositoryPort,
  SurveyTeamRecord,
} from '../ports/survey.repository.port';
import { isAcceptedDeidentificationDecision } from '../utils/deidentification-policy';

const GROUP_REPORT_SNAPSHOT_POLICY_VERSION = 'group-report-snapshot-v1';

export interface GroupReportInput {
  reportingCohortId: string;
  tenantId: string;
  teamId: string;
  questionGroup: string;
  reportKind?: 'intermediate' | 'final';
  now?: Date;
}

export interface GroupReportResult {
  shouldSend: boolean;
  managerSlackUserId: string | null;
  message: string;
  teamScore: number;
  confirmedCount: number;
  contributorUserIds: string[];
  sourceGroupStateIds: string[];
  policyVersion: typeof GROUP_REPORT_SNAPSHOT_POLICY_VERSION;
}

export class GroupReportUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly ai: AiProviderPort,
  ) {}

  async execute(input: GroupReportInput): Promise<GroupReportResult> {
    const team = await this.surveyRepo.findTeamById(input.teamId, input.tenantId, input.reportingCohortId);
    if (!isScopedTeam(team, input)) return emptyResult();
    if (input.reportKind === 'final' && (input.now ?? new Date()).getTime() < team.reportingPeriodEnd.getTime()) {
      return emptyResult();
    }

    const rosterUserIds = [...new Set(team.memberUserIds)];
    if (team.activeTeamSize !== rosterUserIds.length) {
      return emptyResult();
    }
    const required = input.reportKind === 'final'
      ? 5
      : Math.max(5, Math.ceil(0.8 * rosterUserIds.length));

    const reportableStates = await this.findReportableStates(input, team, rosterUserIds);

    if (reportableStates.length < required) {
      return emptyResult(reportableStates.length);
    }

    const scores = reportableStates
      .filter((s) => s.employeeScore !== null)
      .map((s) => s.employeeScore as number);

    const teamScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : 0;

    const teamSummaries = reportableStates
      .map((s) => s.reportableSummary as string);

    const report = await this.ai.generateGroupReport(
      teamSummaries,
      input.questionGroup,
      teamScore,
      null, // trend — future: compare previous window
    );

    const revalidatedTeam = await this.surveyRepo.findTeamById(input.teamId, input.tenantId, input.reportingCohortId);
    if (!isScopedTeam(revalidatedTeam, input)) return emptyResult();
    const revalidatedRosterUserIds = [...new Set(revalidatedTeam.memberUserIds)];
    const revalidatedStates = await this.findReportableStates(input, revalidatedTeam, revalidatedRosterUserIds);
    if (!sameStateSet(reportableStates, revalidatedStates)) return emptyResult(revalidatedStates.length);

    const groupLabel = input.questionGroup.charAt(0).toUpperCase() + input.questionGroup.slice(1);
    const quarter = Math.floor(team.reportingPeriodStart.getUTCMonth() / 3) + 1;
    const title = input.reportKind === 'final'
      ? `Final ${groupLabel} report`
      : groupLabel;
    const message = [
      `📊 *${title}* — Q${quarter} ${team.reportingPeriodStart.getUTCFullYear()}`,
      ``,
      `Score: *${teamScore.toFixed(1)} / 100*`,
      ``,
      `*What's happening:*`,
      report.explanation,
      ``,
      `*3 steps to improve:*`,
      ...report.actionItems.map((item) => `• ${item}`),
      ``,
      `───────────────────────────────`,
      `_Based on responses from ${reportableStates.length} team members. Results are anonymous._`,
    ].join('\n');

    return {
      shouldSend: true,
      managerSlackUserId: team.managerSlackUserId,
      message,
      teamScore,
      confirmedCount: reportableStates.length,
      contributorUserIds: reportableStates.map((state) => state.userId),
      sourceGroupStateIds: reportableStates.map((state) => state.id),
      policyVersion: GROUP_REPORT_SNAPSHOT_POLICY_VERSION,
    };
  }

  private async findReportableStates(
    input: GroupReportInput,
    team: SurveyTeamRecord,
    rosterUserIds: string[],
  ): Promise<ConfirmedGroupReportStateRecord[]> {
    if (
      team.activeTeamSize !== rosterUserIds.length
      || !team.reportingSurveyDefinitionId
      || !team.reportingPeriodStart
      || !team.reportingPeriodEnd
    ) return [];

    const confirmedStates = await this.surveyRepo.findConfirmedGroupStates({
      reportingCohortId: input.reportingCohortId,
      tenantId: input.tenantId,
      teamId: input.teamId,
      rosterUserIds,
      questionGroup: input.questionGroup,
    });

    const roster = new Set(rosterUserIds);
    const sameRoster = (candidate: string[]) =>
      candidate.length === rosterUserIds.length && candidate.every((userId, index) => userId === rosterUserIds[index]);
    const reportableByEmployee = new Map<string, (typeof confirmedStates)[number]>();
    for (const state of confirmedStates) {
      if (
        state.tenantId !== input.tenantId
        || state.reportingCohortId !== input.reportingCohortId
        || state.status !== 'confirmed'
        || state.questionGroup !== input.questionGroup
        || state.surveyDefinitionId !== team.reportingSurveyDefinitionId
        || state.reportingTeamId !== input.teamId
        || state.reportingPeriodStart.getTime() !== team.reportingPeriodStart.getTime()
        || state.reportingPeriodEnd.getTime() !== team.reportingPeriodEnd.getTime()
        || !sameRoster(state.reportingRosterUserIds)
        || !roster.has(state.userId)
        || !state.confirmedAt
        || state.confirmedAt.getTime() < team.reportingPeriodStart.getTime()
        || state.confirmedAt.getTime() >= team.reportingPeriodEnd.getTime()
        || !state.reportableSummary
        || state.withdrawnAt
        || !isAcceptedDeidentificationDecision(state.deidentificationDecision)
      ) continue;

      const current = reportableByEmployee.get(state.userId);
      const stateOrder = `${state.confirmedAt.toISOString()}:${state.id ?? ''}`;
      const currentOrder = current ? `${current.confirmedAt!.toISOString()}:${current.id ?? ''}` : '';
      if (!current || stateOrder > currentOrder) reportableByEmployee.set(state.userId, state);
    }
    return [...reportableByEmployee.values()];
  }
}

function emptyResult(confirmedCount = 0): GroupReportResult {
  return {
    shouldSend: false,
    managerSlackUserId: null,
    message: '',
    teamScore: 0,
    confirmedCount,
    contributorUserIds: [],
    sourceGroupStateIds: [],
    policyVersion: GROUP_REPORT_SNAPSHOT_POLICY_VERSION,
  };
}

function isScopedTeam(
  team: SurveyTeamRecord | null,
  input: GroupReportInput,
): team is SurveyTeamRecord & {
  reportingSurveyDefinitionId: string;
  reportingPeriodStart: Date;
  reportingPeriodEnd: Date;
} {
  return !!team
    && team.teamId === input.teamId
    && team.tenantId === input.tenantId
    && team.reportingCohortId === input.reportingCohortId
    && !!team.reportingSurveyDefinitionId
    && !!team.reportingPeriodStart
    && !!team.reportingPeriodEnd;
}

function sameStateSet(
  before: ConfirmedGroupReportStateRecord[],
  after: ConfirmedGroupReportStateRecord[],
): boolean {
  const key = (state: ConfirmedGroupReportStateRecord) =>
    `${state.id}:${state.userId}:${state.confirmedAt?.toISOString() ?? ''}:${state.reportableSummary ?? ''}`;
  return before.length === after.length
    && before.map(key).sort().join('\n') === after.map(key).sort().join('\n');
}
