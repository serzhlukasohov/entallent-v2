import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException,
  Get, Param, ParseUUIDPipe, Post, Req, UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DraftPersonValidationError, DraftStructureValidationError } from '@entalent/application';
import { CompanyAdminSessionService } from '../company-auth/company-admin-session.service';
import { readCookie, SESSION_COOKIE } from '../company-auth/company-auth.controller';
import { CompanySetupReadService } from './company-setup-read.service';
import {
  HierarchyCsvValidationError, HierarchyDraftReferenceError, HierarchyDraftService,
} from './hierarchy-draft.service';
import { HierarchyAuthorizationError } from './hierarchy-authorization';
import { HierarchyRolloutError, HierarchyRolloutService } from './hierarchy-rollout.service';
import { HierarchySlackLinkError, HierarchySlackLinkService } from './hierarchy-slack-link.service';
import { HierarchyMutationError, HierarchyMutationService } from './hierarchy-mutation.service';
import { HierarchyCapabilityError, HierarchyCapabilityService } from './hierarchy-capability.service';
import { HierarchyAdvisorScopeError, HierarchyAdvisorScopeService } from './hierarchy-advisor-scope.service';
import { HierarchyDeactivationError, HierarchyDeactivationService } from './hierarchy-deactivation.service';

@Controller('company-setup')
export class CompanySetupController {
  constructor(
    private readonly sessions: CompanyAdminSessionService,
    private readonly reads: CompanySetupReadService,
    private readonly drafts: HierarchyDraftService,
    private readonly slack: HierarchySlackLinkService,
    private readonly rollout: HierarchyRolloutService,
    private readonly mutations: HierarchyMutationService,
    private readonly capabilities: HierarchyCapabilityService,
    private readonly advisorScopes: HierarchyAdvisorScopeService,
    private readonly deactivations: HierarchyDeactivationService,
  ) {}

  @Get('snapshot')
  async snapshot(@Req() request: FastifyRequest) {
    const session = await this.authorize(request, false);
    return this.reads.snapshot(session.tenantId);
  }

