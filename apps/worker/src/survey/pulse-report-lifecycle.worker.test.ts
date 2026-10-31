import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PULSE_REPORT_LIFECYCLE_QUEUE_NAME } from '@entalent/contracts';
import { validateEnv } from '@entalent/config';
import { SurveyModule } from './survey.module';
import { PulseReportActivationRepository } from './repositories/pulse-report-activation.repository';
import {
  PULSE_REPORT_SCAN_SCHEDULER_ID,
  PulseReportLifecycleProductionDriver,
  PulseReportLifecycleWorker,
} from './pulse-report-lifecycle.worker';

const T = '00000000-0000-4000-8000-000000000001', O = '00000000-0000-4000-8000-0000000000c1', SN = '00000000-0000-4000-8000-0000000000d1';
const env = (over: Record<string, string> = {}) =>
  validateEnv({ DATABASE_URL: 'postgresql://synthetic/db', REDIS_URL: 'redis://synthetic:1', FIELD_ENCRYPTION_KEY: 'a'.repeat(64), OPENAI_API_KEY: 'synthetic', ...over });
const config = (over: Record<string, string> = {}) => {
  const e = env(over) as unknown as Record<string, unknown>;
  return { get: (key: string) => e[key] } as unknown as ConfigService;
};
type Decision = { observe: boolean; deliver: boolean; holdReason: string | null };
function build(decisions: Decision[], snapshotId: string | null = SN) {
  const guard = vi.fn();
  const activation = {
    scopeFilter: vi.fn(),
    decide: vi.fn(async () => ({ decision: decisions.shift()!, snapshotId })),
    deliveryGuard: vi.fn(() => guard),
  };
  const lifecycle = { discover: vi.fn(async () => []), observe: vi.fn(), repair: vi.fn(async () => []) };
  const form = { execute: vi.fn(async () => ({ status: 'snapshot_ready' })) };
  const delivery = { deliverNext: vi.fn(async () => ({ status: 'delivered' })), fence: vi.fn(async () => ({ status: 'held' })) };
  const queue = { add: vi.fn() };
  const driver = new PulseReportLifecycleProductionDriver(lifecycle as never, activation as never, form, delivery, queue);
  return { driver, activation, lifecycle, form, delivery, queue, guard };
}
const off: Decision = { observe: false, deliver: false, holdReason: 'control_off' };
const observe: Decision = { observe: true, deliver: false, holdReason: 'observe_only' };
const deliver: Decision = { observe: true, deliver: true, holdReason: null };

describe('RPT-10 production lifecycle driver (mandatory activation gate)', () => {
  it('cannot be constructed without the activation gate', () => {
    expect(() => new PulseReportLifecycleProductionDriver({} as never, undefined as never, { execute: vi.fn() }, { deliverNext: vi.fn(), fence: vi.fn() }, { add: vi.fn() }))
      .toThrow('pulse_report_activation_gate_required');
  });
  it('inert/unlisted: holds formation and delivery without model or Slack work', async () => {
    const t = build([off, { observe: false, deliver: false, holdReason: 'scope_not_allowlisted' }]);
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'form' })).toEqual({ status: 'held', holdReason: 'control_off' });
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'scope_not_allowlisted', fence: 'held' });
    expect(t.delivery.fence).toHaveBeenCalledWith(T, SN);
    expect(t.form.execute).not.toHaveBeenCalled();
    expect(t.delivery.deliverNext).not.toHaveBeenCalled();
  });
  it('observe forms but never sends', async () => {
    const t = build([observe, observe]);
    await t.driver.process({ tenantId: T, obligationId: O, action: 'form' });
    expect(t.form.execute).toHaveBeenCalledWith(T, O);
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'observe_only', fence: 'held' });
    expect(t.delivery.deliverNext).not.toHaveBeenCalled();
  });
  it('deliver sends through the existing path with an in-transaction guard', async () => {
    const t = build([deliver]);
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'delivered' });
    expect(t.activation.deliveryGuard).toHaveBeenCalledWith(T, O);
    expect(t.delivery.deliverNext).toHaveBeenCalledWith(T, SN, t.guard);
  });
  it('recipient mismatch, expiry and missing snapshot hold with a typed reason', async () => {
    const t = build([{ observe: true, deliver: false, holdReason: 'recipient_mismatch' }, { observe: false, deliver: false, holdReason: 'control_expired' }]);
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'recipient_mismatch', fence: 'held' });
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'control_expired', fence: 'held' });
    const missing = build([deliver], null);
    expect(await missing.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'snapshot_missing' });
    expect(t.delivery.deliverNext).not.toHaveBeenCalled();
  });
  it('switch off mid-queue: the control is re-read when the job executes, not when enqueued', async () => {
    const t = build([deliver, off]);
    await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' });
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'control_off', fence: 'held' });
    expect(t.activation.decide).toHaveBeenCalledTimes(2);
    expect(t.delivery.deliverNext).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed jobs before any read', async () => {
    const t = build([]);
    expect(await t.driver.process({ tenantId: 'x', obligationId: O, action: 'deliver' })).toEqual({ status: 'invalid_job' });
    expect(t.activation.decide).not.toHaveBeenCalled();
  });
  it('in-transaction guard hold is reported with the current typed reason', async () => {
    const t = build([deliver, { observe: true, deliver: false, holdReason: 'partial_delivery_held' }]);
    t.delivery.deliverNext.mockResolvedValueOnce({ status: 'held' });
    expect(await t.driver.process({ tenantId: T, obligationId: O, action: 'deliver' })).toEqual({ status: 'held', holdReason: 'partial_delivery_held' });
  });
  it('Q7: scan enqueues allowed work, fences held deliveries without enqueueing them', async () => {
    const t = build([{ observe: true, deliver: false, holdReason: 'observe_only' }, deliver]);
    t.lifecycle.repair.mockResolvedValueOnce([
      { tenant_id: T, obligation_id: O, snapshot_id: SN },
      { tenant_id: T, obligation_id: '00000000-0000-4000-8000-0000000000c2', snapshot_id: SN },
      { tenant_id: T, obligation_id: '00000000-0000-4000-8000-0000000000c3', snapshot_id: null },
    ] as never);
    expect(await t.driver.scan()).toEqual({ status: 'observed', observed: 0, queued: 2, held: 1 });
    expect(t.delivery.fence).toHaveBeenCalledWith(T, SN);
    expect(t.queue.add.mock.calls.map((c) => c[2].jobId)).toEqual(['pulse-deliver-00000000-0000-4000-8000-0000000000c2', 'pulse-form-00000000-0000-4000-8000-0000000000c3']);
    expect(t.delivery.deliverNext).not.toHaveBeenCalled();
  });
  it('scan pages discovery and repair through the activation filter only', async () => {
    const t = build([]);
    expect(await t.driver.scan()).toEqual({ status: 'observed', observed: 0, queued: 0, held: 0 });
    expect(t.lifecycle.discover).toHaveBeenCalledWith(25, t.activation.scopeFilter);
    expect(t.lifecycle.repair).toHaveBeenCalledWith(25, t.activation.scopeFilter);
  });
});

