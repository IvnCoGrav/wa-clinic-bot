/**
 * src/scripts/reconcile-payment-proof-rows.ts
 *
 * Rekonsiliasi bukti pembayaran yang menggantung, memakai seam kanonis
 * `verifyReservationPayment()` (bukan UPDATE mentah untuk status bayar).
 *
 * Prinsip:
 * - Kasus WAJIB berasal dari file JSON (data-driven). DILARANG hardcode nominal
 *   atau path bukti di dalam file TypeScript ini.
 * - `amount` WAJIB diisi dan cocok dengan tagihan kanonis; script tidak pernah
 *   menebak nominal dari total DB.
 * - Perubahan billing bersifat kompensasi: bila verifikasi gagal, nilai lama
 *   dikembalikan (tidak meninggalkan state parsial).
 *
 * Penggunaan:
 *   Validasi file kasus (tanpa DB):
 *     npx tsx src/scripts/reconcile-payment-proof-rows.ts --validate-cases
 *
 *   Dry-run (default, tanpa tulis DB):
 *     npx tsx src/scripts/reconcile-payment-proof-rows.ts
 *     npx tsx src/scripts/reconcile-payment-proof-rows.ts --reservation-id=<uuid>
 *
 *   Apply (wajib token konfirmasi + backup lebih dulu):
 *     npx tsx src/scripts/reconcile-payment-proof-rows.ts \
 *       --reservation-id=<uuid> --apply --confirm=RECONCILE_PAYMENT_PROOFS_CONFIRMED --sync-sheets
 *
 *   Opsi: --cases=<path> (default docs/audit/2026-11-19/reconcile-cases.json)
 *         --include-done (ikut memproses kasus ber-state DONE)
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { resolveReservationBilling } from '../services/reservation-billing.service';
import { verifyReservationPayment } from '../services/reservation-payment-verification.service';
import { mediaService } from '../services/media.service';
import { auditService } from '../services/audit.service';

const DEFAULT_CASES_PATH = path.join('docs', 'audit', '2026-11-19', 'reconcile-cases.json');
const CONFIRM_TOKEN = 'RECONCILE_PAYMENT_PROOFS_CONFIRMED';

interface BillingOverride {
  purchaseValue: number;
  deliveryFee: number;
  discountAmount: number;
}

interface ReconcileCase {
  reservationId: string;
  proofSource: string;
  amount: number;
  paymentMethod: string;
  referenceNumber?: string;
  billing?: BillingOverride;
  /**
   * true = hanya menempelkan bukti (reservasi sudah tercatat lunas). Nominal
   * tidak dipakai untuk memverifikasi pembayaran dan `purchase_occurred_at`
   * TIDAK disentuh. Dipakai untuk backfill bukti historis yang nominalnya
   * berbeda (kelebihan/kekurangan bayar) dan butuh keputusan bisnis terpisah.
   */
  evidenceOnly?: boolean;
  /**
   * Tanggal transaksi pada bukti (ISO string). Bila diisi, `purchase_occurred_at`
   * dikoreksi ke tanggal ini setelah verifikasi agar laporan bulanan tidak
   * bergeser ke tanggal eksekusi script. Hanya untuk mode verifikasi.
   */
  paidAt?: string;
  state?: 'PENDING' | 'DONE';
  notes?: string;
}

interface CasesFile {
  tenantId?: string;
  cases: ReconcileCase[];
}

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const isDryRun = !isApply;
const syncSheets = args.includes('--sync-sheets');
const includeDone = args.includes('--include-done');
const validateOnly = args.includes('--validate-cases');

function argValue(name: string): string | null {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=').trim() : null;
}

const confirmToken = argValue('confirm') || '';
const targetResId = argValue('reservation-id');
const tenantOverride = argValue('tenant');
const casesPath = argValue('cases') || DEFAULT_CASES_PATH;

