import { PgDialect } from 'drizzle-orm/pg-core';
import { PULSE_COPY_VERSION } from '@entalent/contracts';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserInsightsController } from './user-insights.controller';

describe('UserInsightsController', () => {
  it('refuses employee insights when the internal dashboard gate is disabled', async () => {
    const db = { client: { select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn(async () => []) }) } };
    const config = { get: vi.fn(() => false) };
    const controller = new UserInsightsController(db as never, config as never);

    await expect(controller.getInsights('user-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.client.select).not.toHaveBeenCalled();
  });
});


describe('legacy insights language boundary', () => {
  const tenant = '7d1e0163-6d53-4713-bd24-254690cc5090';
  const user = '2e82f439-c147-4c1c-a918-71835fba02b4';
  it('rejects malformed identity before either locale or legacy data reads', async () => {
    const read = vi.fn(); const select = vi.fn();
    const controller = new UserInsightsController({client:{select}} as never, {get:()=>true} as never, {read} as never);
    await expect(controller.getInsights(user, 'bad')).rejects.toBeInstanceOf(BadRequestException);
    expect(read).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
  });
  it('binds the first window lookup to the supplied tenant and reads its language without reviving the route', async () => {
    const where=vi.fn().mockReturnValue({limit:vi.fn(async()=>[])});
    const select=vi.fn().mockReturnValue({from:()=>({where})});
    const language={locale:'de',resourceVersion:PULSE_COPY_VERSION,status:'language_unavailable',resources:{}};
    const read=vi.fn(async()=>language);
    const controller=new UserInsightsController({client:{select}} as never,{get:()=>true} as never,{read} as never);
    expect(await controller.getInsights(user,tenant)).toMatchObject({companyLanguage:language,questions:[]});
    const query=new PgDialect().sqlToQuery(where.mock.calls[0]![0]);
    expect(query.sql).toContain('"survey_windows"."tenant_id"');
    expect(query.params).toEqual([user,tenant,'active']);
    expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith(tenant);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
