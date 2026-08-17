import { describe, it, expect } from 'vitest';
import {
  stripNonIndonesianScripts,
  containsForeignScripts,
  sanitizeRagLeakage,
  sanitizeForbiddenEnglishWords,
  sanitizeHallucinatedTerms,
  sanitizeEmDash,
} from '../../src/utils/language-sanitizer';

describe('language-sanitizer (anti bocor aksara asing)', () => {
  it('membuang karakter Mandarin dari tengah kalimat Indonesia', () => {
    const input = 'Boleh tahu大概 lokasinya di mana ya, Bund? Supaya bisa bantu informasikan';
    const out = stripNonIndonesianScripts(input);
    expect(out).not.toContain('大概');
    expect(out).toContain('Boleh tahu');
    expect(out).toContain('lokasinya di mana');
  });

  it('membersihkan Kanji Jepang & Hangul Korea', () => {
    expect(stripNonIndonesianScripts('あいう karena itu にほん')).toBe(' karena itu ');
    expect(stripNonIndonesianScripts('안녕 halo')).toBe(' halo');
  });

  it('membersihkan karakter Cyrillic (Rusia)', () => {
    expect(stripNonIndonesianScripts('привет selamat')).toBe(' selamat');
  });

  it('tidak mengubah teks Indonesia asli (latin + angka + emoji)', () => {
    const clean = 'Halo Bunda, harganya Rp60.000 untuk 40 menit ya 🙏🏻';
    expect(stripNonIndonesianScripts(clean)).toBe(clean);
    expect(containsForeignScripts(clean)).toBe(false);
  });

  it('containsForeignScripts mendeteksi aksara asing', () => {
    expect(containsForeignScripts('lokasi大概')).toBe(true);
    expect(containsForeignScripts('lokasi')).toBe(false);
    expect(containsForeignScripts('')).toBe(false);
    expect(containsForeignScripts(null as any)).toBe(false);
  });

  it('handle null/empty dengan aman', () => {
    expect(stripNonIndonesianScripts('')).toBe('');
    expect(stripNonIndonesianScripts(null as any)).toBeNull();
    expect(stripNonIndonesianScripts(undefined as any)).toBeUndefined();
  });

  it('sanitizeRagLeakage membersihkan frasa bocor RAG', () => {
    expect(sanitizeRagLeakage('Bun.etails info di sini usia 2 minggu ke atas sudah aman.')).toBe('usia 2 minggu ke atas sudah aman.');
    expect(sanitizeRagLeakage('Halo Bunda, details info di sini pijat bayi promo.')).toBe('Halo Bunda, pijat bayi promo.');
    expect(sanitizeRagLeakage('Berdasarkan referensi dokumen di atas, harganya Rp60.000')).toBe('harganya Rp60.000');
  });

  it('sanitizeForbiddenEnglishWords mengganti kata bahasa Inggris terlarang', () => {
    expect(sanitizeForbiddenEnglishWords('little one-nya sudah melewati 2 minggu')).toBe('si kecil sudah melewati 2 minggu');
    expect(sanitizeForbiddenEnglishWords('apabila baby rewel')).toBe('apabila bayi rewel');
    expect(sanitizeForbiddenEnglishWords('mommy bisa booking schedule')).toBe('Bunda bisa booking jadwal');
    expect(sanitizeForbiddenEnglishWords('Boleh infokan jam untuk appointment-nya?')).toBe('Boleh infokan jam untuk jadwal reservasi?');
  });

  it('sanitizeHallucinatedTerms membersihkan istilah aneh seperti antimeminjamkannya dan untuk bund', () => {
    expect(sanitizeHallucinatedTerms('Supaya bisa kami hitung biaya antimeminjamkannya, boleh tahu kira-kira rumahnya di mana?')).toBe('Supaya bisa kami hitung ongkirnya, boleh tahu kira-kira rumahnya di mana?');
    expect(sanitizeHallucinatedTerms('untuk biaya peminjamannya')).toBe('untuk ongkos kirimnya');
    expect(sanitizeHallucinatedTerms('Silakan dipilih waktu yang paling cocok untuk bund.')).toBe('Silakan dipilih waktu yang paling cocok untuk Bunda.');
    expect(sanitizeHallucinatedTerms('Syukur sekali, rumahnya dekat bund.')).toBe('Wah senang sekali, rumahnya dekat bund.');
  });

  it('sanitizeEmDash mengganti em-dash antar klausa dengan koma', () => {
    expect(sanitizeEmDash('Halo—mau tanya soal pijat bayi')).toBe('Halo, mau tanya soal pijat bayi');
    expect(sanitizeEmDash('Kami siap — kapan pun Bunda butuh')).toBe('Kami siap, kapan pun Bunda butuh');
    expect(sanitizeEmDash('Kami siap—kapan pun Bunda butuh')).toBe('Kami siap, kapan pun Bunda butuh');
  });

  it('sanitizeEmDash mengganti em-dash rentang angka dengan hyphen', () => {
    expect(sanitizeEmDash('Buka jam 9—11')).toBe('Buka jam 9-11');
    expect(sanitizeEmDash('Jarak 5—10 km')).toBe('Jarak 5-10 km');
  });

  it('sanitizeEmDash mengganti bullet list di awal baris dengan hyphen', () => {
    expect(sanitizeEmDash('— Gratis ongkir\n— Bidan berlisensi')).toBe('- Gratis ongkir\n- Bidan berlisensi');
    expect(sanitizeEmDash('—Gratis ongkir')).toBe('- Gratis ongkir');
  });

  it('sanitizeEmDash tidak mengubah teks tanpa em-dash', () => {
    const clean = 'Halo Bunda, harganya Rp60.000 ya 😊';
    expect(sanitizeEmDash(clean)).toBe(clean);
    expect(sanitizeEmDash('')).toBe('');
    expect(sanitizeEmDash(null as any)).toBeNull();
    expect(sanitizeEmDash(undefined as any)).toBeUndefined();
  });
});