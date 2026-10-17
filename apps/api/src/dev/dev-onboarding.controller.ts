import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Logger, NotFoundException, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import {
  OnboardingActionSchema, OnboardingRoleSchema, QUEUE_NAMES, type OnboardingActionJob, type OnboardingDevIntroJob,
  type OnboardingReminderJob, type OnboardingSystemJob, type WorkCalendar,
} from '@entalent/contracts';
import { onboardingStates, people, users } from '@entalent/database';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { IngestionService } from '../channel/ingestion.service';
import { DatabaseService } from '../database/database.service';
import { CompanyCalendarService } from '../onboarding/company-calendar.service';
import { actionJobId, devSystemJobId, reminderJobId } from '../onboarding/job-ids';

type Role = ReturnType<typeof OnboardingRoleSchema.parse>;
type OnboardingQueueJobInput = OnboardingActionJob | OnboardingSystemJob | OnboardingDevIntroJob;

interface DevUserDto { tenantId?: string; userId: string }

const DEV_WORKSPACE = 'dev-workspace';
const DEV_OPERATOR = 'dev-console';
/** Dev tooling only, created on an explicit /onboard when the tenant has none; not a product default. */
export const DEV_WORK_CALENDAR: WorkCalendar = {
  timezone: 'Europe/Kyiv', workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00',
};

const pulseForRole = (role: Role): boolean => role === 'employee' || role === 'team_lead';
const nowTs = (): string => (Date.now() / 1000).toFixed(6);

/**
 * Local onboarding v2 console (scripts/chat.ts): provisions a dev person, simulates button clicks with the same
 * queue job Slack interactions produce, and exposes the state. Mounted only through DevModule (never in production).
 */
@Controller('dev/onboarding')
@UseGuards(ApiKeyGuard)
export class DevOnboardingController {
  private readonly logger = new Logger(DevOnboardingController.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly db: DatabaseService,
    private readonly calendar: CompanyCalendarService,
    @InjectQueue(QUEUE_NAMES.ONBOARDING_ACTION) private readonly actionQueue: Queue<OnboardingQueueJobInput>,
    @InjectQueue(QUEUE_NAMES.ONBOARDING_REMINDER) private readonly reminderQueue: Queue<OnboardingReminderJob>,
  ) {}

