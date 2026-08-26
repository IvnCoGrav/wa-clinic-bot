import dotenv from 'dotenv';
dotenv.config();

/**
 * Normalisasi nomor HP Indonesia ke format standar 628xxx untuk pencocokan whitelist.
 */
export function normalizePhoneForFlagCheck(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Cek apakah Slot-Filling Engine aktif untuk customer ini.
 * Default: HANYA aktif jika SLOT_FILLING_ENGINE_ENABLED=true ATAU nomor masuk dalam whitelist.
 */
export function isSlotFillingEnabledForCustomer(phone: string, tenantId?: string): boolean {
  // 1. Cek ENV master toggle (Aktif 100% jika true)
  if (process.env.SLOT_FILLING_ENGINE_ENABLED === 'true') {
    return true;
  }

  // 2. Cek Whitelist Testing Numbers (Default nomor testing: 6288235780925)
  const rawWhitelist = process.env.SLOT_FILLING_WHITELIST_PHONES || '6288235780925,088235780925';
  const whitelist = rawWhitelist
    .split(',')
    .map((p) => normalizePhoneForFlagCheck(p.trim()))
    .filter((p) => p.length > 0);

  const normalizedCustomerPhone = normalizePhoneForFlagCheck(phone);
  return whitelist.includes(normalizedCustomerPhone);
}

/**
 * Cek apakah Shadow Mode aktif (menjalankan slot engine di background untuk evaluasi log tanpa mengirim balasan).
 */
export function isSlotFillingShadowMode(): boolean {
  return process.env.SLOT_FILLING_SHADOW_MODE === 'true';
}

/**
 * Cek apakah Fast-Track 1-Call FAQ aktif pada Slot-Filling Engine.
 * Default: true (aktif) kecuali jika disetel ke 'false' via env FAST_FAQ_1CALL_ENABLED.
 */
export function isFastFaq1CallEnabled(tenantId?: string): boolean {
  return process.env.FAST_FAQ_1CALL_ENABLED !== 'false';
}

