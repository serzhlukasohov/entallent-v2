import { Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CompanyAdminSessionService } from './company-admin-session.service';

const STATE_COOKIE = '__Host-entalent-oidc-state';
export const SESSION_COOKIE = '__Host-entalent-company-session';

@Controller('company-auth')
export class CompanyAuthController {
  constructor(private readonly sessions: CompanyAdminSessionService) {}

  @Get('start/:tenantId')
  async start(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { authorizationUrl, state } = await this.sessions.start(tenantId);
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', cookie(STATE_COOKIE, state, 600));
    reply.redirect(302, authorizationUrl);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    reply.header('Set-Cookie', cookie(STATE_COOKIE, '', 0));
    const browserState = readCookie(request.headers.cookie, STATE_COOKIE);
    if (typeof code !== 'string' || !code || typeof state !== 'string' || !state || !browserState) {
      throw new UnauthorizedException('Company Admin access denied');
    }
    const session = await this.sessions.complete(code, state, browserState);
    reply.header('Set-Cookie', [
      cookie(STATE_COOKIE, '', 0),
      cookie(SESSION_COOKIE, session.token, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    ]);
    reply.redirect(303, '/api/v1/company-setup/ui');
  }

  @Get('me')
  async me(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException('Company Admin access denied');
    const session = await this.sessions.resolve(token);
    reply.send({ tenantId: session.tenantId, personId: session.personId,
      csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() });
  }

  @Post('logout')
  async logout(
    @Req() request: FastifyRequest,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token || !this.sessions.verifyCsrf(token, csrfToken)) {
      throw new UnauthorizedException('Company Admin access denied');
    }
    await this.sessions.revoke(token);
    reply.header('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
    reply.send({ authenticated: false });
  }
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, maxAge)}; Secure; HttpOnly; SameSite=Lax`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const matches = header.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}
