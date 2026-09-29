import { describe, it, expect } from 'vitest';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { ensureStaffSignature, hasStaffSignature } from '../../src/utils/staff-signature';

/**
 * Anti-Sapaan Ganda + Standardisasi Tanda Tangan Staf (OTW & Sudah Sampai).
 *
 * Prinsip pengujian: adversarial & multi-parafrase (bukan happy-path), sesuai
 * Mandat Adversarial & Anti-Overfitting di AGENTS.md.
 *
 * Catatan: DB di-mock offline (tests/setup.ts), sehingga service memakai jalur
 * fallback template deterministik — persis yang diuji di sini.
 */
describe('ensureStaffSignature (helper tunggal, idempoten)', () => {
  it('menyematkan tanda tangan bila belum ada', () => {
    expect(ensureStaffSignature('Halo Bunda', 'Bidan Thabita')).toBe('Halo Bunda\n\n~ Bidan Thabita');
  });

  it('idempoten: tidak menggandakan tanda tangan yang sudah ada', () => {
    const once = ensureStaffSignature('Halo Bunda', 'Bidan Thabita');
    const twice = ensureStaffSignature(once, 'Bidan Thabita');
    expect(twice).toBe(once);
    expect(twice.match(/~ Bidan Thabita/g)?.length).toBe(1);
  });

  it('idempoten meski ada trailing whitespace/newline', () => {
    const text = 'Halo Bunda\n\n~ Bidan Thabita\n\n   ';
    expect(ensureStaffSignature(text, 'Bidan Thabita')).toBe('Halo Bunda\n\n~ Bidan Thabita');
  });

  it('case-insensitive terhadap nama terapis', () => {
    const text = 'Halo Bunda\n\n~ bidan thabita';
    expect(hasStaffSignature(text, 'Bidan Thabita')).toBe(true);
    expect(ensureStaffSignature(text, 'Bidan Thabita')).toBe('Halo Bunda\n\n~ bidan thabita');
  });

  it('aman untuk nama terapis yang mengandung karakter regex', () => {
    const text = 'Halo Bunda\n\n~ Bidan (Ayu)';
    expect(hasStaffSignature(text, 'Bidan (Ayu)')).toBe(true);
    expect(ensureStaffSignature(text, 'Bidan (Ayu)')).toBe('Halo Bunda\n\n~ Bidan (Ayu)');
  });

  it('tidak menyematkan tanda tangan ke teks kosong', () => {
    expect(ensureStaffSignature('', 'Bidan Thabita')).toBe('');
    expect(ensureStaffSignature('   ', 'Bidan Thabita')).toBe('');
  });

  it('mengembalikan teks apa adanya bila nama terapis kosong', () => {
    expect(ensureStaffSignature('Halo Bunda', '')).toBe('Halo Bunda');
  });
});

describe('getOtwMessageText — anti-sapaan ganda "Bunda Bunda" + tanda tangan', () => {
  it('BERSIH: "Bunda suciani" -> "Halo Bunda suciani", bukan "Bunda Bunda"', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: 'Bunda suciani',
      therapistName: 'Bidan Thabita',
    });
    expect(text).toContain('Halo Bunda suciani');
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });

  it('ADVERSARIAL: prefix "ibu SUCiani" tetap menghasilkan sapaan tunggal', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: 'ibu SUCiani',
      therapistName: 'Bidan Thabita',
    });
    expect(text).toContain('Halo Bunda SUCiani');
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });

  it('ADVERSARIAL: nama ber-distrik dibersihkan ("Bunda Hera Semampir")', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: 'Bunda Hera Semampir',
      therapistName: 'Bidan Thabita',
    });
    expect(text).toContain('Halo Bunda Hera');
    expect(text).not.toContain('Semampir');
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
  });

  it('ADVERSARIAL: nama generik "Bunda" saja -> sapaan tidak berulang', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: 'Bunda',
      therapistName: 'Bidan Thabita',
    });
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });

  it('ADVERSARIAL: nama kosong -> fallback "Bunda" tanpa crash', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: '',
      therapistName: 'Bidan Thabita',
    });
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });

  it('tanda tangan idempoten bila template DB sudah memuat ~ nama', async () => {
    const text = await StaffReservationService.getOtwMessageText('default-tenant', {
      patientName: 'Suciani',
      therapistName: 'Bidan Thabita',
    });
    expect(text.match(/~ Bidan Thabita/g)?.length).toBe(1);
  });
});

describe('getArrivalMessageText — tanda tangan + anti-sapaan ganda', () => {
  it('BERSIH: pesan kedatangan selalu diakhiri ~ [Nama Terapis]', async () => {
    const text = await StaffReservationService.getArrivalMessageText('default-tenant', {
      patientName: 'Bunda suciani',
      therapistName: 'Bidan Thabita',
    });
    expect(text).toContain('Halo Bunda suciani');
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });

  it('ADVERSARIAL: nama ber-prefix & ber-distrik tetap bersih + bertanda tangan', async () => {
    const text = await StaffReservationService.getArrivalMessageText('default-tenant', {
      patientName: 'mama Devia Babatan Wiyung',
      therapistName: 'Bidan Ayu',
    });
    expect(text).toContain('Halo Bunda Devia');
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Ayu')).toBe(true);
  });

  it('ADVERSARIAL: nama kosong tidak menyebabkan crash / sapaan ganda', async () => {
    const text = await StaffReservationService.getArrivalMessageText('default-tenant', {
      patientName: '',
      therapistName: 'Bidan Thabita',
    });
    expect(text).not.toMatch(/Bunda\s+Bunda/i);
    expect(text.endsWith('~ Bidan Thabita')).toBe(true);
  });
});
