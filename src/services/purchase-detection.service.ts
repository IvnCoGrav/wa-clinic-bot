import { prisma } from '../db/client';
import { resolveTreatmentValue, fireCapiEvent, getTenantCapiFormats } from './capi.service';

/**
 * Deteksi event Purchase dari pesan masuk customer.
 *
 * UX funnel: setelah form reservasi terkonfirmasi, customer mengirim pesan bayar
 * yang berisi label payment (format_purchase tenant, default "Payment") beserta
 * nominal rupiah, misal "Payment 250000". Saat terdeteksi → fire event CAPI
 * 'Purchase' (value di-parse dari pesan, fallback ke katalog treatment) dan tandai
 * purchase_event_sent_at pada reservasi terakhir customer agar tombol "Tandai
 * Lunas" di dashboard nonaktif selama 7 hari (cegah double-count & cover repeat order).
 *
 * Rule anti false-positive: WAJIB ada nominal rupiah (angka) di pesan selain keyword.
 * Tanpa angka → skip (jalur admin confirm yang menangani).
 */

const PURCHASE_DEDUP_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 hari

/** Ekstrak nominal rupiah terbesar dari teks. Kembalikan number | undefined. */
export function extractRupiahAmount(text: string): number | undefined {
  if (!text) return undefined;
  // Pola: "Rp 250.000", "Rp250000", "250.000", "250000", "250 rb"/"ribu"
  const patterns = [
    /Rp[\s.]?([\d.,]+)\s*(rb|ribu)?/gi,
    /([\d][\d.,]*)\s*(rb|ribu)/gi,
    /([\d.,]{3,})/g,
  ];
  let best: number | undefined;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1] ?? m[0];
      let numStr = raw.replace(/[^\d]/g, '');
      if (!numStr) continue;
      let val = parseInt(numStr, 10);
      const suffix = (m[2] || '').toLowerCase();
      if (suffix && (suffix.startsWith('rb') || suffix.startsWith('ribu'))) {
        val = val * 1000;
      }
      // Tolak nominal tidak masuk akal untuk layanan klinik homecare
      if (val >= 5000 && val <= 100_000_000 && (best === undefined || val > best)) {
        best = val;
      }
    }
  }
  return best;
}

export async function maybeFirePurchaseEvent(params: {
  customer: any;
  conversation: any;
  text: string;
  tenantId: string;
}): Promise<boolean> {
  const { customer, conversation, text, tenantId } = params;

  const formats = await getTenantCapiFormats(tenantId);
  const purchaseKeyword = formats.formatPurchase.toLowerCase().trim();
  const textLower = (text || '').toLowerCase();
  if (!purchaseKeyword || !textLower.includes(purchaseKeyword)) {
    return false;
  }

  // Anti false-positive: wajib ada nominal rupiah.
  const amount = extractRupiahAmount(text);
  if (amount === undefined) {
    return false;
  }

  // Cari reservasi terakhir customer yang belum purchase-event (non-cancelled).
  try {
    const reservation = await prisma.reservation.findFirst({
      where: {
        customer_id: customer.id,
        tenant_id: tenantId,
        status: { not: 'cancelled' },
      },
      orderBy: { created_at: 'desc' },
      include: { customer: { include: { adClick: true } } },
    });
    if (!reservation) return false;

    const alreadySentRecently =
      reservation.purchase_event_sent_at &&
      Date.now() - new Date(reservation.purchase_event_sent_at).getTime() < PURCHASE_DEDUP_WINDOW_MS;
    if (alreadySentRecently) return false;

    // Nilai definitif: nominal dari pesan customer (lebih akurat), fallback katalog.
    const value = amount ?? (await resolveTreatmentValue(reservation.treatment_detail || reservation.raw_text));

    fireCapiEvent({
      eventName: 'Purchase',
      customer,
      adClick: reservation.customer?.adClick || customer.adClick || undefined,
      value,
      currency: 'IDR',
      tenantId,
      customData: { source: 'CUSTOMER_PAYMENT_MESSAGE', reservationId: reservation.id },
    });

    // Catat pengiriman event → dasar disable tombol "Tandai Lunas" 7 hari di dashboard.
    try {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { purchase_event_sent_at: new Date() },
      });
    } catch (dbErr) {
      console.warn('[CAPI] Failed to persist purchase_event_sent_at:', (dbErr as Error).message);
    }

    return true;
  } catch (err) {
    // DB offline/error → jangan ambruk opsional path.
    console.warn('[CAPI] Purchase detection skipped (DB):', (err as Error).message);
    return false;
  }
}