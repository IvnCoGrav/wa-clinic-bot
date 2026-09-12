import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async (params: any) => ({
      reservation: { id: 'res-audit-1' },
      isNew: true,
      isUpdate: false,
      __captured: params,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import {
  executeSaveReservation,
  resolveTreatmentCategory,
  calcBookedSubtotal,
  hasStreetDetail,
  isGenericCustomerName,
} from '../../src/v3/tools/save-reservation.tool';
import { reservationCoreService } from '../../src/services/reservation-core.service';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { normalizeWhatsAppFormat } from '../../src/utils/whatsapp-format';
import { PersonaPromptBuilder } from '../../src/v3/agent/persona';

/**
 * Rencana Implementasi Perbaikan Fondasional Audit AI Chat & Reservasi Homecare.
 * Offline, tanpa DB (in-memory fallback aktif via tests/setup.ts).
 */
describe('Layer 1 — Kategori dinamis save_reservation (tanpa regex momsCue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-audit-1' }, isNew: true, isUpdate: false,
    } as any);
  });

  it('"Oksitosin Massage Fullbody" → MOMS (bukan BABY)', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Oksitosin Massage Fullbody',
      bookingDate: '2026-09-10',
      gestationalWeeks: 38,
      momStage: 'PREGNANT',
    } as any);
    expect(res.success).toBe(true);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.treatmentCategory).toBe('MOMS');
  });

  it('paket anak → BABY; paket kids → KIDS', () => {
    expect(resolveTreatmentCategory(['Pijat Bayi Ceria'])).toBe('BABY');
    expect(resolveTreatmentCategory(['Pijat Kids Ceria'])).toBe('KIDS');
  });

  it('multi Mom + Baby → BOTH', async () => {
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Oksitosin Massage Fullbody',
      additionalTreatments: ['Pijat Bayi Ceria'],
      bookingDate: '2026-09-10',
      gestationalWeeks: 38,
      children: [{ ageMonths: 2 }],
    } as any);
    expect(res.success).toBe(true);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.treatmentCategory).toBe('BOTH');
  });

  it('purchaseValue tersimpan (subtotal promo, tidak null)', async () => {
    await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Oksitosin Massage Fullbody',
      bookingDate: '2026-09-10',
    } as any);
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    // Promo katalog Oksitosin Massage Fullbody = Rp 105.000
    expect(called.purchaseValue).toBe(105000);
  });

  it('calcBookedSubtotal cocok exact & substring ("oksitosin massage fullbody")', () => {
    const r = calcBookedSubtotal(['Oksitosin Massage Fullbody']);
    expect(r.matched).toBe(1);
    expect(r.subtotalPromo).toBe(105000);
  });
});

describe('Layer 1 — Tanpa penolakan booking (aturan 21: wilayah sesi cukup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reservationCoreService.saveReservation).mockResolvedValue({
      reservation: { id: 'res-audit-1' }, isNew: true, isUpdate: false,
    } as any);
  });

  it('"boleh bund" + lokasi wilayah sesi → TETAP tersimpan + ditampung (confirmed)', async () => {
    await GoalTracker.updateGoalSession('gate-conv-1', {
      genderGreeting: 'Bunda',
      location: { rawText: 'Desa kedungkendo candi sidoarjo' },
    } as any);
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Oksitosin Massage Fullbody',
      bookingDate: 'Sabtu',
      conversationId: 'gate-conv-1',
    } as any);
    expect(res.success).toBe(true);
    expect(res.needsInfo).toBeUndefined();
    expect(res.message).toContain('tampung');
    expect(res.message).toContain('cekkan');
    expect(res.message).not.toContain('nama Bunda dan alamat lengkap');
    expect(res.message).not.toContain('Admin CS');
    const called = vi.mocked(reservationCoreService.saveReservation).mock.calls[0][0] as any;
    expect(called.status).toBe('confirmed');
    expect(String(called.rawText)).toContain('kedungkendo');
  });

  it('tanpa lokasi sama sekali → tetap tersimpan (form yang melengkapi)', async () => {
    await GoalTracker.updateGoalSession('gate-conv-3', { genderGreeting: 'Bunda' } as any);
    const res = await executeSaveReservation({
      customerId: 'cust-1',
      chatId: '6281@c.us',
      treatmentName: 'Pijat Bayi Ceria',
      bookingDate: 'Sabtu',
      conversationId: 'gate-conv-3',
    } as any);
    expect(res.success).toBe(true);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
  });

  it('hasStreetDetail / isGenericCustomerName (util, tidak memblokir)', () => {
    expect(hasStreetDetail('Jl Mawar no 12')).toBe(true);
    expect(hasStreetDetail('Desa kedungkendo candi sidoarjo')).toBe(false);
    expect(hasStreetDetail(undefined)).toBe(false);
    expect(isGenericCustomerName('')).toBe(true);
    expect(isGenericCustomerName('Sandbox Customer')).toBe(true);
    expect(isGenericCustomerName('Bu***')).toBe(true);
    expect(isGenericCustomerName('Rina')).toBe(false);
  });
});

