import { defineConfig } from 'vitest/config';

// Only our tests: repos cloned for evaluation into .eval-cache/ have test suites of their own.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