describe('RPT-10 lifecycle worker registration', () => {
  const queue = () => ({ removeJobScheduler: vi.fn(async () => true), upsertJobScheduler: vi.fn(async () => ({})) });
  it('env defaults to disabled with a 60s scan interval', () => {
    expect(env()).toMatchObject({ PULSE_REPORTS_ENABLED: false, PULSE_REPORT_SCAN_INTERVAL_SEC: 60 });
    expect(env({ PULSE_REPORTS_ENABLED: 'true', PULSE_REPORT_SCAN_INTERVAL_SEC: '15' })).toMatchObject({ PULSE_REPORTS_ENABLED: true, PULSE_REPORT_SCAN_INTERVAL_SEC: 15 });
  });
  it('disabled boot removes a previously registered scan and registers none; jobs no-op', async () => {
    const q = queue(), driver = { scan: vi.fn(), process: vi.fn() };
    const worker = new PulseReportLifecycleWorker(q as never, config() as never, driver as never);
    await worker.onModuleInit();
    expect(q.removeJobScheduler).toHaveBeenCalledWith(PULSE_REPORT_SCAN_SCHEDULER_ID);
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
    expect(await worker.process({ name: 'scan', data: {} } as Job)).toEqual({ status: 'disabled' });
    expect(await worker.process({ name: 'deliver', data: { tenantId: T, obligationId: O, action: 'deliver' } } as Job)).toEqual({ status: 'disabled' });
    expect(driver.scan).not.toHaveBeenCalled();
    expect(driver.process).not.toHaveBeenCalled();
  });
  it('Q13: disabled boot is bounded when Redis removal hangs or fails, and the worker never starts consuming', async () => {
    vi.useFakeTimers();
    try {
      const hanging = { removeJobScheduler: vi.fn(() => new Promise<boolean>(() => undefined)), upsertJobScheduler: vi.fn() };
      const worker = new PulseReportLifecycleWorker(hanging as never, config() as never, {} as never);
      const boot = worker.onModuleInit();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(boot).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    const failing = { removeJobScheduler: vi.fn(async () => { throw Error('redis down'); }), upsertJobScheduler: vi.fn() };
    const worker = new PulseReportLifecycleWorker(failing as never, config() as never, {} as never);
    await expect(worker.onModuleInit()).resolves.toBeUndefined();
    const run = vi.fn(async () => undefined);
    Object.assign(worker, { _worker: { run } });
    worker.onApplicationBootstrap();
    expect(run).not.toHaveBeenCalled();
    const enabled = new PulseReportLifecycleWorker(failing as never, config({ PULSE_REPORTS_ENABLED: 'true' }) as never, {} as never);
    Object.assign(enabled, { _worker: { run } });
    enabled.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('the registered BullMQ worker is declared with autorun=false', () => {
    expect(Reflect.getMetadata('bullmq:worker_metadata', PulseReportLifecycleWorker)).toMatchObject({ autorun: false });
  });
  it('enabled boot upserts one fixed-id scan scheduler and routes jobs to the gated driver', async () => {
    const q = queue(), driver = { scan: vi.fn(async () => ({ status: 'observed', observed: 0, queued: 0, held: 0 })), process: vi.fn(async () => ({ status: 'held', holdReason: 'no_control' })) };
    const worker = new PulseReportLifecycleWorker(q as never, config({ PULSE_REPORTS_ENABLED: 'true', PULSE_REPORT_SCAN_INTERVAL_SEC: '30' }) as never, driver as never);
    await worker.onModuleInit();
    expect(q.upsertJobScheduler).toHaveBeenCalledWith(PULSE_REPORT_SCAN_SCHEDULER_ID, { every: 30_000 }, expect.objectContaining({ name: 'scan' }));
    expect(q.removeJobScheduler).not.toHaveBeenCalled();
    await worker.process({ name: 'scan', data: {} } as Job);
    expect(await worker.process({ name: 'deliver', data: { tenantId: T, obligationId: O, action: 'deliver' } } as Job)).toEqual({ status: 'held', holdReason: 'no_control' });
    expect(driver.scan).toHaveBeenCalledTimes(1);
    expect(driver.process).toHaveBeenCalledWith({ tenantId: T, obligationId: O, action: 'deliver' });
  });
});

describe('RPT-10 survey module wiring', () => {
  type Provider = { provide?: unknown; useFactory?: (...args: unknown[]) => unknown; inject?: unknown[] };
  const providers = () => Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SurveyModule) as Array<Provider | (new (...a: never[]) => unknown)>;
  it('registers the lifecycle queue, the worker and the activation repository', () => {
    expect(providers()).toContain(PulseReportLifecycleWorker);
    expect(providers()).toContain(PulseReportActivationRepository);
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, SurveyModule) as Array<{ providers?: Provider[] }>;
    expect(imports.flatMap((i) => i.providers ?? []).some((p) => p.provide === getQueueToken(PULSE_REPORT_LIFECYCLE_QUEUE_NAME))).toBe(true);
  });
  it('production driver factory always injects the DB activation gate and refuses to build without it', () => {
    const driver = providers().find((p) => typeof p === 'object' && p.provide === PulseReportLifecycleProductionDriver) as Provider;
    expect(driver.inject).toContain(PulseReportActivationRepository);
    expect(driver.inject).toContain(getQueueToken(PULSE_REPORT_LIFECYCLE_QUEUE_NAME));
    const args = driver.inject!.map(() => ({}));
    expect(() => driver.useFactory!(...args)).toThrow('pulse_report_activation_gate_required');
    const index = driver.inject!.indexOf(PulseReportActivationRepository);
    args[index] = new PulseReportActivationRepository({} as never);
    expect(driver.useFactory!(...args)).toBeInstanceOf(PulseReportLifecycleProductionDriver);
  });
  it('Q16: the factory-built production driver consults the injected activation repository on every job', async () => {
    const driver = providers().find((p) => typeof p === 'object' && p.provide === PulseReportLifecycleProductionDriver) as Provider;
    const activation = Object.assign(new PulseReportActivationRepository({} as never), {
      decide: vi.fn(async () => ({ decision: off, snapshotId: null })),
    });
    const form = { execute: vi.fn() };
    const args = driver.inject!.map((token) => (token === PulseReportActivationRepository ? activation : token === driver.inject![2] ? form : {}));
    const built = driver.useFactory!(...args) as PulseReportLifecycleProductionDriver;
    expect(await built.process({ tenantId: T, obligationId: O, action: 'form' })).toEqual({ status: 'held', holdReason: 'control_off' });
    expect(activation.decide).toHaveBeenCalledWith(T, O);
    expect(form.execute).not.toHaveBeenCalled();
  });
  it('module boot with default env removes the scan scheduler and never invokes the driver', async () => {
    const q = { removeJobScheduler: vi.fn(async () => false), upsertJobScheduler: vi.fn() };
    const driver = { scan: vi.fn(), process: vi.fn() };
    @Module({
      providers: [
        { provide: getQueueToken(PULSE_REPORT_LIFECYCLE_QUEUE_NAME), useValue: q },
        { provide: ConfigService, useValue: config() },
        { provide: PulseReportLifecycleProductionDriver, useValue: driver },
        PulseReportLifecycleWorker,
      ],
    })
    class BootModule {}
    const app = await NestFactory.createApplicationContext(BootModule, { logger: false });
    await app.init();
    expect(q.removeJobScheduler).toHaveBeenCalledWith(PULSE_REPORT_SCAN_SCHEDULER_ID);
    expect(q.upsertJobScheduler).not.toHaveBeenCalled();
    expect(driver.scan).not.toHaveBeenCalled();
    expect(driver.process).not.toHaveBeenCalled();
    await app.close();
  });
});
