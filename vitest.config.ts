import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Only discover tests inside the tests/ directory — excludes caveman/ (uses node:test runner)
    include: ['tests/**/*.test.{ts,js}'],
    exclude: ['caveman/**', 'node_modules/**', 'dist/**'],
  },
});
