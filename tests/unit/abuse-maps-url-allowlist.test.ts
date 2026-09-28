/**
 * abuse-maps-url-allowlist.test.ts — Allowlist URL share lokasi (CASE-055).
 *
 * Bug: pesan share lokasi legitimate `https://share.google/...` (share sheet
 * Google Maps) TIDAK dikenali allowlist lama (`includes('maps.google.com')`
 * dkk) sehingga di-auto-block sebagai `uninvited_link`, memutus percakapan
 * yang sebenarnya hanya mengirim titik lokasi.
 *
 * Perbaikan fondasional: allowlist berbasis HOSTNAME via parsing URL standar
 * (`new URL`), bukan `includes` substring hafalan. Daftar hostname bersifat
 * teknis (resmi Google Maps/share), bukan hafalan frasa customer.
 *
 * Prinsip Adversarial (MANDATORY): casing, subdomain, query string, trailing
 * punctuation, URL invalid, dan non-maps spam.
 */
import { describe, it, expect } from 'vitest';
import { ConversationState } from '@prisma/client';
import { abuseDetectionService } from '../../src/services/abuse-detection.service';
import { customerService } from '../../src/services/customer.service';

async function check(message: string, state: ConversationState) {
  // Customer nyata di store (fallback in-memory saat DB offline) agar jalur
  // applyAutoBlock dapat berjalan seperti produksi.
  const phone = '6289999000001';
  const customer = await customerService.getOrCreateCustomer(phone, 'QA Abuse', 'default-tenant');
  const conversation: any = { id: 'conv-abuse-1', current_state: state, is_human_handling: false };
  return abuseDetectionService.checkAndProcessAbuse(customer, conversation, message, 'default-tenant');
}

describe('Allowlist URL share lokasi — bukan uninvited_link (CASE-055)', () => {
  it('share.google pre-interest TIDAK diblokir', async () => {
    const res = await check('https://share.google/6y75BHeyi6eu9Y2j3', ConversationState.LOCATION_CONFIRMED);
    expect(res.blocked).toBe(false);
    expect(res.reason).not.toBe('uninvited_link');
  });

  it('varian resmi maps/google TIDAK diblokir (termasuk casing & subdomain)', async () => {
    const urls = [
      'https://maps.google.com/?q=-7.2,112.7',
      'https://maps.app.goo.gl/VbA7zWQk6N9E6R1u8',
      'https://www.google.com/maps/place/x',
      'https://Share.Google/abcDEF',
      'ini lokasi saya https://share.google/xyz (titik pin)',
    ];
    for (const u of urls) {
      const res = await check(u, ConversationState.INITIAL);
      expect(res.blocked, `url="${u}"`).toBe(false);
    }
  });

  it('link asing pre-interest TETAP diblokir', async () => {
    const res = await check('cek dulu di sini yuk http://promo-abal.xyz/hemat', ConversationState.INITIAL);
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('uninvited_link');
  });

  it('link asing setelah AWAITING_INTEREST tidak diblokir (perilaku lama utuh)', async () => {
    const res = await check('http://promo-abal.xyz/hemat', ConversationState.AWAITING_INTEREST);
    expect(res.blocked).toBe(false);
  });

  it('subdomain palsu penyusup (share.google.evil.com) DIBLOKIR', async () => {
    const res = await check('https://share.google.evil.com/phish', ConversationState.INITIAL);
    expect(res.blocked).toBe(true);
    expect(res.reason).toBe('uninvited_link');
  });
});
