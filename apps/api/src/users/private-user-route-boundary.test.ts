import { describe, expect, it } from 'vitest';
import { UsersModule } from './users.module';
import { UserDataController } from './user-data.controller';
import { UserMemoryController } from './user-memory.controller';
import { UserPreferencesController } from './user-preferences.controller';

describe('employee private HTTP boundary', () => {
  it('does not mount person-targeted rights, memory, or consent routes under the shared API key', () => {
    const controllers = Reflect.getMetadata('controllers', UsersModule) as unknown[];
    expect(controllers).not.toContain(UserDataController);
    expect(controllers).not.toContain(UserMemoryController);
    expect(controllers).not.toContain(UserPreferencesController);
  });
});
