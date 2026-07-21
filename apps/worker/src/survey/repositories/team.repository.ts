import { Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { teams, teamMemberships } from '@entalent/database';
import { DatabaseService } from '../../database/database.service';

type TeamInfo = {
  teamId: string;
  managerSlackUserId: string | null;
  activeTeamSize: number;
  memberUserIds: string[];
};

@Injectable()
export class TeamRepository {
  constructor(private readonly db: DatabaseService) {}

  async findTeamByMemberId(userId: string): Promise<TeamInfo | null> {
    const [membership] = await this.db.client
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.userId, userId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
        ),
      )
      .limit(1);

    if (!membership) return null;

    return this.findTeamById(membership.teamId);
  }

  async findTeamTenantId(teamId: string): Promise<string | null> {
    const [row] = await this.db.client
      .select({ tenantId: teams.tenantId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    return row?.tenantId ?? null;
  }

  async findTeamById(teamId: string): Promise<TeamInfo | null> {
    const [team] = await this.db.client
      .select()
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);

    if (!team) return null;

    const members = await this.db.client
      .select({ userId: teamMemberships.userId })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.role, 'member'),
          isNull(teamMemberships.leftAt),
        ),
      );

    return {
      teamId: team.id,
      managerSlackUserId: team.managerSlackUserId,
      activeTeamSize: members.length,
      memberUserIds: members.map((m) => m.userId),
    };
  }
}
