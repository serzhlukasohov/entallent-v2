import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';

type DecoratedClass = { prototype: Record<string, unknown> };

function mountedControllers(moduleValue: unknown, seen = new Set<unknown>()): DecoratedClass[] {
  const moduleClass = typeof moduleValue === 'function' ? moduleValue
    : moduleValue && typeof moduleValue === 'object' ? (moduleValue as { module?: unknown }).module
      : undefined;
  if (typeof moduleClass !== 'function' || seen.has(moduleClass)) return [];
  seen.add(moduleClass);
  const controllers = (Reflect.getMetadata('controllers', moduleClass) ?? []) as DecoratedClass[];
  const imports = (Reflect.getMetadata('imports', moduleClass) ?? []) as unknown[];
  const dynamicImports = moduleValue && typeof moduleValue === 'object'
    ? ((moduleValue as { imports?: unknown[] }).imports ?? []) : [];
  return [...controllers, ...[...imports, ...dynamicImports]
    .flatMap((imported) => mountedControllers(imported, seen))];
}

function controllerRoutes(controller: DecoratedClass): string[] {
  const base = Reflect.getMetadata('path', controller) as string | undefined;
  if (base === undefined) return [];
  return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    const handler = controller.prototype[name] as object;
    const path = Reflect.getMetadata('path', handler) as string | undefined;
    const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
    if (path === undefined || method === undefined) return [];
    const route = `${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
    return [`${RequestMethod[method]} ${route}`];
  });
}

describe('production API route privacy boundary', () => {
  afterAll(() => vi.unstubAllEnvs());

  it('mounts only reviewed admin routes and excludes private/dev controllers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:5434/route-boundary-test');
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6380');
    vi.stubEnv('FIELD_ENCRYPTION_KEY', '0'.repeat(64));
    vi.stubEnv('OPENAI_API_KEY', 'route-boundary-test');
    vi.stubEnv('ADMIN_API_KEY', 'route-boundary-test');
    vi.stubEnv('SLACK_APP_TOKEN', '');
    vi.resetModules();
    const { AppModule } = await import('./app.module');
    const { DevSimulateController } = await import('./dev/dev-simulate.controller');
    const controllers = mountedControllers(AppModule);
    expect(controllers).not.toContain(DevSimulateController);

    const routes = controllers.flatMap(controllerRoutes).sort();
    expect(routes.filter((route) => route.split(' ')[1]?.startsWith('admin/'))).toMatchInlineSnapshot(`
      [
        "DELETE admin/feature-flags/:key",
        "GET admin/analytics",
        "GET admin/audit-logs",
        "GET admin/feature-flags",
        "GET admin/llm-runs",
        "GET admin/llm-runs/cost-summary",
        "GET admin/llm-runs/prompt-versions",
        "GET admin/manager/trends",
        "GET admin/profile-hydration/status",
        "GET admin/queues",
        "GET admin/queues/dead-letter",
        "GET admin/survey/coverage",
        "GET admin/survey/coverage/definitions",
        "POST admin/queues/dead-letter/:jobId/retry",
        "POST admin/queues/dead-letter/:queueName/:jobId/retry",
        "PUT admin/feature-flags/:key",
      ]
    `);
    expect(routes.some((route) => /(?:conversation|messages|memory|insights|debug|reset-user)/i.test(route)))
      .toBe(false);
  }, 15_000);
});