  @Post('start')
  @HttpCode(202)
  async start(@Body() body: DevUserDto & { userName?: string; role: string }) {
    const tenantId = this.tenantOf(body.tenantId);
    const externalUserId = this.userIdOf(body.userId);
    const role = this.roleOf(body.role);

    let calendarCreated = false;
    if (!(await this.calendar.get(tenantId))) {
      await this.calendar.configure(tenantId, DEV_WORK_CALENDAR, DEV_OPERATOR);
      calendarCreated = true;
    }

    const { userId: personId } = await this.ingestion.findOrCreateUser({
      tenantId, channelType: 'dev', externalWorkspaceId: DEV_WORKSPACE, externalUserId,
      displayName: body.userName ?? 'Dev User',
    });
    const { conversationId } = await this.ingestion.findOrCreateConversation({
      tenantId, userId: personId, channelType: 'dev', externalConversationId: `dev-conv-${externalUserId}`,
    });

    await this.db.client.transaction(async (tx) => {
      await tx.update(users).set({ status: 'active', deletedAt: null, updatedAt: new Date() })
        .where(and(eq(users.id, personId), eq(users.tenantId, tenantId)));
      const roleFields = { primaryRole: role, pulseParticipant: pulseForRole(role), lifecycleStatus: 'active' };
      await tx.insert(people).values({
        id: personId, tenantId, customerEmployeeId: `dev-${personId}`, workEmail: `dev-${personId}@dev.entalent.test`,
        displayName: body.userName?.trim() || externalUserId, ...roleFields,
      }).onConflictDoUpdate({ target: people.id, set: { ...roleFields, updatedAt: new Date() } });
      // Dev reset: the worker recreates the state with a fresh version when it sends the intro.
      await tx.delete(onboardingStates)
        .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId)));
    });

    await this.actionQueue.add('dev_intro', { kind: 'dev_intro', tenantId, personId });
    this.logger.log(`Dev onboarding start user=${externalUserId} role=${role} calendarCreated=${calendarCreated}`);
    return { userId: externalUserId, personId, conversationId, calendarCreated, calendar: await this.calendar.get(tenantId) };
  }

  @Post('click')
  @HttpCode(202)
  async click(@Body() body: DevUserDto & { action: string }) {
    const { tenantId, personId, externalUserId } = await this.personOf(body);
    const parsed = OnboardingActionSchema.safeParse(body.action);
    if (!parsed.success) throw new BadRequestException(`action must be one of ${OnboardingActionSchema.options.join(', ')}`);
    const row = await this.stateRow(tenantId, personId);
    if (!row?.introActionsMessageTs || !row.introChannelId) {
      throw new ConflictException({ error: 'buttons_not_delivered' });
    }
    const actionTs = nowTs();
    const job: OnboardingActionJob = {
      kind: 'button', tenantId, personId, action: parsed.data, actionTs,
      messageTs: row.introActionsMessageTs, channelId: row.introChannelId,
    };
    await this.actionQueue.add('action', job, { jobId: actionJobId(externalUserId, actionTs) });
    return { enqueued: true, action: parsed.data, actionTs, buttonsActive: row.buttonsActive };
  }

  @Post('remind-now')
  @HttpCode(202)
  async remindNow(@Body() body: DevUserDto) {
    const { tenantId, personId } = await this.personOf(body);
    const row = await this.stateRow(tenantId, personId);
    if (row?.reminderStatus !== 'scheduled') {
      throw new ConflictException({ error: 'reminder_not_scheduled', reminderStatus: row?.reminderStatus ?? null });
    }
    const now = new Date();
    const moved = await this.db.client.update(onboardingStates).set({ reminderDueAt: now, updatedAt: now })
      .where(and(eq(onboardingStates.id, row.id), eq(onboardingStates.reminderStatus, 'scheduled')))
      .returning({ id: onboardingStates.id });
    if (moved.length !== 1) throw new ConflictException({ error: 'reminder_not_scheduled', reminderStatus: null });
    const dueAt = now.toISOString();
    await this.reminderQueue.add('remind', { tenantId, personId, dueAt }, { jobId: reminderJobId(personId, now.getTime()) });
    return { enqueued: true, dueAt };
  }

  @Post('role')
  @HttpCode(202)
  async role(@Body() body: DevUserDto & { role: string }) {
    const { tenantId, personId } = await this.personOf(body);
    const to = this.roleOf(body.role);
    const [person] = await this.db.client.select({ role: people.primaryRole }).from(people)
      .where(and(eq(people.id, personId), eq(people.tenantId, tenantId))).limit(1);
    if (!person) throw new NotFoundException('dev person not provisioned; run /onboard first');
    const from = this.roleOf(person.role);
    if (from === to) throw new ConflictException({ error: 'role_unchanged', role: to });
    await this.db.client.update(people).set({ primaryRole: to, pulseParticipant: pulseForRole(to), updatedAt: new Date() })
      .where(and(eq(people.id, personId), eq(people.tenantId, tenantId)));
    await this.actionQueue.add('system', { kind: 'system', tenantId, personId, event: { type: 'role_changed', from, to } },
      { jobId: devSystemJobId(personId, Date.now()) });
    return { enqueued: true, from, to };
  }

  @Get('state/:userId')
  async state(@Param('userId') userId: string, @Query('tenantId') tenantIdParam?: string) {
    const { tenantId, personId } = await this.personOf({ tenantId: tenantIdParam, userId });
    const row = await this.stateRow(tenantId, personId);
    const [user] = await this.db.client.select({ proactiveMessagingEnabled: users.proactiveMessagingEnabled })
      .from(users).where(and(eq(users.id, personId), eq(users.tenantId, tenantId))).limit(1);
    return {
      personId,
      proactiveMessagingEnabled: user?.proactiveMessagingEnabled ?? null,
      state: row ? {
        track: row.track, introStatus: row.introStatus, participation: row.participation,
        reminderStatus: row.reminderStatus, reminderDueAt: row.reminderDueAt, buttonsActive: row.buttonsActive,
        introChannelId: row.introChannelId, introActionsMessageTs: row.introActionsMessageTs, version: row.version,
      } : null,
    };
  }

  private tenantOf(tenantId: string | undefined): string {
    const resolved = tenantId?.trim() || process.env['DEFAULT_TENANT_ID'] || '';
    if (!resolved) throw new BadRequestException('tenantId is required');
    return resolved;
  }

  private userIdOf(userId: unknown): string {
    if (typeof userId !== 'string' || !userId.trim()) throw new BadRequestException('userId is required');
    return userId.trim();
  }

  private roleOf(role: unknown): Role {
    const parsed = OnboardingRoleSchema.safeParse(role);
    if (!parsed.success) throw new BadRequestException(`role must be one of ${OnboardingRoleSchema.options.join(', ')}`);
    return parsed.data;
  }

  private async personOf(body: Partial<DevUserDto>): Promise<{ tenantId: string; personId: string; externalUserId: string }> {
    const tenantId = this.tenantOf(body.tenantId);
    const externalUserId = this.userIdOf(body.userId);
    const personId = await this.ingestion.findLinkedPersonId({
      tenantId, channelType: 'dev', externalWorkspaceId: DEV_WORKSPACE, externalUserId,
    });
    if (!personId) throw new NotFoundException(`unknown dev user ${externalUserId}; run /onboard first`);
    return { tenantId, personId, externalUserId };
  }

  private async stateRow(tenantId: string, personId: string) {
    const [row] = await this.db.client.select().from(onboardingStates)
      .where(and(eq(onboardingStates.tenantId, tenantId), eq(onboardingStates.personId, personId))).limit(1);
    return row;
  }
}
