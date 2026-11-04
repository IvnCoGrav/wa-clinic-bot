import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import {
  normalizeShortcut,
  isValidShortcut,
  extToMime,
  isDeliverableMediaRef,
  renderBankAccounts,
  resolveQuickReplyMedia,
  initMemoryDefaults,
  DEFAULT_QUICK_REPLIES,
  ONGKIR_QUICK_REPLIES,
  memoryQuickReplies,
  memoryInitializedTenants,
  isDatabaseOfflineError,
} from '../../src/routes/admin/quick-replies.subroute';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import * as pricelistConfigService from '../../src/services/pricelist-config.service';
import { cleanBundaName } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { prisma } from '../../src/db/client';
import { buildApp } from '../../src/app';

describe('Quick Replies - Helpers, In-Memory Store & SSOT Media Resolution', () => {
  beforeEach(() => {
    memoryQuickReplies.clear();
    memoryInitializedTenants.clear();
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

  it('isDatabaseOfflineError detects offline errors accurately', () => {
    expect(isDatabaseOfflineError(new Error('Database offline'))).toBe(true);
    expect(isDatabaseOfflineError(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
    expect(isDatabaseOfflineError({ code: 'P1000' })).toBe(true);
    expect(isDatabaseOfflineError({ code: 'P1001', message: 'Can not reach database server' })).toBe(true);
    expect(isDatabaseOfflineError({ code: 'P1002' })).toBe(true);
    expect(isDatabaseOfflineError({ code: 'P1008' })).toBe(true);
    expect(isDatabaseOfflineError({ code: 'P1017' })).toBe(true);
    expect(isDatabaseOfflineError(new Error('Unique constraint failed'))).toBe(false);
    expect(isDatabaseOfflineError(null)).toBe(false);
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

  it('resolveQuickReplyMedia: universal resolution of {bank_accounts} preserving raw content (D-1)', async () => {
    const textRow = {
      id: 'qr-text-bank',
      shortcut: 'rekening',
      title: 'Rekening Resmi Saja',
      content: 'Halo Bunda {name} ✨\n\nTransfer ke:\n{bank_accounts}\n\nPetunjuk:\n{petunjuk}',
      media_type: 'NONE',
      image_url: null,
    };

    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValueOnce({
      qrisImageUrl: null,
      bankAccounts: [{ bank: 'BCA', accountNumber: '777888999', accountName: 'Kala Spa Text' }],
      instructions: 'Konfirmasi setelah transfer ya Bunda',
    });

    const resolved = await resolveQuickReplyMedia(textRow, DEFAULT_TENANT_ID);
    expect(resolved.image_url).toBeNull();
    expect(resolved.media_type).toBe('NONE');
    // D-1: content mentah wajib dipertahankan untuk form editor admin
    expect(resolved.content).toBe(textRow.content);
    expect(resolved.content).toContain('{bank_accounts}');
    // resolved_content berisi rincian rekening untuk live chat
    expect(resolved.resolved_content).toContain('777888999');
    expect(resolved.resolved_content).toContain('Konfirmasi setelah transfer ya Bunda');
  });

  it('resolveQuickReplyMedia: reuses cachedPaymentInfo without querying getPaymentInfo repeatedly (anti N+1)', async () => {
    const row = {
      id: 'qr-cached',
      shortcut: 'qris',
      title: 'QRIS',
      content: 'Rekening:\n{bank_accounts}',
      media_type: 'QRIS',
      image_url: null,
    };

    const spy = vi.spyOn(StaffReservationService, 'getPaymentInfo');
    const cachedInfo = {
      qrisImageUrl: 'https://cdn.example.com/cached-qris.png',
      bankAccounts: [{ bank: 'BCA', accountNumber: '1234', accountName: 'Kala' }],
      instructions: 'Transfer segera',
    };

    const resolved = await resolveQuickReplyMedia(row, DEFAULT_TENANT_ID, cachedInfo);
    expect(spy).not.toHaveBeenCalled();
    expect(resolved.image_url).toBe('https://cdn.example.com/cached-qris.png');
    expect(resolved.content).toBe(row.content);
    expect(resolved.resolved_content).toContain('1234');
  });

  it('initMemoryDefaults: idempotent and does not resurrect deleted templates after initial seed (anti-zombie)', () => {
    initMemoryDefaults(DEFAULT_TENANT_ID);
    expect(memoryQuickReplies.size).toBeGreaterThan(0);

    // Hapus salah satu template default (misal /ongkir1)
    const o1Id = `mem_qr_${DEFAULT_TENANT_ID}_ongkir1`;
    expect(memoryQuickReplies.has(o1Id)).toBe(true);
    memoryQuickReplies.delete(o1Id);
    expect(memoryQuickReplies.has(o1Id)).toBe(false);

    // Panggil initMemoryDefaults lagi (seperti saat GET berikutnya)
    initMemoryDefaults(DEFAULT_TENANT_ID);
    // Template /ongkir1 TIDAK boleh bangkit kembali
    expect(memoryQuickReplies.has(o1Id)).toBe(false);
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
    // D-1: content tetap mentah agar form edit admin tidak merusak placeholder di DB
    expect(resolvedA.content).toBe(qrisRow.content);
    expect(resolvedA.resolved_content).toContain('11112222');
    expect(resolvedA.resolved_content).toContain('Transfer sebelum jam 17.00 WIB');

    // Skenario 2: paymentInfo diubah ke Rekening B -> response otomatis berubah dinamis
    vi.spyOn(StaffReservationService, 'getPaymentInfo').mockResolvedValueOnce({
      qrisImageUrl: 'https://cdn.example.com/qris-klinik-v2.webp',
      bankAccounts: [{ bank: 'BSI', accountNumber: '55556666', accountName: 'Kala Moms B' }],
      instructions: 'Cantumkan nama pasien di berita transfer',
    });

    const resolvedB = await resolveQuickReplyMedia(qrisRow, DEFAULT_TENANT_ID);
    expect(resolvedB.image_url).toBe('https://cdn.example.com/qris-klinik-v2.webp');
    expect(resolvedB.mime_type).toBe('image/webp');
    expect(resolvedB.content).toBe(qrisRow.content);
    expect(resolvedB.resolved_content).toContain('55556666');
    expect(resolvedB.resolved_content).not.toContain('11112222');
    expect(resolvedB.resolved_content).toContain('Cantumkan nama pasien di berita transfer');
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
    expect(resolved.content).toBe(qrisRow.content);
    expect(resolved.resolved_content).toContain('-'); // Placeholder bank & petunjuk diisi '-'
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

  it('DEFAULT_QUICK_REPLIES contains /pricelist and uses PRICELIST media_type', () => {
    const shortcuts = DEFAULT_QUICK_REPLIES.map((r) => r.shortcut);
    expect(shortcuts).toContain('pricelist');

    const item = DEFAULT_QUICK_REPLIES.find((r) => r.shortcut === 'pricelist')!;
    expect(item.media_type).toBe('PRICELIST');
    expect(item.image_url).toBeNull();
    expect(item.content).toContain('Berikut pricelist');
  });

  it('isDeliverableMediaRef validates media reference deliverability', () => {
    expect(isDeliverableMediaRef('/media/outbound/tenant/brosur.jpg')).toBe(true);
    expect(isDeliverableMediaRef('https://cdn.example.com/pricelist.png')).toBe(true);
    expect(isDeliverableMediaRef('http://cdn.example.com/pricelist.png')).toBe(true);
    expect(isDeliverableMediaRef('assets/pricelist_spa.jpg')).toBe(false);
    expect(isDeliverableMediaRef('relative/local/path.png')).toBe(false);
    expect(isDeliverableMediaRef(null)).toBe(false);
    expect(isDeliverableMediaRef(undefined)).toBe(false);
    expect(isDeliverableMediaRef('')).toBe(false);
  });

  it('resolveQuickReplyMedia: PRICELIST dynamic SSOT resolution', async () => {
    const row = {
      id: 'qr-pl-1',
      shortcut: 'pricelist',
      title: 'Pricelist',
      content: 'Pricelist kami',
      media_type: 'PRICELIST',
      image_url: null,
    };

    // (a) Spy getPricelistImageUrl -> outbound deliverable URL => image_url resolved
    vi.spyOn(pricelistConfigService, 'getPricelistImageUrl').mockResolvedValueOnce(
      '/media/outbound/default-tenant/pricelist.jpg'
    );
    const resolvedA = await resolveQuickReplyMedia(row, DEFAULT_TENANT_ID);
    expect(resolvedA.image_url).toBe('/media/outbound/default-tenant/pricelist.jpg');
    expect(resolvedA.mime_type).toBe('image/jpeg');

    // (b) Spy getPricelistImageUrl -> assets/pricelist_spa.jpg (fallback lokal) => image_url null
    vi.spyOn(pricelistConfigService, 'getPricelistImageUrl').mockResolvedValueOnce(
      'assets/pricelist_spa.jpg'
    );
    const resolvedB = await resolveQuickReplyMedia(row, DEFAULT_TENANT_ID);
    expect(resolvedB.image_url).toBeNull();
    expect(resolvedB.mime_type).toBeUndefined();

    // (c) Spy throw => image_url null tanpa crash
    vi.spyOn(pricelistConfigService, 'getPricelistImageUrl').mockRejectedValueOnce(
      new Error('DB failure')
    );
    const resolvedC = await resolveQuickReplyMedia(row, DEFAULT_TENANT_ID);
    expect(resolvedC.image_url).toBeNull();
    expect(resolvedC.mime_type).toBeUndefined();
  });

  it('ONGKIR_QUICK_REPLIES: defines 25 valid quick replies matching delivery tiers', () => {
    expect(ONGKIR_QUICK_REPLIES).toHaveLength(25);

    // Semua shortcut harus valid dan berkategori Lokasi
    for (const qr of ONGKIR_QUICK_REPLIES) {
      expect(isValidShortcut(qr.shortcut)).toBeNull();
      expect(qr.category).toBe('Lokasi');
      expect(qr.media_type).toBe('NONE');
      expect(qr.content).toContain('Mau pilih treatment apa bund?');
    }

    // Cek tier batas 1-5 km: Free ongkir
    const o1 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir1');
    const o5 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir5');
    expect(o1?.content).toContain('GRATIS ongkir (Free Ongkir)');
    expect(o5?.content).toContain('GRATIS ongkir (Free Ongkir)');
    expect(o1?.title).toBe('Ongkir 1 km  Gratis');

    // Cek tier 6-7 km: Rp 5.000
    const o6 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir6');
    const o7 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir7');
    expect(o6?.content).toContain('ongkir menjadi 5.000 saja');
    expect(o7?.content).toContain('ongkir menjadi 5.000 saja');
    expect(o6?.title).toBe('Ongkir 6 km  Rp 5.000');

    // Cek tier 8-10 km: Rp 10.000
    const o8 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir8');
    const o10 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir10');
    expect(o8?.content).toContain('ongkir menjadi 10.000 saja');
    expect(o10?.content).toContain('ongkir menjadi 10.000 saja');
    expect(o10?.title).toBe('Ongkir 10 km  Rp 10.000');

    // Cek tier 11-15 km: Rp 15.000
    const o11 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir11');
    const o15 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir15');
    expect(o11?.content).toContain('ongkir menjadi 15.000 saja');
    expect(o15?.content).toContain('ongkir menjadi 15.000 saja');
    expect(o15?.title).toBe('Ongkir 15 km  Rp 15.000');

    // Cek tier 16-20 km: Rp 20.000
    const o16 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir16');
    const o20 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir20');
    expect(o16?.content).toContain('ongkir menjadi 20.000 saja');
    expect(o20?.content).toContain('ongkir menjadi 20.000 saja');
    expect(o20?.title).toBe('Ongkir 20 km  Rp 20.000');

    // Cek tier 21-25 km: Rp 25.000
    const o21 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir21');
    const o25 = ONGKIR_QUICK_REPLIES.find((q) => q.shortcut === 'ongkir25');
    expect(o21?.content).toContain('ongkir menjadi 25.000 saja');
    expect(o25?.content).toContain('ongkir menjadi 25.000 saja');
    expect(o25?.title).toBe('Ongkir 25 km  Rp 25.000');

    // Verifikasi bahwa DEFAULT_QUICK_REPLIES memuat seluruh ONGKIR_QUICK_REPLIES
    for (let i = 1; i <= 25; i++) {
      expect(DEFAULT_QUICK_REPLIES.some((d) => d.shortcut === `ongkir${i}`)).toBe(true);
    }
  });

  it('cleanBundaName: removes solitary "Bunda" or "bunda" without trailing space (D-5)', () => {
    expect(cleanBundaName('Bunda')).toBe('');
    expect(cleanBundaName('bunda')).toBe('');
    expect(cleanBundaName('Ibu')).toBe('');
    expect(cleanBundaName('Bunda Siti')).toBe('Siti');
    expect(cleanBundaName('Siti')).toBe('Siti');
    expect(cleanBundaName('')).toBe('');
    expect(cleanBundaName(null)).toBe('');
  });
});

describe('PostgreSQL Database Path - Anti-Zombie & First Seed Branching (D-2)', () => {
  const ADMIN_KEY = 'test_admin_key_pg_path';
  let app: ReturnType<typeof buildApp>;

  beforeAll(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    app = buildApp();
  });

  it('GET /api/admin/quick-replies: does NOT call upsert when rows are empty but tenant was already seeded (anti-zombie)', async () => {
    // Stub findMany returning empty array
    vi.mocked((prisma as any).quickReply.findMany).mockResolvedValueOnce([]);
    // Stub tenant having quickRepliesSeeded: true
    vi.mocked((prisma as any).tenant.findUnique).mockResolvedValueOnce({
      settings: { quickRepliesSeeded: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    // Crucial: upsert MUST NOT be called!
    expect((prisma as any).quickReply.upsert).not.toHaveBeenCalled();
  });

  it('GET /api/admin/quick-replies: calls upsert and updates tenant settings when tenant is newly unseeded', async () => {
    // 1st findMany returns empty array, 2nd findMany returns newly seeded item
    vi.mocked((prisma as any).quickReply.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'qr-pg-seeded',
          shortcut: 'qris',
          title: 'QRIS',
          content: 'Barcode QRIS',
          category: 'Pembayaran',
          media_type: 'QRIS',
          image_url: null,
        },
      ]);
    // Stub unseeded tenant
    vi.mocked((prisma as any).tenant.findUnique).mockResolvedValue({
      settings: {},
    });
    vi.mocked((prisma as any).quickReply.upsert).mockResolvedValue({} as any);
    vi.mocked((prisma as any).tenant.update).mockResolvedValue({} as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/quick-replies',
      headers: {
        'x-api-key': ADMIN_KEY,
        'x-tenant-id': DEFAULT_TENANT_ID,
      },
    });

    expect(res.statusCode).toBe(200);
    expect((prisma as any).quickReply.upsert).toHaveBeenCalled();
    expect((prisma as any).tenant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({ quickRepliesSeeded: true }),
        }),
      })
    );
  });
});

