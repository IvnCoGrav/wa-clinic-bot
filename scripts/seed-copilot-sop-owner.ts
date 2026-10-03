/**
 * scripts/seed-copilot-sop-owner.ts
 *
 * Seed knowledge & SOP Copilot 2.0 KHUSUS tenant owner (ADR-001, single-tenant).
 * Mengimplementasikan spesifikasi `docs/SOP_ADMIN_RESERVASI.md` Bab 6 & 7 ke tabel
 * DB per-tenant — BUKAN menempel teks ke prompt runtime.
 *
 * Sifat:
 * - Idempoten & NON-destruktif: `ClinicPolicy` di-upsert (create bila belum ada,
 *   TIDAK menimpa kurasi admin yang sudah ada), `KnowledgeChunk` skip bila judul sama.
 * - Angka operasional default mengikuti hasil audit SOP v1.1 (DB adalah sumber
 *   kebenaran; bila admin mengubah di DB, DB yang menang).
 * - Jalankan: `npx tsx scripts/seed-copilot-sop-owner.ts [--tenant=<id>]`.
 *
 * Catatan jujur: kebijakan DP/uang muka & jam batas reschedule belum punya angka
 * resmi di dokumen terverifikasi → SENGAJA tidak di-seed (dilarang mengarang nilai
 * bisnis). Isi dulu via Settings admin, baru tambahkan di sini bila sudah baku.
 */
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';

interface PolicySeed {
  topic: string;
  title: string;
  factualSummary: string;
  suggestedReply: string;
}

interface ChunkSeed {
  sourceType: 'FAQ' | 'DOCUMENT';
  title: string;
  content: string;
  keywords: string;
  documentName: string;
}

const POLICY_SEEDS: PolicySeed[] = [
  {
    topic: 'post_vaccine_rules',
    title: 'Jeda Aman Pijat Pasca-Imunisasi',
    factualSummary:
      'Acuan resmi pasca-imunisasi/vaksinasi: jeda minimal 48-72 jam (2-3 hari) setelah suntik, ' +
      'dengan syarat si kecil sudah fit dan tidak demam. Operasional klinik menerapkan 3 hari sebagai ' +
      'batas aman. Pijat sangat disarankan dilakukan SEBELUM imunisasi. Bila ada demam pasca-vaksin, ' +
      'tunggu suhu normal kembali.',
    suggestedReply:
      'Untuk si kecil yang baru imunisasi, sebaiknya dijadwalkan minimal 2-3 hari setelah vaksin ya Bunda, ' +
      'dan pastikan sudah tidak demam atau rewel agar si kecil nyaman saat treatment.',
  },
  {
    topic: 'fever_contraindication',
    title: 'Kontraindikasi Demam & Sakit Akut',
    factualSummary:
      'Ambang demam default 37.8°C. Bila suhu tubuh 37.8°C atau lebih, sedang demam, muntah terus-menerus, ' +
      'sesak napas, atau tali pusat bernanah: DILARANG melanjutkan spa/pijat. Arahkan Bunda ke dokter ' +
      'Sp.A/fasilitas kesehatan terdekat untuk evaluasi, bukan treatment homecare.',
    suggestedReply:
      'Mohon maaf Bunda, bila si kecil sedang demam (suhu 37.8°C ke atas), muntah terus, atau sesak, ' +
      'sebaiknya periksa dulu ke dokter ya. Treatment bisa kami jadwalkan kembali setelah si kecil sehat.',
  },
  {
    topic: 'reservation_status_rules',
    title: 'Aturan Status Reservasi',
    factualSummary:
      'Status aktif = confirmed/en_route/pending/hold. Hold berlaku 2 jam sejak created_at dan otomatis ' +
      'menjadi cancelled bila melewati tengah malam WIB. Same-day dengan status pending + [SAME_DAY_REQUEST] ' +
      'wajib verifikasi ketersediaan terapis. completed ditolak bila tanggal reservasi >24 jam ke depan. ' +
      'Buffer antar slot default 20 menit.',
    suggestedReply:
      'Saya cek status reservasinya dulu ya Bunda, mohon tunggu sebentar.',
  },
];

