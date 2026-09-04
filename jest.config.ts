import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts', '**/*.int.ts', '**/*.e2e.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/\\.worktrees/', '/dist/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  verbose: true,
};

export default config;
