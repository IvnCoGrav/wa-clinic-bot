import { describe, it, expect } from 'vitest';
import { V3ConversationSummarizer } from '../../../src/v3/state/conversation-summarizer';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';

/**
 * Fondasional Sesi 640820 — Composite Location-Fee Routing
 * Menguji netralisasi pre-emptive intent hijacking: jawaban lokasi gabungan
 * "bngurasi berapa kak" tidak lagi dicoret & dipaksa ke katalog harga.
 * Mandat Anti-Overfitting: varian parafrase nyata, bukan hafalan verbatim 3 string.
 */
describe('Composite Location-Fee Routing — Sesi 640820 fondasional', () => {
  const historyAskLocation = [{ role: 'assistant', content: 'Kalau boleh tahu rumahnya di daerah mana ya Bunda?' }] as any;
  const historyNeutral = [{ role: 'assistant', content: 'Ada yang bisa kami bantu?' }] as any;
  const emptySession = { location: {}, priceDiscussed: false } as any;

  const assertNotPriceLocked = (input: string, history: any) => {
    const out = V3ConversationSummarizer.summarize(emptySession, input, { history, customerInput: input });
    // Tidak boleh terkunci kaku ke "tarif promo paket"
    expect(out).not.toContain('Sebutkan tarif promo paket yang relevan secara jelas');
    // Jika komposit lokasi: harus menginfokan daerah atau merespons lokasi, bukan tarif murni
    expect(out).toMatch(/menginfokan daerah|merespons pertanyaan lokasi/);
    // Tidak boleh ada larangan alamat yang keliru
    expect(out).not.toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
  };

  const assertPriceBranch = (input: string, history: any) => {
    const out = V3ConversationSummarizer.summarize(emptySession, input, { history, customerInput: input });
    expect(out).toContain('menanyakan biaya / tarif');
    // Pure price tidak boleh dianggap lokasi
    expect(out).not.toContain('menginfokan daerah tempat tinggal');
    expect(out).not.toContain('merespons pertanyaan lokasi atau menanyakan jangkauan');
  };

  it('komposit typo/singkatan + tanya biaya → deteksi lokasi, bukan tarif kaku', () => {
    const composites = [
      'bngurasi berapa kak',
      'bngurasi berapa ya kak',
      'bngurasi brp kak',
      'bngurasi ongkir berapa',
      'bungurasih berapa kak',
      'bungurasih brp ya',
      'wedoro brp ya',
      'wedoro berapa kak',
      'rungkut brp ya',
      'rungkut berapa ongkirnya',
      'wdro kak',
      'kenjeran berapa kak',
    ];
    for (const input of composites) {
      assertNotPriceLocked(input, historyAskLocation);
    }
  });

  it('komposit dengan variasi filler/partikel tetap lokasi', () => {
    const variants = [
      'bngurasi berapa ya',
      'bngurasi brp dong kak',
      'wedoro brp ya kak',
      'rungkut berapa kak ya',
    ];
    for (const input of variants) {
      assertNotPriceLocked(input, historyAskLocation);
    }
  });

  it('pure tanya harga tanpa token lokasi → tetap cabang tarif (kontrol negatif)', () => {
    const purePrice = [
      'berapa',
      'berapa kak',
      'harganya berapa?',
      'harga berapa ya kak',
      'tarifnya berapa',
      'biayanya brp',
      'ongkirnya berapa',
      'berapa biaya pijatnya',
    ];
    for (const input of purePrice) {
      // Dengan konteks tanya lokasi, pure price tanpa token lokasi tetap tarif (fiksasi lokasi fee composite butuh token lokasi)
      // Kami uji dengan historyAskLocation: pure price sekarang harus tetap tarif karena tidak ada token lokasi
      assertPriceBranch(input, historyAskLocation);
      // Tanpa konteks tanya lokasi juga tarif
      assertPriceBranch(input, historyNeutral);
    }
  });

  it('tanpa konteks tanya lokasi, "bngurasi berapa kak" tetap tidak memicu larangan alamat', () => {
    // Jika bot tidak baru tanya domisili, komposit tetap tidak boleh memicu tarif kaku yang salah
    // Tapi sedangDibahas pure price-lokasi tidak dipaksa "merespons lokasi" — cukup tidak terkunci promo paket
    const out = V3ConversationSummarizer.summarize(emptySession, 'bngurasi berapa kak', { history: historyNeutral, customerInput: 'bngurasi berapa kak' });
    // Tanpa askedLocationRecently, cabang tarif-lokasi tidak aktif, tapi isLikelyLocationAnswer masih true → menginfokan daerah
    // Ini acceptable fondasional: token lokasi dikenali sebagai jawaban domisili
    expect(out).not.toContain('Menanyakan alamat/kelurahan rumah Bunda lagi');
  });

  it('pertanyaan non-lokasi non-harga tetap tidak terkontaminasi', () => {
    const other = 'pijat bayi 1 bulan bisa kak?';
    const out = V3ConversationSummarizer.summarize(emptySession, other, { history: historyAskLocation, customerInput: other });
    // Mengandung ? dan kata jadwal/pijat → bukan lokasi
    expect(out).not.toContain('menginfokan daerah tempat tinggal (masih berupa kota/wilayah luas)');
  });

  // Sanitizer koma yatim — fondasional Layer 4
  it('sanitizer: "ya, ☺️" ternormalisasi deterministik', () => {
    const input = 'jadi layanan kami GRATIS ongkir ya, ☺️ Rencana mau ambil apa?';
    const out = OutputSanitizer.cleanOutboundReply(input, 'halo', true);
    expect(out).toBe('jadi layanan kami GRATIS ongkir ya ☺️ Rencana mau ambil apa?');
    expect(out).not.toContain('ya, ☺️');
  });

  it('sanitizer adversarial: koma yatim dengan multi-spasi & varian emoji', () => {
    const cases: Array<[string, string]> = [
      ['halo ya, 😊 apa kabar', 'halo ya 😊 apa kabar'],
      ['oke ya,  ☺️ lanjut', 'oke ya ☺️ lanjut'],
    ];
    for (const [input, expectedContains] of cases) {
      const out = OutputSanitizer.cleanOutboundReply(input, 'x', true);
      expect(out).toContain(expectedContains.split(' ')[1]); // emoji part
      expect(out).not.toMatch(/,\s*[\p{Extended_Pictographic}]/u);
    }
  });
});
