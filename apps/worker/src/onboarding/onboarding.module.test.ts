import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { describe, expect, it } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { ConversationModule } from '../conversation/conversation.module';
import { QUEUE_NAMES } from '../queue/queue.module';
import { OnboardingEffectsService } from './onboarding-effects.service';
import { OnboardingModule } from './onboarding.module';
import { OnboardingStateRepository } from './onboarding-state.repository';
import { ONBOARDING_EFFECTS, OnboardingService } from './onboarding.service';

describe('OnboardingModule wiring', () => {
  it('does not import ConversationModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, OnboardingModule) as unknown[];
    expect(imports).not.toContain(ConversationModule);
  });

  it('resolves its providers with queues and database stubbed', async () => {
    const stub = { add: async () => undefined };
    @Module({
      providers: [
        { provide: DatabaseService, useValue: {} },
        ...[QUEUE_NAMES.CONVERSATION, QUEUE_NAMES.MESSAGE_SEND, QUEUE_NAMES.ONBOARDING_REMINDER]
          .map((name) => ({ provide: getQueueToken(name), useValue: stub })),
        OnboardingStateRepository,
        OnboardingEffectsService,
        { provide: ONBOARDING_EFFECTS, useExisting: OnboardingEffectsService },
        OnboardingService,
      ],
    })
    class TestModule {}
    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });
    expect(app.get(OnboardingService)).toBeInstanceOf(OnboardingService);
    await app.close();
  });
});