  @Post('persons')
  async createPerson(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.createPerson(session.tenantId, {
      customerEmployeeId: required(input, 'customerEmployeeId'),
      workEmail: required(input, 'workEmail'),
      displayName: required(input, 'displayName'),
      jobTitle: optional(input, 'jobTitle'),
      primaryRole: required(input, 'primaryRole') as never,
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('persons/:personId/draft')
  async updateDraftPerson(@Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.updatePerson(session.tenantId, personId, {
      customerEmployeeId: required(input, 'customerEmployeeId'),
      workEmail: required(input, 'workEmail'), displayName: required(input, 'displayName'),
      jobTitle: optional(input, 'jobTitle'), primaryRole: required(input, 'primaryRole') as never,
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('units')
  async createUnit(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.createUnit(session.tenantId, {
      customerUnitKey: required(input, 'customerUnitKey'),
      name: required(input, 'name'),
      managerPersonId: optional(input, 'managerPersonId'),
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('units/:unitId/draft')
  async updateDraftUnit(@Req() request: FastifyRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.updateUnit(session.tenantId, unitId, {
      customerUnitKey: required(input, 'customerUnitKey'), name: required(input, 'name'),
      managerPersonId: optional(input, 'managerPersonId'),
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('teams')
  async createTeam(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.createTeam(session.tenantId, {
      customerTeamKey: required(input, 'customerTeamKey'),
      name: required(input, 'name'),
      unitId: required(input, 'unitId'),
      teamLeadPersonId: optional(input, 'teamLeadPersonId'),
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('teams/:teamId/draft')
  async updateDraftTeam(@Req() request: FastifyRequest,
    @Param('teamId', ParseUUIDPipe) teamId: string, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.updateTeam(session.tenantId, teamId, {
      customerTeamKey: required(input, 'customerTeamKey'), name: required(input, 'name'),
      unitId: required(input, 'unitId'), teamLeadPersonId: optional(input, 'teamLeadPersonId'),
    }, { type: 'company_admin', personId: session.personId }));
  }

  @Post('persons/:personId/draft-placement')
  async replaceDraftPlacement(@Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.drafts.replaceDraftPlacement(session.tenantId, personId,
      optional(input, 'targetUnitId'), optional(input, 'targetTeamId'),
      { type: 'company_admin', personId: session.personId }));
  }

  @Post('csv/preview')
  async previewCsv(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.drafts.previewCsv(
      session.tenantId, required(record(body), 'csv', 1_000_000),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('csv/import')
  async importCsv(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.drafts.importCsv(
      session.tenantId, required(record(body), 'csv', 1_000_000),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/slack/email')
  async linkByEmail(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.slack.linkByEmail(
      session.tenantId, personId, required(record(body), 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/slack/manual')
  async linkManually(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.slack.linkManually(
      session.tenantId, personId, required(input, 'workspaceId'), required(input, 'externalUserId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/slack/unlink')
  async unlinkDraft(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.slack.unlinkDraft(
      session.tenantId, personId, required(record(body), 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/rollout/preview')
  async previewUnits(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.rollout.previewUnits(
      session.tenantId, requiredUnitIds(input), required(input, 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/rollout')
  async activateUnits(@Req() request: FastifyRequest, @Body() body: unknown) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.rollout.activateUnits(
      session.tenantId, requiredUnitIds(input), required(input, 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/:unitId/rollout')
  async activateUnit(
    @Req() request: FastifyRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.rollout.activateUnit(
      session.tenantId, unitId, required(record(body), 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/:unitId/preview')
  async previewUnit(
    @Req() request: FastifyRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.rollout.previewUnit(
      session.tenantId, unitId, required(record(body), 'workspaceId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/move')
  async moveEmployee(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.mutations.moveEmployee(
      session.tenantId, personId, required(input, 'targetUnitId'), optional(input, 'targetTeamId'),
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('teams/:teamId/promote-lead')
  async promoteTeamLead(
    @Req() request: FastifyRequest,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    const previousLeadAction = required(input, 'previousLeadAction');
    if (previousLeadAction !== 'become_employee' && previousLeadAction !== 'deactivate') {
      throw new BadRequestException({ field: 'previousLeadAction', code: 'invalid' });
    }
    return this.execute(() => this.mutations.promoteTeamLead(
      session.tenantId, teamId, required(input, 'employeePersonId'), previousLeadAction,
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/:unitId/promote-manager')
  async promoteManager(
    @Req() request: FastifyRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    const previousManagerAction = required(input, 'previousManagerAction');
    if (previousManagerAction !== 'become_employee' && previousManagerAction !== 'deactivate') {
      throw new BadRequestException({ field: 'previousManagerAction', code: 'invalid' });
    }
    return this.execute(() => this.mutations.promoteManager(
      session.tenantId, unitId, required(input, 'employeePersonId'), previousManagerAction,
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/advisor-scope')
  async replaceAdvisorScope(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    return this.execute(() => this.advisorScopes.replaceScope(
      session.tenantId, personId,
      { scopeMode: input.scopeMode, unitIds: input.unitIds },
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/deactivate')
  async deactivatePerson(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.deactivations.deactivatePerson(
      session.tenantId, personId,
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('teams/:teamId/deactivate')
  async deactivateTeam(
    @Req() request: FastifyRequest,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    const leadAction = required(input, 'leadAction');
    if (leadAction !== 'become_employee' && leadAction !== 'deactivate') {
      throw new BadRequestException({ field: 'leadAction', code: 'invalid' });
    }
    return this.execute(() => this.deactivations.deactivateTeam(
      session.tenantId, teamId, leadAction,
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('units/:unitId/transfer-deactivate')
  async transferAndDeactivateUnit(
    @Req() request: FastifyRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Body() body: unknown,
  ) {
    const session = await this.authorize(request, true);
    const input = record(body);
    const managerAction = required(input, 'managerAction');
    if (managerAction !== 'become_employee' && managerAction !== 'deactivate') {
      throw new BadRequestException({ field: 'managerAction', code: 'invalid' });
    }
    return this.execute(() => this.deactivations.transferAndDeactivateUnit(
      session.tenantId, unitId, required(input, 'targetUnitId'), managerAction,
      { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/company-admin/grant')
  async grantCompanyAdmin(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.capabilities.grantCompanyAdmin(
      session.tenantId, personId, { type: 'company_admin', personId: session.personId },
    ));
  }

  @Post('persons/:personId/company-admin/revoke')
  async revokeCompanyAdmin(
    @Req() request: FastifyRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
  ) {
    const session = await this.authorize(request, true);
    return this.execute(() => this.capabilities.revokeCompanyAdmin(
      session.tenantId, personId, { type: 'company_admin', personId: session.personId },
    ));
  }

  private async authorize(request: FastifyRequest, mutable: boolean) {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException('Company Admin access denied');
    const session = await this.sessions.resolve(token);
    if (mutable) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !this.sessions.verifyCsrf(token, csrf)) {
        throw new ForbiddenException('CSRF proof required');
      }
    }
    return session;
  }

  private async execute<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HierarchyAuthorizationError) throw new ForbiddenException(error.message);
      if (error instanceof DraftPersonValidationError || error instanceof DraftStructureValidationError ||
          error instanceof HierarchyDraftReferenceError) {
        throw new BadRequestException({ field: error.field, code: error.code });
      }
      if (error instanceof HierarchyCsvValidationError) {
        throw new UnprocessableEntityException({ errors: error.errors });
      }
      if (error instanceof HierarchyRolloutError) {
        throw new UnprocessableEntityException({ code: error.code, issues: error.issues });
      }
      if (error instanceof HierarchyMutationError) {
        throw new UnprocessableEntityException({ code: error.code, issues: error.issues });
      }
      if (error instanceof HierarchyCapabilityError) {
        throw new UnprocessableEntityException({ code: error.code });
      }
      if (error instanceof HierarchyAdvisorScopeError) {
        throw new UnprocessableEntityException({ code: error.code });
      }
      if (error instanceof HierarchyDeactivationError) {
        throw new UnprocessableEntityException({ code: error.code, issues: error.issues });
      }
      if (error instanceof HierarchySlackLinkError) throw new ConflictException({ code: error.code });
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new ConflictException({ code: 'duplicate' });
      }
      throw error;
    }
  }
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('JSON object required');
  return input as Record<string, unknown>;
}

function required(input: Record<string, unknown>, field: string, maxLength = 500): string {
  const value = input[field];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new BadRequestException({ field, code: 'required_or_too_long' });
  }
  return value;
}

function optional(input: Record<string, unknown>, field: string): string | null {
  const value = input[field];
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 500) throw new BadRequestException({ field, code: 'invalid' });
  return value.trim() || null;
}

function requiredUnitIds(input: Record<string, unknown>): string[] {
  const value = input['unitIds'];
  if (!Array.isArray(value) || value.length === 0 || value.length > 100 ||
      value.some((id) => typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
      new Set(value).size !== value.length) {
    throw new BadRequestException({ field: 'unitIds', code: 'invalid_selection' });
  }
  return value as string[];
}
