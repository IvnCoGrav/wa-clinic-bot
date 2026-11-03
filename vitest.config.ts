import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Test berat (DB-fallback + arsip) butuh ~3 dtk saat sendiri dan >5 dtk saat
    // suite paralel. 5 dtk terbukti menghasilkan false-failure (lihat #299).
    testTimeout: 15000,
    // beforeAll/beforeEach berat (boot Fastify + seed) juga bisa melewati 10 dtk
    // bawaan saat suite paralel: terbukti "Hook timed out in 10000ms" pada
    // reservation-silent-failure-audit.test.ts. Samakan dengan testTimeout.
    hookTimeout: 30000,
    // Only discover tests inside the tests/ directory — excludes caveman/ (uses node:test runner)
    include: ['tests/**/*.test.{ts,js}'],
    exclude: ['caveman/**', 'node_modules/**', 'dist/**'],
  },
});
