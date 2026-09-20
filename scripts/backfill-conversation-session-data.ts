/**
 * Stage 4 Fase B — backfill `Conversation.session_data` dari `Customer.preferences`.
 *
 * Menyalin state sesi V3 (episodik) dari `Customer.preferences` ke
 * `Conversation.session_data` untuk conversation yang BELUM punya session_data.
 * Idempoten: hanya mengisi yang kosong; menjalankan ulang aman.
 *
 * Jalankan (lokal):
 *   npx tsx scripts/backfill-conversation-session-data.ts
 *   npx tsx scripts/backfill-conversation-session-data.ts --apply
 *
 * Default DRY-RUN (tanpa tulis). Gunakan `--apply` untuk benar-benar menulis.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  // Ambil conversation tanpa session_data beserta preferences customer.
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT c.id AS conversation_id, c.tenant_id, cu.preferences AS prefs
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.session_data IS NULL AND cu.preferences IS NOT NULL
  `);

  let candidates = 0;
  let applied = 0;

  for (const r of rows) {
    const prefs = r.prefs || {};
    // Hanya backfill bila preferences memang memuat state sesi (indikator apa pun).
    const hasSessionState = Boolean(
      (prefs.cartItems && prefs.cartItems.length) ||
      prefs.selectedTreatment ||
      prefs.booking ||
      prefs.discussedTreatments ||
      prefs.lastCommitment ||
      prefs.ongkirStatus ||
      prefs.priceDiscussed != null ||
      prefs.bookingCommitConfirmed != null ||
      prefs.momProfile ||
      prefs.childProfile ||
      prefs.children ||
      prefs.targetAudience
    );
    if (!hasSessionState) continue;
    candidates++;

    if (!APPLY) {
      console.log(`[DRY-RUN] conversation ${r.conversation_id} (tenant ${r.tenant_id}) akan diisi session_data.`);
      continue;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE conversations SET session_data = $1::jsonb WHERE id = $2 AND session_data IS NULL`,
      JSON.stringify(prefs),
      r.conversation_id
    );
    applied++;
  }

  console.log(APPLY
    ? `[BACKFILL] selesai. ${applied} conversation di-update (dari ${rows.length} kandidat).`
    : `[DRY-RUN] ${candidates} conversation perlu backfill (dari ${rows.length} baris). Jalankan dengan --apply untuk menulis.`);
}

main()
  .catch((e) => { console.error('[BACKFILL ERROR]', e?.message || e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
