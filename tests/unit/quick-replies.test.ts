import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  normalizeShortcut,
  isValidShortcut,
  interpolateQuickReply,
  extToMime,
  renderBankAccounts,
  resolveQuickReplyMedia,
  DEFAULT_QUICK_REPLIES,
  memoryQuickReplies,
} from '../../src/routes/admin/quick-replies.subroute';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { StaffReservationService } from '../../src/services/staff-reservation.service';

describe('Quick Replies - Helpers, In-Memory Store & SSOT Media Resolution', () => {
  beforeEach(() => {
    memoryQuickReplies.clear();
    vi.restoreAllMocks();
  });

  it('normalizeShortcut strips slash, lowercases and trims', () => {
    expect(normalizeShortcut('/QRIS')).toBe('qris');
    expect(normalizeShortcut('  /LOKASI  ')).toBe('lokasi');
    expect(normalizeShortcut('format_reservasi')).toBe('format_reservasi');
    expect(normalizeShortcut('/')).toBe('');
  });

  it('isValidShortcut validates length and charset', () => {
    expect(isValidShortcut('')).not.toBeNull();
    expect(isValidShortcut('a')).not.toBeNull(); // too short
    expect(isValidShortcut('qris')).toBeNull();
    expect(isValidShortcut('ongkir-123')).toBeNull();
    expect(isValidShortcut('bad chars!')).not.toBeNull();
    expect(isValidShortcut('a'.repeat(31))).not.toBeNull(); // too long
  });

  it('extToMime correctly detects mime types from file extension', () => {
    expect(extToMime('https://example.com/media/qris.png')).toBe('image/png');
    expect(extToMime('/media/foto.webp?v=1')).toBe('image/webp');
    expect(extToMime('/media/anim.gif')).toBe('image/gif');
    expect(extToMime('/media/foto.jpg')).toBe('image/jpeg');
    expect(extToMime(null)).toBe('image/jpeg');
  });

  it('renderBankAccounts formats bank list or returns - when empty', () => {
    expect(renderBankAccounts(null)).toBe('-');
    expect(renderBankAccounts({ bankAccounts: [] })).toBe('-');
    const formatted = renderBankAccounts({
      bankAccounts: [
        { bank: 'BCA', accountNumber: '1234567890', accountName: 'Kala Spa' },
        { bank: 'Mandiri', accountNumber: '9876543210', accountName: 'Kala Spa' },
      ],
    });
    expect(formatted).toContain('• *BCA*: `1234567890`');
    expect(formatted).toContain('• *Mandiri*: `9876543210`');
  });

  it('interpolateQuickReply replaces all placeholders including location fields', () => {
    const content = 'Halo {name} ({phone})\nKec: {kec}\nKota: {kota}\nAlamat: {alamat}\nDari {clinic_name} oleh {admin_name}';
    const out = interpolateQuickReply(content, {
      name: 'Bunda Retno',
      phone: '628123456789',
      kec: 'Rungkut',
      kota: 'Surabaya',
      alamat: 'Jl Rungkut Asri 12',
      clinic_name: 'Kala Spa',
      admin_name: 'Kak Sinta',
    });
    expect(out).toBe('Halo Bunda Retno (628123456789)\nKec: Rungkut\nKota: Surabaya\nAlamat: Jl Rungkut Asri 12\nDari Kala Spa oleh Kak Sinta');
  });

  it('DEFAULT_QUICK_REPLIES contains /qris replacing legacy /rek and uses QRIS media_type', () => {
    const shortcuts = DEFAULT_QUICK_REPLIES.map((r) => r.shortcut);
    expect(shortcuts).toContain('qris');
    expect(shortcuts).not.toContain('rek'); // Legacy hardcoded /rek dibersihkan
    expect(shortcuts).toContain('lokasi');
    expect(shortcuts).toContain('ongkir');
    expect(shortcuts).toContain('jadwal');
    expect(shortcuts).toContain('format_reservasi');
    expect(shortcuts).toContain('terimakasih');
    expect(shortcuts).toContain('batal');
    expect(shortcuts).toContain('shareloc');

    const qrisItem = DEFAULT_QUICK_REPLIES.find((r) => r.shortcut === 'qris')!;
    expect(qrisItem.media_type).toBe('QRIS');
    expect(qrisItem.image_url).toBeNull();
    expect(qrisItem.content).toContain('{bank_accounts}');
    expect(qrisItem.content).toContain('{petunjuk}');
  });

  it('resolveQuickReplyMedia: SSOT resolution dynamic from paymentInfo', async () => {
    const qrisRow = {
      id: 'qr-1',
      shortcut: 'qris',
      title: 'QRIS & Bank',
      content: 'Halo {name} ✨\n\n{bank_accounts}\n\n{petunjuk}',
      media_type: 'QRIS',
      image_url: null,
    };

    // Skenario 1: paymentInfo Rekening A
    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValueOnce({
      qrisImageUrl: 'https://cdn.example.com/qris-klinik.png',
      bankAccounts: [{ bank: 'BCA', accountNumber: '11112222', accountName: 'Kala Moms A' }],
      instructions: 'Transfer sebelum jam 17.00 WIB',
    });

    const resolvedA = await resolveQuickReplyMedia(qrisRow, DEFAULT_TENANT_ID);
    expect(resolvedA.image_url).toBe('https://cdn.example.com/qris-klinik.png');
    expect(resolvedA.mime_type).toBe('image/png');
    expect(resolvedA.content).toContain('11112222');
    expect(resolvedA.content).toContain('Transfer sebelum jam 17.00 WIB');

    // Skenario 2: paymentInfo diubah ke Rekening B -> response otomatis berubah dinamis
    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValueOnce({
      qrisImageUrl: 'https://cdn.example.com/qris-klinik-v2.webp',
      bankAccounts: [{ bank: 'BSI', accountNumber: '55556666', accountName: 'Kala Moms B' }],
      instructions: 'Cantumkan nama pasien di berita transfer',
    });

    const resolvedB = await resolveQuickReplyMedia(qrisRow, DEFAULT_TENANT_ID);
    expect(resolvedB.image_url).toBe('https://cdn.example.com/qris-klinik-v2.webp');
    expect(resolvedB.mime_type).toBe('image/webp');
    expect(resolvedB.content).toContain('55556666');
    expect(resolvedB.content).not.toContain('11112222');
    expect(resolvedB.content).toContain('Cantumkan nama pasien di berita transfer');
  });

  it('Adversarial Test: resolveQuickReplyMedia handles empty paymentInfo gracefully without crashing', async () => {
    const qrisRow = {
      id: 'qr-empty',
      shortcut: 'qris',
      title: 'QRIS & Bank',
      content: 'Transfer ke:\n{bank_accounts}\nPetunjuk: {petunjuk}',
      media_type: 'QRIS',
      image_url: null,
    };

    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValueOnce({
      qrisImageUrl: null,
      bankAccounts: [],
      instructions: undefined,
    });

    const resolved = await resolveQuickReplyMedia(qrisRow, DEFAULT_TENANT_ID);
    expect(resolved.image_url).toBeNull();
    expect(resolved.mime_type).toBe('image/jpeg');
    expect(resolved.content).toContain('-'); // Placeholder bank & petunjuk diisi '-'
  });

  it('resolveQuickReplyMedia ignores non-QRIS media types and preserves image_url', async () => {
    const customRow = {
      id: 'qr-custom',
      shortcut: 'brosur',
      title: 'Brosur Layanan',
      content: 'Berikut pricelist lengkap kami Bunda {name}',
      media_type: 'CUSTOM_IMAGE',
      image_url: 'https://cdn.example.com/brosur.png',
    };

    const resolved = await resolveQuickReplyMedia(customRow, DEFAULT_TENANT_ID);
    expect(resolved.image_url).toBe('https://cdn.example.com/brosur.png');
    expect(resolved.mime_type).toBe('image/png');
    expect(resolved.content).toBe('Berikut pricelist lengkap kami Bunda {name}');
  });

  it('memory store supports media_type and image_url in CRUD simulation', async () => {
    const id = 'mem_qr_media_1';
    const item = {
      id,
      tenant_id: DEFAULT_TENANT_ID,
      shortcut: 'promo',
      title: 'Promo Spesial',
      content: 'Berikut promo bulan ini {name}',
      category: 'Umum',
      media_type: 'CUSTOM_IMAGE',
      image_url: 'https://cdn.example.com/promo.jpg',
      created_at: new Date(),
      updated_at: new Date(),
    };
    memoryQuickReplies.set(id, item);
    expect(memoryQuickReplies.has(id)).toBe(true);

    const stored = memoryQuickReplies.get(id)!;
    expect(stored.media_type).toBe('CUSTOM_IMAGE');
    expect(stored.image_url).toBe('https://cdn.example.com/promo.jpg');

    // update to text only
    stored.media_type = 'NONE';
    stored.image_url = null;
    stored.updated_at = new Date();

    expect(stored.media_type).toBe('NONE');
    expect(stored.image_url).toBeNull();

    // delete
    memoryQuickReplies.delete(id);
    expect(memoryQuickReplies.has(id)).toBe(false);
  });
});