function loadCases(filePath: string): { data: CasesFile | null; errors: string[] } {
  const errors: string[] = [];
  if (!fs.existsSync(filePath)) {
    return { data: null, errors: [`File kasus tidak ditemukan: ${filePath}`] };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err: any) {
    return { data: null, errors: [`JSON tidak valid: ${err?.message || err}`] };
  }

  if (!parsed || !Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    return { data: null, errors: ['Field "cases" wajib berupa array dan tidak boleh kosong.'] };
  }

  const seen = new Set<string>();
  parsed.cases.forEach((c: any, idx: number) => {
    const label = `cases[${idx}]`;
    if (!c || typeof c !== 'object') {
      errors.push(`${label}: bukan object.`);
      return;
    }
    if (!c.reservationId || String(c.reservationId).trim().length < 32) {
      errors.push(`${label}: reservationId tidak valid.`);
    } else if (seen.has(String(c.reservationId))) {
      errors.push(`${label}: reservationId duplikat (${c.reservationId}).`);
    } else {
      seen.add(String(c.reservationId));
    }
    if (!c.proofSource || typeof c.proofSource !== 'string') {
      errors.push(`${label}: proofSource wajib diisi.`);
    }
    if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
      errors.push(`${label}: amount wajib angka > 0 (dilarang menebak dari total DB).`);
    }
    if (!c.paymentMethod || typeof c.paymentMethod !== 'string') {
      errors.push(`${label}: paymentMethod wajib diisi.`);
    }
    if (c.paidAt && isNaN(new Date(c.paidAt).getTime())) {
      errors.push(`${label}: paidAt bukan tanggal valid (${c.paidAt}).`);
    }
    if (c.billing) {
      const b = c.billing;
      const nums = [b.purchaseValue, b.deliveryFee, b.discountAmount];
      if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) {
        errors.push(`${label}: billing wajib angka >= 0.`);
      } else if (typeof c.amount === 'number') {
        const total = b.purchaseValue - b.discountAmount + b.deliveryFee;
        if (Math.round(total) !== Math.round(c.amount)) {
          errors.push(
            `${label}: billing.total=${Math.round(total)} != amount=${Math.round(c.amount)}.`
          );
        }
      }
    }
  });

  return { data: errors.length === 0 ? (parsed as CasesFile) : null, errors };
}

function resolveMediaAbsolutePath(mediaPathOrUrl: string): string | null {
  if (path.isAbsolute(mediaPathOrUrl) && fs.existsSync(mediaPathOrUrl)) {
    return mediaPathOrUrl;
  }
  if (mediaPathOrUrl.startsWith('/media/')) {
    const fromMediaService = mediaService.filePathFromRelativeUrl(mediaPathOrUrl);
    if (fromMediaService && fs.existsSync(fromMediaService)) {
      return fromMediaService;
    }
  }
  const directPath = path.resolve(process.cwd(), mediaPathOrUrl);
  if (fs.existsSync(directPath)) return directPath;
  return null;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function restoreBilling(reservationId: string, snapshot: Record<string, any>): Promise<void> {
  await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      purchase_value: snapshot.purchase_value ?? null,
      delivery_fee: snapshot.delivery_fee ?? null,
      discount_amount: snapshot.discount_amount ?? null,
    },
  });
}

