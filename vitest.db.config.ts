import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi test yang berjalan terhadap PostgreSQL NYATA.
 *
 * Perbedaan dari `vitest.config.ts`:
 * - TIDAK memuat `tests/setup.ts` (yang memock Prisma offline + repositori in-memory).
 *   Dengan begitu constraint unik, foreign key, transaksi, dan concurrency benar-
 *   benar diuji PostgreSQL, bukan fallback memori.
 *
 * KONEKSI: memakai `TEST_DATABASE_URL` (BUKAN `DATABASE_URL`) agar tidak pernah
 * menyentuh produksi. Bila `TEST_DATABASE_URL` kosong → test DB di-skip.
 *
 * Jalankan: `npx vitest run --config vitest.db.config.ts`
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
