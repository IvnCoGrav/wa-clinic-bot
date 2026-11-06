import { describe, it, expect } from 'vitest';
import { validateQuickReplyContent } from '../../src/routes/admin/quick-replies.subroute';

/**
 * Gerbang kode deterministik untuk data bisnis (audit C-004):
 * template Quick Reply pre-booking tidak boleh mengajak shareloc.
 */
describe('validateQuickReplyContent — lint template Quick Reply', () => {
  it('menolak template shareloct lama (kategori Umum)', () => {
    const err = validateQuickReplyContent(
      'Oh ya boleh izin kirim sharelock nya bund untuk titik pastinya 🙏😊',
      'Umum'
    );
    expect(err).toBeTruthy();
    expect(err).toMatch(/shareloc|patokan/i);
  });

  it('menolak "shareloct" pada template kelurahan (pre-booking)', () => {
    const err = validateQuickReplyContent(
      'Kalau boleh tau rumahnya kelurahan mana bunda atau alamat lengkapnya?\n\nAtau mungkin bisa shareloct bund, Nanti kami bantu cek kan ongkirnya 🤗',
      'Lokasi'
    );
    expect(err).toBeTruthy();
  });

  it('meloloskan template pasca-booking (kategori Pasca Booking)', () => {
    const err = validateQuickReplyContent(
      'Boleh bantu kirimkan titik lokasi (shareloc WhatsApp) atau seret pin peta di rumah Bunda ya 🙏',
      'Pasca Booking'
    );
    expect(err).toBeNull();
  });

  it('meloloskan template tanpa shareloc', () => {
    const err = validateQuickReplyContent(
      'Kalau boleh tahu rumahnya di kelurahan mana ya Bunda? Atau sebutkan nama perumahan/patokan terdekatnya 🙏',
      'Lokasi'
    );
    expect(err).toBeNull();
  });

  it('meloloskan template form reservasi yang sudah diperbaiki', () => {
    const err = validateQuickReplyContent(
      'Berikut list untuk reservasi :\n\nHari dan tanggal :\nNama Bunda:\nAlamat Lengkap & Patokan :\nKec :\nKota :',
      'Reservasi'
    );
    expect(err).toBeNull();
  });
});
