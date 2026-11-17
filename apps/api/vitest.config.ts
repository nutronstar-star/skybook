import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/modules/**/*.ts', 'src/shared/**/*.ts', 'src/ws/**/*.ts'],
      exclude: ['src/**/*.types.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        branches: 75
      }
    }
  }
});