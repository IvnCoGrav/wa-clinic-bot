/**
 * anaphora-state-gate.test.ts — Ketahanan rujukan anaphora (Fase 4).
 *
 * Akar (anti-overfitting): `hasBookingCommitSignal` lama memakai daftar frasa
 * `includes()` literal ("mau yang tadi", "yang tadi aja", ...). Gaya bahasa
 * nyata — singkatan ("yg td aja"), typo ("tdi"), dan parafrasa
 * ("yang direkomendasikan tadi") — LOLOS, sehingga keranjang kosong & booking
 * deadlock. Perbaikan: deteksi KELAS deiksis (rujukan) token-exact + verba
 * afirmasi + partikel, dengan normalisasi slang umum — bukan tambah kalimat.
 *
 * Prinsip Adversarial (MANDATORY): parafrase & slang nyata, bukan verbatim.
 */
import { describe, it, expect } from 'vitest';
import { hasBookingCommitSignal } from '../../../src/utils/date-confirmation';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { treatmentCatalogService } from '../../../src/services/treatment-catalog.service';

describe('hasBookingCommitSignal — kelas deiksis tahan slang/typo (Fase 4)', () => {
  it('singkatan & typo rujukan terdeteksi', () => {
    expect(hasBookingCommitSignal('yg td aja')).toBe(true);
    expect(hasBookingCommitSignal('yg tdi aja bubid')).toBe(true);
    expect(hasBookingCommitSignal('yg tadi aja')).toBe(true);
    expect(hasBookingCommitSignal('yang td deh')).toBe(true);
  });

  it('parafrasa rujukan + verba afirmasi terdeteksi', () => {
    expect(hasBookingCommitSignal('yang direkomendasikan tadi')).toBe(true);
    expect(hasBookingCommitSignal('yang tadi aja bubid')).toBe(true);
    expect(hasBookingCommitSignal('ambil yg barusan ya')).toBe(true);
  });

  it('anti-regresi: frasa eksplisit lama tetap benar', () => {
    expect(hasBookingCommitSignal('mau yang tadi')).toBe(true);
    expect(hasBookingCommitSignal('yang tadi aja')).toBe(true);
    expect(hasBookingCommitSignal('sesuai rekomendasi')).toBe(true);
    expect(hasBookingCommitSignal('boleh deh yang itu')).toBe(true);
  });

  it('anti-regresi: rujukan TANPA afirmasi/partikel tetap BUKAN komitmen', () => {
    expect(hasBookingCommitSignal('yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('yang itu')).toBe(false);
    expect(hasBookingCommitSignal('batal yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('jangan yang tadi')).toBe(false);
    expect(hasBookingCommitSignal('pikir dulu yang tadi')).toBe(false);
  });

  it('anti-regresi: ack netral & pertanyaan bukan komitmen', () => {
    expect(hasBookingCommitSignal('oke')).toBe(false);
    expect(hasBookingCommitSignal('siap')).toBe(false);
    expect(hasBookingCommitSignal('kalau yang pulih ceria itu?')).toBe(false);
  });
});

describe('Anaphora → keranjang (deadlock terputus)', () => {
  const catalog = treatmentCatalogService.getAllServices(true).map((s) => ({
    id: (s as any).id,
    name: s.name,
    promoPrice: s.promoPrice,
    originalPrice: s.originalPrice,
    category: s.category,
    isAddon: (treatmentCatalogService as any).isAddonService(s),
  }));
  const offeredName = treatmentCatalogService.getAllServices(true)
    .find((s) => /pulih ceria/i.test(s.name))!.name;

  it('"yg td aja bubid" atas tawaran tunggal → keranjang terisi (bukan deadlock)', () => {
    const history = [
      { role: 'user', content: 'anak batuk pilek' },
      { role: 'assistant', content: `Bisa dibantu dengan *${offeredName}* ya Bunda` },
      { role: 'user', content: 'yg td aja bubid' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog);
    expect(cart.length).toBe(1);
    expect(cart[0].name).toContain('Pulih Ceria');
  });

  it('anti-regresi: multi-tawaran + "boleh deh yang itu" tetap kosong (klarifikasi)', () => {
    const history = [
      { role: 'assistant', content: 'Ada *Kala Baby – Pijat Ceria* atau *Kala Baby – Pijat Lahap* ya' },
      { role: 'user', content: 'boleh deh yang itu' },
    ];
    const cart = GoalTracker.syncCartItems({ cartItems: [] } as any, history, catalog);
    expect(cart.length).toBe(0);
  });
});
