import { prisma } from '../db/client';
import {
  resolveTreatmentValue,
  fireCapiEvent,
  getTenantCapiFormats,
  getTenantAutoSendPurchaseCapi,
  extractValueByFormat,
} from './capi.service';

/**
 * Deteksi event Purchase dari pesan masuk customer.
 *
 * UX funnel: setelah form reservasi terkonfirmasi, customer mengirim pesan bayar
 * yang berisi label payment (format_purchase tenant, default "Payment") beserta
 * nominal rupiah, misal "Payment 250000". Saat terdeteksi → fire event CAPI
 * 'Purchase' (value di-parse dari pesan via format_value tenant, fallback ke katalog treatment)
 * dan tandai purchase_event_sent_at pada reservasi terakhir customer agar tombol "Tandai
 * Lunas" di dashboard nonaktif selama 7 hari (cegah double-count & cover repeat order).
 *
 * Moderasi outlier (default ON): event TIDAK langsung dikirim. purchase_occurred_at
 * dicatat & purchase_review_status='pending' → masuk queue moderasi admin
 * (approve-purchase / reject-purchase). Hanya bila tenant.auto_send_purchase_capi
 * = true, event ditembakkan langsung. Rule anti false-positive: WAJIB ada nominal
 * rupiah (angka) di pesan selain keyword. Tanpa angka → skip.
 */

const PURCHASE_DEDUP_WINDOW_MS = 1000 * 60 * 60 * 24 * 7; // 7 hari

/** Ekstrak nominal rupiah dari teks (prioritaskan formatValue jika ada, lalu pola umum terbesar). */
export function extractRupiahAmount(text: string, formatValueTemplate?: string): number | undefined {
  if (!text) return undefined;
  if (formatValueTemplate) {
    const formattedVal = extractValueByFormat(text, formatValueTemplate);
    if (formattedVal !== undefined) return formattedVal;
  }
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

  // Anti false-positive: wajib ada nominal rupiah (utamakan formatValue tenant).
  const amount = extractRupiahAmount(text, formats.formatValue);
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

    // Sudah ditahan menunggu review admin → perbarui nilainya jika ada revisi nominal baru, tapi jangan re-queue
    if (reservation.purchase_review_status === 'pending' && reservation.purchase_occurred_at) {
      let value: number | undefined;
      if (/payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(text)) {
        try {
          const { parsePaymentSection } = await import('../utils/conversation-transaction-extractor');
          const fin = parsePaymentSection(text);
          if (fin.treatmentPrice > 0) value = fin.treatmentPrice;
          else if (fin.totalPrice > 0) value = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
        } catch {}
      }
      if (!value) {
        const pureTreatmentVal = extractValueByFormat(text, formats.formatValue);
        value = pureTreatmentVal ?? amount;
      }
      if (value && value !== reservation.purchase_value) {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: { purchase_value: value },
        });
        console.log(`[CAPI HELD] Updated purchase value for pending review ${reservation.id} to ${value}`);
      }
      return false;
    }

    const alreadySentRecently =
      reservation.purchase_event_sent_at &&
      Date.now() - new Date(reservation.purchase_event_sent_at).getTime() < PURCHASE_DEDUP_WINDOW_MS;
    if (alreadySentRecently) return false;

    // Nilai definitif: nominal murni dari financial section, formatValue tenant, lalu amount, fallback katalog.
    let value: number | undefined;
    if (/payment|pembayaran|total\s*[:=]|treatment\s*[:=]/i.test(text)) {
      try {
        const { parsePaymentSection } = await import('../utils/conversation-transaction-extractor');
        const fin = parsePaymentSection(text);
        if (fin.treatmentPrice > 0) value = fin.treatmentPrice;
        else if (fin.totalPrice > 0) value = Math.max(0, fin.totalPrice - fin.ongkir + fin.promo);
      } catch {}
    }
    if (!value) {
      const pureTreatmentVal = extractValueByFormat(text, formats.formatValue);
      value = pureTreatmentVal ?? amount ?? (await resolveTreatmentValue(reservation.treatment_detail || reservation.raw_text));
    }

    // Kebijakan moderasi: default tahan (false = moderasi manual aktif) sampai
    // admin approve/reject di dashboard. Hanya true → kirim langsung.
    const autoSend = await getTenantAutoSendPurchaseCapi(tenantId);

    const updateData: any = {
      purchase_occurred_at: new Date(),
      purchase_value: value,
    };

    if (autoSend) {
      fireCapiEvent({
        eventName: 'Purchase',
        customer,
        adClick: reservation.customer?.adClick || customer.adClick || undefined,
        value,
        currency: 'IDR',
        tenantId,
        customData: { source: 'CUSTOMER_PAYMENT_MESSAGE', reservationId: reservation.id },
      });
      updateData.purchase_event_sent_at = new Date();
      updateData.purchase_review_status = 'approved';
    } else {
      updateData.purchase_review_status = 'pending';
      console.log(
        `[CAPI HELD] Purchase event queued for admin review (reservation ${reservation.id}, customer ${customer.id}, value ${value})`
      );
    }

    // Catat pengiriman/penahanan → dasar status moderasi di dashboard.
    try {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: updateData,
      });
    } catch (dbErr) {
      console.warn('[CAPI] Failed to persist purchase review state:', (dbErr as Error).message);
    }

    return true;
  } catch (err) {
    // DB offline/error → jangan ambruk opsional path.
    console.warn('[CAPI] Purchase detection skipped (DB):', (err as Error).message);
    return false;
  }
}