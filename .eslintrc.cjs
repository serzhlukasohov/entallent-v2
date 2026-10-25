'use strict';

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    'no-console': 'warn',
  },
  overrides: [
    {
      // AD-5: business time on the conversation and proactive paths enters only through ClockPort.
      files: [
        'packages/application/src/use-cases/conversation-orchestrator.ts',
        'packages/application/src/use-cases/proactive-check-in.use-case.ts',
        'packages/application/src/use-cases/follow-up-execution.use-case.ts',
        'packages/application/src/use-cases/proactive-scheduler.use-case.ts',
        'packages/application/src/utils/quiet-hours.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: 'Read the current time from the injected ClockPort (clock.now()), not new Date().',
          },
          {
            selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
            message: 'Read the current time from the injected ClockPort (clock.now()), not Date.now().',
          },
          {
            selector: "CallExpression[callee.name='Date']",
            message: 'Read the current time from the injected ClockPort (clock.now()), not Date().',
          },
        ],
      },
    },
  ],
};