async function reconcileCase(
  entry: ReconcileCase,
  tenantId: string
): Promise<boolean> {
  console.log(`\n------------------------------------------------------------`);
  console.log(`[TARGET] ${entry.reservationId} (state: ${entry.state || 'PENDING'})`);

  const reservation = await prisma.reservation.findFirst({
    where: { id: entry.reservationId, tenant_id: tenantId },
    include: {
      customer: { select: { id: true, name: true, phone: true, ongkir: true } },
      items: { select: { price: true, custom_name: true } },
    },
  });

  if (!reservation) {
    console.error(`[ERROR] Reservasi tidak ditemukan di tenant ${tenantId}.`);
    return false;
  }

  console.log(`- Customer    : ${reservation.customer?.name || '-'} (${reservation.customer?.phone || '-'})`);
  console.log(`- Status      : ${reservation.status}`);
  console.log(`- Proof URL   : ${reservation.proof_url || '(NULL)'}`);

  const snapshot = {
    purchase_value: reservation.purchase_value,
    delivery_fee: reservation.delivery_fee,
    discount_amount: reservation.discount_amount,
  };

  const currentBilling = await resolveReservationBilling(reservation as any, tenantId).catch(() => null);
  if (!currentBilling) {
    console.error('[ERROR] Gagal menghitung tagihan kanonis.');
    return false;
  }

  const billingTotal = entry.billing
    ? entry.billing.purchaseValue - entry.billing.discountAmount + entry.billing.deliveryFee
    : currentBilling.totalFee;

  const treatmentFee = entry.billing ? entry.billing.purchaseValue : currentBilling.treatmentFee;
  const deliveryFee = entry.billing ? entry.billing.deliveryFee : currentBilling.deliveryFee;
  const discount = entry.billing ? entry.billing.discountAmount : currentBilling.discount;

  console.log(
    `- Tagihan    : Layanan Rp ${treatmentFee.toLocaleString('id-ID')}, Ongkir Rp ${deliveryFee.toLocaleString('id-ID')}, Diskon Rp ${discount.toLocaleString('id-ID')} → Rp ${billingTotal.toLocaleString('id-ID')}`
  );
  console.log(
    `- Bukti      : ${entry.proofSource} (${entry.paymentMethod}${entry.referenceNumber ? `, Ref: ${entry.referenceNumber}` : ''}) nominal Rp ${entry.amount.toLocaleString('id-ID')}`
  );

  if (!entry.evidenceOnly && Math.round(entry.amount) !== Math.round(billingTotal)) {
    console.error(
      `[GUARD BLOCKED] amount (Rp ${entry.amount}) != tagihan kanonis (Rp ${billingTotal}). Tidak ada data yang ditulis.`
    );
    return false;
  }

  const absPath = resolveMediaAbsolutePath(entry.proofSource);
  if (!absPath) {
    console.error(`[ERROR] Berkas bukti tidak ditemukan: ${entry.proofSource}`);
    return false;
  }
  const stats = fs.statSync(absPath);
  console.log(`- Berkas     : ${absPath} (${(stats.size / 1024).toFixed(1)} KB)`);

  // --- Mode evidence-only: tempel bukti historis tanpa menyentuh status bayar ---
  if (entry.evidenceOnly) {
    const existingProof = String(reservation.proof_url || '').trim();

    if (isDryRun) {
      console.log('[DRY-RUN][EVIDENCE ONLY] Rencana: salin bukti ke /media/payment-proofs/, isi proof_url + payment_method + receipt; status bayar TIDAK diubah.');
      if (existingProof) {
        console.log(`  Catatan: proof_url sudah terisi (${existingProof}) → apply akan MELEWATI tanpa menimpa.`);
      }
      console.log('[DRY-RUN SELESAI] Tidak ada perubahan data.');
      return true;
    }

    if (existingProof) {
      console.log(`[SKIP] proof_url sudah terisi (${existingProof}); tidak menimpa.`);
      return true;
    }

    const saved = await mediaService.savePaymentProof({
      tenantId,
      buffer: fs.readFileSync(absPath),
      mimeType: mimeFromPath(absPath),
      fileName: `proof-${reservation.id}.jpg`,
    });

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        proof_url: saved.hdUrl,
        payment_method: entry.paymentMethod,
        receipt_amount: entry.amount,
        ...(entry.referenceNumber ? { receipt_reference: entry.referenceNumber } : {}),
      },
    });

    try {
      await auditService.logAdminAction({
        apiKey: 'SCRIPT_RECONCILIATION',
        adminIdentity: 'SYSTEM_RECONCILE_SCRIPT_CLI',
        action: 'PAYMENT_PROOF_EVIDENCE_ATTACHED',
        targetId: reservation.id,
        tenantId,
        payload: {
          proofUrl: saved.hdUrl,
          amount: entry.amount,
          paymentMethod: entry.paymentMethod,
          reference: entry.referenceNumber ?? null,
          billingTotal,
          evidenceOnly: true,
        },
        ipAddress: '127.0.0.1',
      });
    } catch (auditErr: any) {
      console.warn(`[AUDIT WARN] ${auditErr?.message || auditErr}`);
    }

    console.log(`[SUCCESS] Bukti ditempelkan (evidence-only): ${saved.hdUrl}`);

    if (syncSheets && reservation.status === 'completed') {
      try {
        const { sheetsSyncService } = await import('../services/sheets/sheets-sync.service');
        await sheetsSyncService.syncReservation(reservation.id, tenantId);
        console.log('[SHEETS] Sinkronisasi selesai.');
      } catch (sheetsErr: any) {
        console.warn(`[SHEETS WARN] ${sheetsErr?.message || sheetsErr}`);
      }
    }

    return true;
  }

  const needsBillingUpdate = Boolean(
    entry.billing &&
      (Number(reservation.purchase_value) !== entry.billing.purchaseValue ||
        Number(reservation.delivery_fee || 0) !== entry.billing.deliveryFee ||
        Number(reservation.discount_amount || 0) !== entry.billing.discountAmount)
  );

  if (isDryRun) {
    console.log('[DRY-RUN] Rencana:');
    if (needsBillingUpdate && entry.billing) {
      console.log(
        `  1. billing → purchase_value=${entry.billing.purchaseValue}, delivery_fee=${entry.billing.deliveryFee}, discount_amount=${entry.billing.discountAmount}`
      );
    }
    console.log('  2. verifyReservationPayment(): simpan bukti permanen, purchase_occurred_at, LTV, audit.');
    if (entry.referenceNumber) {
      console.log(`  3. receipt_reference=${entry.referenceNumber}, receipt_amount=${entry.amount}`);
    }
    if (entry.paidAt) {
      console.log(`  4. purchase_occurred_at dikoreksi ke tanggal bukti: ${entry.paidAt}`);
    }
    if (syncSheets) {
      console.log(`  4. sync Google Sheets (hanya bila status completed).`);
    }
    console.log('[DRY-RUN SELESAI] Tidak ada perubahan data.');
    return true;
  }

  if (needsBillingUpdate && entry.billing) {
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        purchase_value: entry.billing.purchaseValue,
        delivery_fee: entry.billing.deliveryFee,
        discount_amount: entry.billing.discountAmount,
      },
    });
    console.log('[APPLY] Billing diperbarui (snapshot lama disimpan untuk rollback).');
  }

  const imageBuffer = fs.readFileSync(absPath);
  const verifyResult = await verifyReservationPayment({
    tenantId,
    reservationId: reservation.id,
    proofImageB64: imageBuffer.toString('base64'),
    mimeType: mimeFromPath(absPath),
    amount: entry.amount,
    paymentMethod: entry.paymentMethod,
    auditContext: {
      apiKey: 'SCRIPT_RECONCILIATION',
      adminIdentity: 'SYSTEM_RECONCILE_SCRIPT_CLI',
      ipAddress: '127.0.0.1',
    },
  });

  if (verifyResult.kind === 'already_paid') {
    const fresh = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      select: { proof_url: true },
    });
    if (!fresh?.proof_url) {
      const saved = await mediaService.savePaymentProof({
        tenantId,
        buffer: imageBuffer,
        mimeType: mimeFromPath(absPath),
        fileName: `proof-${reservation.id}.jpg`,
      });
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { proof_url: saved.hdUrl, payment_method: entry.paymentMethod },
      });
      console.log(`[APPLY] Reservasi sudah lunas tanpa bukti → proof_url diisi ${saved.hdUrl}`);
    } else {
      console.log('[INFO] Reservasi sudah lunas dan sudah punya bukti; tidak ada perubahan.');
    }
  } else if (verifyResult.kind === 'verified') {
    console.log(`[SUCCESS] Pembayaran terverifikasi. Proof: ${verifyResult.data.proofUrl}`);

    if (entry.paidAt) {
      const paidAtDate = new Date(entry.paidAt);
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { purchase_occurred_at: paidAtDate },
      });
      try {
        await auditService.logAdminAction({
          apiKey: 'SCRIPT_RECONCILIATION',
          adminIdentity: 'SYSTEM_RECONCILE_SCRIPT_CLI',
          action: 'PAYMENT_PROOF_PAID_AT_SET',
          targetId: reservation.id,
          tenantId,
          payload: {
            paidAt: paidAtDate.toISOString(),
            source: 'receipt_date',
            billingTotal,
          },
          ipAddress: '127.0.0.1',
        });
      } catch (auditErr: any) {
        console.warn(`[AUDIT WARN] ${auditErr?.message || auditErr}`);
      }
      console.log(`[APPLY] purchase_occurred_at dikoreksi ke ${paidAtDate.toISOString()}`);
    }
  } else {
    if (needsBillingUpdate) {
      await restoreBilling(reservation.id, snapshot);
      console.error('[ROLLBACK] Billing dikembalikan ke nilai semula.');
    }
    console.error(`[ERROR] Verifikasi gagal: ${verifyResult.kind}`);
    return false;
  }

  if (entry.amount > 0) {
    const fresh = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      select: { raw_text: true },
    });
    const currentRaw = fresh?.raw_text || '';
    const amountTag = `[RECEIPT_AMOUNT:${entry.amount}]`;
    const newTags: string[] = [];
    if (!currentRaw.includes(amountTag)) newTags.push(amountTag);
    if (entry.referenceNumber) {
      const refTag = `[RECEIPT_REF:${entry.referenceNumber}]`;
      if (!currentRaw.includes(refTag)) newTags.push(refTag);
    }

    await prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        receipt_amount: entry.amount,
        ...(entry.referenceNumber ? { receipt_reference: entry.referenceNumber } : {}),
        ...(newTags.length > 0
          ? { raw_text: `${currentRaw}\n${newTags.join('\n')}`.trim() }
          : {}),
      },
    });
    console.log('[APPLY] receipt_amount & tag bukti tersimpan.');
  }

  if (syncSheets) {
    const updated = await prisma.reservation.findUnique({
      where: { id: reservation.id },
      select: { status: true },
    });
    if (updated?.status === 'completed') {
      try {
        const { sheetsSyncService } = await import('../services/sheets/sheets-sync.service');
        await sheetsSyncService.syncReservation(reservation.id, tenantId);
        console.log('[SHEETS] Sinkronisasi selesai.');
      } catch (err: any) {
        console.warn(`[SHEETS WARN] ${err?.message || err}`);
      }
    } else {
      console.log(`[SHEETS SKIP] Status '${updated?.status}' bukan completed.`);
    }
  }

  return true;
}

