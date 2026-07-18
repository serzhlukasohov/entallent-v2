import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Env } from '@entalent/config';

export const IS_PUBLIC = 'isPublic';

/** Mark a route as public (no API key required) */
export const Public = () =>
  (_target: object, _key: string | symbol, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(IS_PUBLIC, true, descriptor.value);
    return descriptor;
  };

/**
 * Validates `X-Api-Key` header against ADMIN_API_KEY env var.
 *
 * In development (no ADMIN_API_KEY configured): all requests pass through with a warning.
 * In production: requests without a valid key are rejected with 401/403.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.get<boolean>(IS_PUBLIC, context.getHandler());
    if (isPublic) return true;

    const adminKey = this.config.get('ADMIN_API_KEY', { infer: true });

    // No key configured. Fail-closed in production so admin/sensitive endpoints are
    // never silently exposed; allow in dev/test with a loud warning.
    if (!adminKey) {
      const nodeEnv = this.config.get('NODE_ENV', { infer: true });
      if (nodeEnv === 'production') {
        throw new UnauthorizedException('ADMIN_API_KEY is not configured — refusing access');
      }
      this.logger.warn('ADMIN_API_KEY not set — admin endpoints are UNPROTECTED (dev only)');
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const providedKey = request.headers['x-api-key'];

    if (!providedKey) {
      throw new UnauthorizedException('X-Api-Key header is required');
    }

    if (providedKey !== adminKey) {
      throw new ForbiddenException('Invalid API key');
    }

    return true;
  }
}
