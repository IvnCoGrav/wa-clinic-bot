/**
 * reconcile-children-birth-dates-and-moms.ts
 *
 * Rekonsiliasi tabel `children` produksi:
 * 1. Data anak dengan `birth_date` NULL → estimasi tanggal lahir dari
 *    `raw_age_text` + `created_at` (on-the-fly estimate), lalu update.
 * 2. Baris yang `raw_age_text`-nya entitas Moms (hamil/nifas) → FLAG untuk
 *    review manual CS (TIDAK dihapus otomatis; jejak audit dipertahankan).
 * 3. Teks tak terparse (angka telanjang, dsb.) → SKIP + dilaporkan.
 *
 * Aman secara default: DRY-RUN (read-only). `--commit` wajib eksplisit.
 *   npx tsx src/scripts/reconcile-children-birth-dates-and-moms.ts            (dry-run)
 *   npx tsx src/scripts/reconcile-children-birth-dates-and-moms.ts --commit   (menulis)
 *
 * Idempoten: hanya menyentuh baris `birth_date IS NULL`.
 */
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { parseAgeTextEstimate, isGestationalText, monthsBetween } from '../utils/age-calculator';
import { writeFileSync } from 'fs';
import { join } from 'path';

const isCommit = process.argv.includes('--commit');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1]!.trim() : DEFAULT_TENANT_ID;

type Action = 'UPDATE_BIRTH' | 'FLAG_MOM' | 'FLAG_AMBIGUOUS' | 'SKIP';

interface PlanRow {
  id: string;
  name: string;
  raw_age_text: string | null;
  created_at: string;
  parsed_birth: string | null;
  approximate: boolean;
  action: Action;
  reason: string;
}

function csvEscape(v: string | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  console.log('======================================================');
  console.log(`[RECONCILE CHILDREN] Mode: ${isCommit ? 'COMMIT (MENULIS KE DB)' : 'DRY-RUN (READ-ONLY)'}`);
  console.log(`[RECONCILE CHILDREN] Tenant: ${tenantId}`);
  console.log('======================================================\n');

  const rows = await prisma.child.findMany({
    where: { tenant_id: tenantId, birth_date: null },
    select: { id: true, name: true, raw_age_text: true, created_at: true },
    orderBy: { created_at: 'asc' },
  });

  console.log(`Ditemukan ${rows.length} baris children dengan birth_date NULL.\n`);

  const plan: PlanRow[] = [];
  let updateCount = 0;
  let momCount = 0;
  let ambiguousCount = 0;

  for (const r of rows) {
    const raw = r.raw_age_text || '';
    const anchor = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);

    let action: Action = 'SKIP';
    let reason = '';
    let parsedBirth: Date | null = null;
    let approximate = false;

    if (isGestationalText(raw)) {
      action = 'FLAG_MOM';
      reason = 'Teks usia gestasional (hamil/nifas) — bukan anak';
      momCount++;
    } else {
      const est = parseAgeTextEstimate(raw, anchor);
      if (est.multiSubject) {
        action = 'FLAG_AMBIGUOUS';
        reason = 'Teks memuat >1 subjek/usia (mis. "2 bln & 3 thn") — perlu pecah per anak';
        ambiguousCount++;
      } else if (est.birthDate) {
        parsedBirth = est.birthDate;
        approximate = est.approximate;
        action = 'UPDATE_BIRTH';
        reason = approximate ? 'Estimasi dari rentang usia (batas bawah)' : 'Estimasi dari teks usia';
        updateCount++;
      } else if (!raw.trim()) {
        action = 'FLAG_AMBIGUOUS';
        reason = 'raw_age_text kosong — perlu input manual';
        ambiguousCount++;
      } else {
        action = 'FLAG_AMBIGUOUS';
        reason = 'Teks usia tidak bisa di-parse (mis. angka telanjang) — perlu input manual';
        ambiguousCount++;
      }
    }

    plan.push({
      id: r.id,
      name: r.name,
      raw_age_text: r.raw_age_text,
      created_at: anchor.toISOString(),
      parsed_birth: parsedBirth ? parsedBirth.toISOString() : null,
      approximate,
      action,
      reason,
    });
  }

  const header = 'id,name,raw_age_text,created_at,parsed_birth,approximate,action,reason';
  const csv = [header, ...plan.map((p) => [
    csvEscape(p.id), csvEscape(p.name), csvEscape(p.raw_age_text), csvEscape(p.created_at),
    csvEscape(p.parsed_birth), String(p.approximate), p.action, csvEscape(p.reason),
  ].join(','))].join('\n');
  const outPath = join(process.cwd(), 'reconcile-children-plan.csv');
  writeFileSync(outPath, csv, 'utf8');
  console.log(`Rencana rekonsiliasi ditulis ke: ${outPath}`);
  console.log(`  UPDATE_BIRTH   : ${updateCount}`);
  console.log(`  FLAG_MOM       : ${momCount}`);
  console.log(`  FLAG_AMBIGUOUS : ${ambiguousCount}`);

  if (!isCommit) {
    console.log('\n[DRY-RUN] Tidak ada perubahan DB. Tinjau CSV, lalu jalankan ulang dengan --commit.');
    return;
  }

  let applied = 0;
  for (const p of plan) {
    if (p.action !== 'UPDATE_BIRTH' || !p.parsed_birth) continue;
    const birthDate = new Date(p.parsed_birth);
    const monthsAtReg = monthsBetween(birthDate, new Date(p.created_at));
    await prisma.child.update({
      where: { id: p.id },
      data: { birth_date: birthDate, age_months_at_registration: monthsAtReg },
    });
    applied++;
  }
  console.log(`\n[COMMIT] ${applied} baris children diperbarui birth_date-nya.`);
  console.log(`[COMMIT] ${momCount} baris Moms & ${ambiguousCount} ambigu DIBIARKAN untuk review manual CS (tidak dihapus).`);
}

main()
  .catch((e) => {
    console.error('[RECONCILE CHILDREN] Gagal:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
