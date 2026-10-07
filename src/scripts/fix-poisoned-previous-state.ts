/**
 * fix-poisoned-previous-state.ts — Perbaikan data `previous_state` teracuni.
 *
 * Akar masalah (V-B, terverifikasi): beberapa jalur eskalasi (gerbang domain,
 * V3 pending, form tak lengkap) men-set `current_state = HUMAN_HANDLING`
 * SEBELUM memanggil `escalateToHumanHandling`, sehingga service menyimpan
 * `previous_state = HUMAN_HANDLING`. Akibatnya Release memulihkan ke
 * HUMAN_HANDLING → percakapan macet dipegang manusia selamanya.
 *
 * Kode sudah diperbaiki (tak menimpa previous_state + pra-mutasi dihapus).
 * Skrip ini membersihkan baris LAMA yang sudah terlanjur teracuni.
 *
 * Usage:
 *   npx tsx src/scripts/fix-poisoned-previous-state.ts --dry-run
 *   npx tsx src/scripts/fix-poisoned-previous-state.ts --commit
 *
 * Safety: default --dry-run. Hanya mengubah previous_state yang persis
 * 'HUMAN_HANDLING' menjadi 'INITIAL' (nilai aman). Idempoten.
 */
import { prisma } from '../db/client';

const isCommit = process.argv.includes('--commit');

async function main() {
  const where = { previous_state: 'HUMAN_HANDLING' as any };
  let count = 0;
  try {
    count = await prisma.conversation.count({ where });
  } catch (err: any) {
    console.error('[FIX-PREV] Gagal menghitung:', err?.message || err);
    process.exitCode = 1;
    return;
  }

  console.log(`[FIX-PREV] Baris previous_state='HUMAN_HANDLING': ${count}`);
  if (!isCommit) {
    console.log('[FIX-PREV] DRY-RUN. Tidak ada perubahan. Jalankan dengan --commit untuk menulis.');
    return;
  }
  if (count === 0) {
    console.log('[FIX-PREV] Tidak ada yang perlu diperbaiki.');
    return;
  }

  try {
    const res = await prisma.conversation.updateMany({
      where,
      data: { previous_state: 'INITIAL' as any },
    });
    console.log(`[FIX-PREV] Selesai. ${res.count} baris diperbaiki → previous_state='INITIAL'.`);
  } catch (err: any) {
    console.error('[FIX-PREV] Gagal update:', err?.message || err);
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect().catch(() => {}));
