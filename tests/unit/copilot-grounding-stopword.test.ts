import { describe, it, expect } from 'vitest';
import {
  copilotService,
  repairCopilotChatLinks,
  buildSummarizePrompt,
  INDONESIAN_HONORIFIC_STOPWORDS,
} from '../../src/services/copilot/copilot.service';
import {
  formatCustomerDisplayName,
  isTelecomSpamLine,
  stripCommercialSpam,
  hasTextScheduleSignal,
} from '../../src/services/copilot/copilot-tools';
import { extractTimeHint } from '../../src/v3/agent/pipeline/medical-signal-detector';

describe('AI Copilot Grounding Hardening & Adversarial Tests', () => {
  describe('Fase 2: Grounding Validator (Kapitalisasi + Stopword Guard)', () => {
    const rows = [
      { customerName: 'Bunda Chaterina', conversationId: 'conv-chat' },
      { customerName: 'Cindy Amalia', conversationId: 'conv-cindy' },
    ];

    it('kata verba/fungsi huruf kecil setelah honorifik diabaikan (bukan nama pasien)', () => {
      // Kasus nyata yang sebelumnya gagal di live server
      const answer =
        'Kami paham Bunda menunggu kepastian — segera tindak lanjuti agar tidak kehilangan momen.';
      expect(copilotService.validateGrounding(answer, rows)).toBe(true);
    });

    it('variasi kata verba lowercase di luar list stopword tetap diabaikan via aturan kapitalisasi', () => {
      expect(copilotService.validateGrounding('Bunda sedang di jalan menuju klinik.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda lagi periksa di faskes lain.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda kok belum konfirmasi ya?', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda juga minta jadwal alternatif.', rows)).toBe(true);
    });

    it('kata stopword yang berawalan kapital tetap diabaikan (lapis kedua)', () => {
      expect(copilotService.validateGrounding('Bunda Menunggu kepastian jadwal.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda Untuk konfirmasi jadwal jam 09.00.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda Sedang mempertimbangkan paket.', rows)).toBe(true);
    });

    it('TRUE-POSITIVE: nama fiktif kapital yang TIDAK ada di data tool WAJIB terdeteksi sebagai ungrounded (false)', () => {
      // Bunda Fiktif tidak ada di rows (rows hanya Chaterina & Cindy)
      expect(copilotService.validateGrounding('Prioritas hubungi Bunda Fiktif besok.', rows)).toBe(false);
      expect(copilotService.validateGrounding('Nama Pasien: Siti Rahma', rows)).toBe(false);
      expect(copilotService.validateGrounding('Nama Pasien **Dewi Lestari**', rows)).toBe(false);
    });

    it('nama pasien sah di data tool ter-grounding dengan benar', () => {
      expect(copilotService.validateGrounding('Prioritas hubungi Bunda Chaterina jam 09.00.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Hubungi Cindy Amalia untuk konfirmasi.', rows)).toBe(true);
      expect(copilotService.validateGrounding('Bunda Chaterina dan Cindy siap dijadwalkan.', rows)).toBe(true);
    });
  });

  describe('Fase 1: Deterministic Live Chat Link Injection', () => {
    const rows = [
      { customerName: 'Bunda Chaterina', rawCustomerName: 'Chaterina', conversationId: 'conv-chat-123' },
      { customerName: 'Cindy Amalia', rawCustomerName: 'Cindy Amalia', conversationId: 'conv-cindy-456' },
      { customerName: 'Bunda (0812****0185)', rawCustomerName: 'aguspurnomo68301', conversationId: 'conv-agus-789' },
    ];

    it('menginjeksi tautan pada format bullet (-) yang belum punya link', () => {
      const text =
        '- Bunda Chaterina — Pijat Kids Ceria, minta sabtu, sudah ditawari jam 09.00.\n' +
        '- Cindy Amalia — pesan terakhir "Baik, terimakasih kak".';

      const result = repairCopilotChatLinks(text, rows);
      expect(result).toContain('[Buka Chat](/admin/live-chat?conversationId=conv-chat-123)');
      expect(result).toContain('[Buka Chat](/admin/live-chat?conversationId=conv-cindy-456)');
      // Assert: jumlah link = jumlah baris pasien unik yang match
      const linkMatches = result.match(/\[Buka Chat\]\(\/admin\/live-chat\?conversationId=[^)]+\)/g) || [];
      expect(linkMatches.length).toBe(2);
    });

    it('menginjeksi tautan pada format tabel markdown (|)', () => {
      const table =
        '| Pasien | Treatment | Jadwal |\n' +
        '|---|---|---|\n' +
        '| Bunda Chaterina | Pijat Kids | Sabtu 09.00 |\n' +
        '| Cindy Amalia | Mandi Ceria | Minggu 10.00 |';

      const result = repairCopilotChatLinks(table, rows);
      expect(result).toContain('conv-chat-123');
      expect(result).toContain('conv-cindy-456');
      // Format tabel tetap valid markdown
      expect(result).toMatch(/\|.*\[Buka Chat\]\(.*conv-chat-123\)\s*\|/);
    });

    it('word-boundary guard: token "ayu" tidak match "layu", "sari" tidak match "kasir"', () => {
      const trickyRows = [
        { customerName: 'Bunda Ayu', conversationId: 'conv-ayu' },
        { customerName: 'Ibu Sari', conversationId: 'conv-sari' },
      ];
      const text =
        '- Pasien mengeluh tanaman layu di depan rumah.\n' +
        '- Kasir klinik sedang merekap kas harian.';

      const result = repairCopilotChatLinks(text, trickyRows);
      expect(result).not.toContain('conv-ayu');
      expect(result).not.toContain('conv-sari');
      expect(result).toBe(text);
    });

    it('sanitasi conversationId: id dengan karakter berbahaya diabaikan', () => {
      const dirtyRows = [
        { customerName: 'Bunda Chaterina', conversationId: 'conv-123) [evil](http://bad.com' },
      ];
      const text = '- Bunda Chaterina — menunggu konfirmasi.';
      const result = repairCopilotChatLinks(text, dirtyRows);
      expect(result).not.toContain('http://bad.com');
      expect(result).toBe(text);
    });

    it('mengaitkan akun masked telepon (0812****0185) via rawCustomerName atau token telepon', () => {
      const text = '- aguspurnomo68301 — pesan terakhir "Baik kak".';
      const result = repairCopilotChatLinks(text, rows);
      expect(result).toContain('conv-agus-789');

      const text2 = '- Bunda (0812****0185) — pesan terakhir "Baik kak".';
      const result2 = repairCopilotChatLinks(text2, rows);
      expect(result2).toContain('conv-agus-789');
    });

    it('tidak menggandakan link jika baris sudah memuat link live-chat', () => {
      const text = '- Bunda Chaterina [Buka Chat](/admin/live-chat?conversationId=conv-chat-123)';
      const result = repairCopilotChatLinks(text, rows);
      const matches = result.match(/conv-chat-123/g) || [];
      expect(matches.length).toBe(1);
    });
  });

  describe('Fase 3: Persona Hygiene & Customer Display Name Masking', () => {
    it('nama normal tidak ditempeli masked phone', () => {
      const res = formatCustomerDisplayName('Chaterina', '081234567890');
      expect(res.displayName).toBe('Chaterina');
      expect(res.rawName).toBe('Chaterina');

      const res2 = formatCustomerDisplayName('Cindy Amalia', '081234567890');
      expect(res2.displayName).toBe('Cindy Amalia');

      const res3 = formatCustomerDisplayName('Bunda Megga', '081234567890');
      expect(res3.displayName).toBe('Bunda Megga');
    });

    it('username sistem dengan angka atau underscore disamarkan menjadi Bunda (<masked_phone>)', () => {
      const res = formatCustomerDisplayName('aguspurnomo68301', '081234567890');
      expect(res.displayName).toContain('Bunda (');
      expect(res.displayName).toContain('****');
      expect(res.rawName).toBe('aguspurnomo68301');

      const res2 = formatCustomerDisplayName('user_dev_01', '081234567890');
      expect(res2.displayName).toContain('Bunda (');
      expect(res2.rawName).toBe('user_dev_01');
    });

    it('nama kosong atau hanya honorifik "Bunda" disamarkan dengan masked phone', () => {
      const res = formatCustomerDisplayName('Bunda', '081234567890');
      expect(res.displayName).toMatch(/^Bunda \(\d{4}\*{4}\d{3,4}\)$/);
      expect(res.rawName).toBe('Bunda');

      const res2 = formatCustomerDisplayName('', '081234567890');
      expect(res2.displayName).toMatch(/^Bunda \(\d{4}\*{4}\d{3,4}\)$/);
    });

    it('buildSummarizePrompt menyertakan klausul preseden PANDUAN dan larangan panggil Bunda ke Admin', () => {
      const prompt = buildSummarizePrompt('cek jadwal', '[]', 'ramah');
      expect(prompt).toContain('Aturan PANDUAN di bawah mengalahkan instruksi Gaya apapun');
      expect(prompt).toContain('DILARANG memanggil admin dengan sapaan "Bunda"');
      expect(prompt).toContain('Kamu berbicara KEPADA ADMIN INTERNAL KLINIK');
    });
  });

  describe('Fase 4: Spam Filter & Schedule Signal Hardening', () => {
    it('mendeteksi broadcast spam operator dan tidak salah blokir layanan klinik', () => {
      expect(isTelecomSpamLine('SimpelRoam IM3 beli kuota sekarang')).toBe(true);
      expect(isTelecomSpamLine('Paket data Telkomsel hemat hingga 50GB')).toBe(true);
      expect(isTelecomSpamLine('Promo XL Axiata roaming murah')).toBe(true);

      // Layanan klinik TIDAK BOLEH diblokir
      expect(isTelecomSpamLine('Paket persalinan normal berapa ya?')).toBe(false);
      expect(isTelecomSpamLine('Ada voucher pijat bayi atau anak?')).toBe(false);
      expect(isTelecomSpamLine('Bisa booking paket nifas besok?')).toBe(false);
      expect(isTelecomSpamLine('Mau periksa USG kandungan')).toBe(false);
    });

    it('stripCommercialSpam: membuang baris spam dan mempertahankan pertanyaan pasien', () => {
      const mixed =
        'SimpelRoam IM3 kuota roaming murah\n' +
        'Halo mbak mau tanya jadwal pijat besok bisa?';
      const cleaned = stripCommercialSpam(mixed);
      expect(cleaned).not.toContain('SimpelRoam');
      expect(cleaned).toContain('Halo mbak mau tanya jadwal pijat besok bisa?');

      const pureSpam = 'SimpelRoam IM3 kuota roaming murah';
      expect(stripCommercialSpam(pureSpam)).toBe('');
    });

    it('extractTimeHint: "sekarang" hanya sah jika ada konteks jadwal/layanan klinik', () => {
      // Spam / obrolan kasual tanpa konteks jadwal -> null
      expect(extractTimeHint('beli kuota sekarang')).toBeNull();
      expect(extractTimeHint('sekarang lagi di jalan mbak')).toBeNull();
      expect(extractTimeHint('masih kerja sekarang')).toBeNull();

      // Permintaan jadwal konkret dengan kata "sekarang" -> sah 'sekarang'
      expect(extractTimeHint('bisa sekarang ya kak?')).toBe('sekarang');
      expect(extractTimeHint('ada slot pijat sekarang?')).toBe('sekarang');
      expect(extractTimeHint('bisa reservasi sekarang?')).toBe('sekarang');

      // Kata hari lain tetap berfungsi normal
      expect(extractTimeHint('besok jam 10 pagi')).toBe('besok');
      expect(extractTimeHint('bisa sabtu ini?')).toBe('sabtu');
    });

    it('hasTextScheduleSignal mengabaikan broadcast spam murni', () => {
      expect(hasTextScheduleSignal('SimpelRoam IM3 beli kuota sekarang')).toBe(false);
      expect(hasTextScheduleSignal('Paket data roaming Telkomsel')).toBe(false);
      expect(hasTextScheduleSignal('Bisa pijat bayi besok jam 10?')).toBe(true);
    });
  });
});