const CHUNK_SEEDS: ChunkSeed[] = [
  {
    sourceType: 'DOCUMENT',
    title: 'Audit Jadwal & Slot Kosong',
    content:
      'Untuk audit jadwal: panggil tool query_reservations_by_filter dengan tanggal format YYYY-MM-DD WIB. ' +
      'Jam operasional default 08:00-18:00 WIB (config tenant). Hitung durasi katalog + buffer 20 menit. ' +
      'Terapis luang = tidak punya reservasi aktif di rentang jam tersebut.',
    keywords: 'audit jadwal, slot kosong, terapis luang, bentrok jadwal, rekomendasi slot, copy schedule',
    documentName: 'SOP_ADMIN_RESERVASI#Chunk2',
  },
  {
    sourceType: 'DOCUMENT',
    title: 'Follow-up Prospek Tertunda',
    content:
      'Untuk chat menggantung/prospek belum deal: identifikasi nama, treatment diminati, requestedTime ' +
      '(permintaan customer) vs offeredTime (jam terakhir yang ditawarkan admin). Sertakan tautan Live Chat ' +
      'kanonis [Buka Chat](/admin/live-chat?conversationId=...). Gunakan tool query_stalled_inquiries / ' +
      'query_unreplied_chats.',
    keywords: 'chat menggantung, belum dibalas, prospek tertunda, follow up, stalled inquiry',
    documentName: 'SOP_ADMIN_RESERVASI#Chunk3',
  },
];

function resolveTenantId(): string {
  const arg = process.argv.find((a) => a.startsWith('--tenant='));
  const fromArg = arg ? arg.slice('--tenant='.length).trim() : '';
  return fromArg || process.env.COPILOT_SEED_TENANT_ID || DEFAULT_TENANT_ID;
}

/**
 * Gaya bahasa Copilot (persona) — DISIMPAN DI DB per-tenant (`Tenant.settings.copilot.styleTone`),
 * BUKAN di file SOUL.md server. Non-destruktif: hanya diisi bila belum ada.
 */
async function seedCopilotStyle(tenantId: string): Promise<void> {
  const tenant = await (prisma as any).tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) {
    console.log('  (!) tenant tidak ditemukan, skip styleTone');
    return;
  }
  const settings = (tenant.settings as any) || {};
  if (settings?.copilot?.styleTone) {
    console.log('  = styleTone Copilot sudah ada, skip');
    return;
  }
  const merged = {
    ...settings,
    copilot: {
      ...(settings.copilot || {}),
      styleTone:
        'Ringkas, empati klinis, langsung ke inti, tanpa basa-basi. ' +
        'Selalu akhiri dengan rekomendasi tindakan konkret yang bisa dilakukan CS/bidan.',
    },
  };
  await (prisma as any).tenant.update({ where: { id: tenantId }, data: { settings: merged } });
  console.log('  + styleTone Copilot diset di Tenant.settings');
}

async function seed() {
  const tenantId = resolveTenantId();
  console.log(`[SEED COPILOT SOP] Tenant owner: ${tenantId}`);
  await seedCopilotStyle(tenantId);

  for (const p of POLICY_SEEDS) {
    const existing = await (prisma as any).clinicPolicy.findUnique({
      where: { tenant_id_topic: { tenant_id: tenantId, topic: p.topic } },
      select: { id: true },
    });
    if (existing) {
      console.log(`  = policy ${p.topic} sudah ada, skip (tidak menimpa kurasi admin)`);
      continue;
    }
    await (prisma as any).clinicPolicy.create({
      data: {
        tenant_id: tenantId,
        topic: p.topic,
        title: p.title,
        factual_summary: p.factualSummary,
        suggested_reply: p.suggestedReply,
        is_active: true,
      },
    });
    console.log(`  + policy ${p.topic} seeded`);
  }

  for (const c of CHUNK_SEEDS) {
    const existing = await (prisma as any).knowledgeChunk.findFirst({
      where: { tenant_id: tenantId, title: c.title },
      select: { id: true },
    });
    if (existing) {
      console.log(`  = chunk "${c.title}" sudah ada, skip`);
      continue;
    }
    await (prisma as any).knowledgeChunk.create({
      data: {
        tenant_id: tenantId,
        source_type: c.sourceType,
        title: c.title,
        content: c.content,
        keywords: c.keywords,
        document_name: c.documentName,
      },
    });
    console.log(`  + chunk "${c.title}" seeded`);
  }

  console.log('[SEED COPILOT SOP] Done');
  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
