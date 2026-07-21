import type { AiProviderPort } from '../ports/ai-provider.port';
import type { SurveyRepositoryPort } from '../ports/survey.repository.port';

export interface GroupReportInput {
  teamId: string;
  questionGroup: string;
}

export interface GroupReportResult {
  shouldSend: boolean;
  managerSlackUserId: string | null;
  message: string;
  teamScore: number;
  confirmedCount: number;
}

export class GroupReportUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly ai: AiProviderPort,
  ) {}

  async execute(input: GroupReportInput): Promise<GroupReportResult> {
    const team = await this.surveyRepo.findTeamById(input.teamId);
    if (!team) return { shouldSend: false, managerSlackUserId: null, message: '', teamScore: 0, confirmedCount: 0 };

    const required = Math.max(5, Math.ceil(0.8 * team.activeTeamSize));

    const confirmedStates = await this.surveyRepo.findConfirmedGroupStates(
      team.memberUserIds,
      input.questionGroup,
    );

    if (confirmedStates.length < required) {
      return { shouldSend: false, managerSlackUserId: null, message: '', teamScore: 0, confirmedCount: confirmedStates.length };
    }

    const scores = confirmedStates
      .filter((s) => s.employeeScore !== null)
      .map((s) => s.employeeScore as number);

    const teamScore = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : 0;

    const teamSummaries = confirmedStates
      .filter((s) => s.aiSummary)
      .map((s) => s.aiSummary as string);

    const report = await this.ai.generateGroupReport(
      teamSummaries,
      input.questionGroup,
      teamScore,
      null, // trend — future: compare previous window
    );

    const groupLabel = input.questionGroup.charAt(0).toUpperCase() + input.questionGroup.slice(1);
    const message = [
      `📊 *${groupLabel}* — Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
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
      `_Based on responses from ${confirmedStates.length} team members. Results are anonymous._`,
    ].join('\n');

    return {
      shouldSend: true,
      managerSlackUserId: team.managerSlackUserId,
      message,
      teamScore,
      confirmedCount: confirmedStates.length,
    };
  }
}
