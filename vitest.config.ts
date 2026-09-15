import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: false,
    include: ['**/*.test.ts'],
    passWithNoTests: true,
  },
});