async function main(): Promise<number> {
  const { data, errors } = loadCases(casesPath);

  if (validateOnly) {
    if (errors.length > 0) {
      console.error('[VALIDATE CASES] GAGAL:');
      for (const e of errors) console.error(`  - ${e}`);
      return 1;
    }
    console.log(`[VALIDATE CASES] OK — ${data!.cases.length} kasus di ${casesPath}`);
    return 0;
  }

  if (!data) {
    console.error('[FATAL] File kasus tidak valid:');
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }

  const tenantId = tenantOverride || data.tenantId || DEFAULT_TENANT_ID;

  console.log('============================================================');
  console.log('[RECONCILIATION] Bukti Pembayaran');
  console.log(`[RECONCILIATION] Mode   : ${isDryRun ? 'DRY-RUN (tanpa tulis DB)' : 'APPLY (menulis DB)'}`);
  console.log(`[RECONCILIATION] Tenant : ${tenantId}`);
  console.log(`[RECONCILIATION] Kasus  : ${casesPath}`);
  console.log('============================================================');

  if (isApply && confirmToken !== CONFIRM_TOKEN) {
    console.error(`\n[FATAL GUARD] Mode --apply wajib: --confirm=${CONFIRM_TOKEN}`);
    console.error('Eksekusi dibatalkan untuk melindungi integritas data.\n');
    return 1;
  }

  let targets = data.cases;
  if (targetResId) {
    targets = targets.filter((c) => c.reservationId === targetResId);
    if (targets.length === 0) {
      console.error(`[ERROR] reservation-id ${targetResId} tidak ada di file kasus.`);
      return 1;
    }
  } else if (!includeDone) {
    targets = targets.filter((c) => (c.state || 'PENDING') !== 'DONE');
  }

  if (targets.length === 0) {
    console.log('[INFO] Tidak ada kasus yang perlu diproses (semua DONE atau filter kosong).');
    return 0;
  }

  let ok = 0;
  let failed = 0;
  for (const entry of targets) {
    const passed = await reconcileCase(entry, tenantId);
    if (passed) ok++;
    else failed++;
  }

  console.log(`\n============================================================`);
  console.log(`[SELESAI] Total: ${targets.length}, Berhasil: ${ok}, Gagal: ${failed}`);
  console.log('============================================================\n');
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: any) => {
    const message = String(err?.message || err);
    if (message.includes("Can't reach database server") || err?.name === 'PrismaClientInitializationError') {
      console.error('[RECONCILIATION] Database tidak dapat diakses. Jalankan di environment dengan DATABASE_URL aktif.');
      process.exitCode = 2;
      return;
    }
    console.error('[FATAL ERROR]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