describe('Layer 2 — Substring anti-collision syncCartItems', () => {
  it('"induksi massage fullbody" HANYA mengisi Fullbody (Rp 105.000)', () => {
    const catalog = [
      { name: 'Induksi Massage', promoPrice: 50000, originalPrice: 70000, category: 'MOMS', isAddon: false },
      { name: 'Induksi Massage Fullbody', promoPrice: 105000, originalPrice: 130000, category: 'MOMS', isAddon: false },
    ];
    const cart = GoalTracker.syncCartItems(
      { genderGreeting: 'Bunda', cartItems: [] } as any,
      [{ role: 'user', content: 'Kak, bedanya pregnant massage dengan induksi massage fullbody apa ya ?' }],
      catalog as any
    );
    expect(cart).toHaveLength(1);
    expect(cart[0].name).toBe('Induksi Massage Fullbody');
    expect(cart[0].promoPrice).toBe(105000);
  });
});

describe('Layer 3 — Persona: larangan jam & panduan konfirmasi', () => {
  it('prompt memuat aturan 20 (jam + pertanyaan ganda)', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('DILARANG MENANYAKAN JAM KUNJUNGAN');
    expect(prompt).toContain('DILARANG PERTANYAAN GANDA');
  });

  it('prompt memuat alur konfirmasi homecare (cek jadwal dulu, tanpa todong)', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    expect(prompt).toContain('ALUR KONFIRMASI RESERVASI HOMECARE');
    expect(prompt).toContain('DILARANG MENODONG NAMA/ALAMAT');
    expect(prompt).not.toContain('Boleh kami dibantu nama Bunda dan alamat lengkap rumahnya');
  });

  it('prompt tidak menodong alamat/shareloc dan tidak menyebut Admin CS (kecuali aturan larangan)', () => {
    const prompt = PersonaPromptBuilder.buildSystemPrompt({ genderGreeting: 'Bunda' } as any, true);
    // Audit 337101: contoh baku POV first person (menggantikan frasa lama
    // "ketersediaan jadwal Bidan yang ready").
    expect(prompt).toContain('kami bantu cekkan ketersediaan jadwalnya dulu ya Bunda');
    const adminCsOutsideBan = prompt
      .split('\n')
      .filter((line) => line.includes('Admin CS') && !line.includes('DILARANG SEBUT'));
    expect(adminCsOutsideBan).toEqual([]);
  });
});

describe('Layer 4 — normalizeWhatsAppFormat (** → *)', () => {
  it('bintang ganda terkonversi ke tunggal', () => {
    expect(normalizeWhatsAppFormat('Paket **Pijat Bayi Ceria** promonya **Rp 60.000** ya Bunda'))
      .toBe('Paket *Pijat Bayi Ceria* promonya *Rp 60.000* ya Bunda');
  });

  it('format tunggal tidak berubah', () => {
    const clean = 'Paket *Pijat Bayi Ceria* promonya *Rp 60.000* ya Bunda 😊';
    expect(normalizeWhatsAppFormat(clean)).toBe(clean);
  });
});
