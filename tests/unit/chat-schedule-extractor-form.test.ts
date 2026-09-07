import { describe, it, expect } from 'vitest';
import {
  extractScheduleFromMessages,
  cleanBundaName,
  isFormLabelAge,
  isValidChildName,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import {
  matchCatalogService,
  parseTreatmentItemsFromRaw,
} from '../../packages/admin-dashboard/src/utils/treatmentStringParser';

// Thread riil Bunda Fitria (live server, 2026-09-07) — dipotong sebelum invoice
// admin dikirim, agar ekstraksi diuji murni dari form customer + template bot.
const FITRIA_THREAD = [
  {
    direction: 'INBOUND',
    content: 'Kalau sama aku treatment oksitosin bisa?',
  },
  {
    direction: 'OUTBOUND',
    content: 'Bisa bunda 😊\nUntuk adeknya cukup pijat bayi ceria bund ☺\n\nBisa dibantu isi reservasinya bunda 🤗🙏',
  },
  {
    direction: 'OUTBOUND',
    content: `Berikut list untuk reservasi :

Hari dan tanggal :
Nama Bunda:
Alamat & Shareloc :
Kec :
Kota :
No. Hp :

Pilihan treatment (Baby & Kids)

Nama Bayi :
Usia Bayi/Anak :
Treatment :

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :


Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`,
  },
  { direction: 'INBOUND', content: 'Kak, untuk durasinya brapa menit?' },
  { direction: 'INBOUND', content: 'Oksitosin full body brapa mwnit ya' },
  { direction: 'INBOUND', content: 'Sama pijat baby nya' },
  { direction: 'OUTBOUND', content: 'Oksifull 60 menit, pijat baby kurang lebih 40 menit bund ☺' },
  { direction: 'OUTBOUND', content: 'Bagaimana bund apakah mau kami keep kan tgl dan jamnya bunda? 🤗' },
  { direction: 'INBOUND', content: 'Kak, kalau sabtu bisa? Tgl 12' },
  { direction: 'OUTBOUND', content: 'Bisa bunda tetapi untuk waktu 2 treatment tidak cukup bunda, adanya slot untuk 1 treatment saja bund. Bagaimana? 🤗' },
  { direction: 'INBOUND', content: 'Minggu aja kak kalau gitu' },
  {
    direction: 'INBOUND',
    content: `Berikut list untuk reservasi :

Hari dan tanggal :  minggu, 13 september
Nama Bunda:  fitria
Alamat & Shareloc : Jl. Bumiarjo Gang 7 No.14B
Kec : Wonokromo
Kota : Surabaya
No. Hp : 08563567095

Pilihan treatment (Baby & Kids)

Nama Bayi : Nadira
Usia Bayi/Anak : 2bulan
Treatment : pijat ceria

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment : oksitosin full body


Mohon bisa diisi Bunda 😊
Cancel / Pembatalan Harap minimal H-3 jam

H-1 sebelum treatment akan kami reminder kembali bunda 🥰
Terimakasih.  ☺️`,
  },
  { direction: 'OUTBOUND', content: 'Baik bunda siap 😊' },
];

const FITRIA_CUSTOMER = {
  id: '85153af7-5054-472f-a9d3-67f6ada920f9',
  name: 'Bunda fitria Wonokromo Wonokromo',
  phone: '628563567095',
  address: 'Jl. Bumiarjo Gang 7 No.14B',
  kelurahan: 'Jl. Bumiarjo Gang 7 No.14B',
  kecamatan: 'Wonokromo',
  kota: 'Surabaya',
  distance_km: 11.9,
  ongkir: 15000,
  children: [
    { id: 'f5c207c7-340a-494a-964f-bc854b314d4d', name: 'Usia Bayi/Anak :', raw_age_text: 'Treatment :' },
    { id: '869eff6e-27d4-4337-b90e-2ac2c0d3f760', name: 'Fitria', raw_age_text: 'hamil 38 minggu' },
    { id: 'd4e086a4-a48a-4cc4-8f84-4fb3fcf76e34', name: 'Nadira', raw_age_text: '2bulan' },
  ],
};

const CATALOG = [
  { name: 'Pijat Bayi Ceria (Rileksasi)', promoPrice: 60000, originalPrice: 80000, category: 'BABY' },
  { name: 'Oksitosin Massage Fullbody', promoPrice: 105000, originalPrice: 130000, category: 'MOMS' },
  { name: 'Paket Selapan (Cukur + Pijat Ceria)', promoPrice: 80000, originalPrice: 100000, category: 'BUNDLE' },
];

describe('Form Bunda Fitria — prioritas form terisi & anti-template-kosong', () => {
  it('tanggal dari form customer: Minggu 13 September 2026 (bukan fallback H+1)', () => {
    const out = extractScheduleFromMessages(FITRIA_THREAD, FITRIA_CUSTOMER, CATALOG as any);
    expect(out.dateDisplay).toBe('Minggu 13 September 2026');
    expect(out.bookingDate?.getFullYear()).toBe(2026);
    expect(out.bookingDate?.getMonth()).toBe(8);
    expect(out.bookingDate?.getDate()).toBe(13);
  });

  it('nama anak Nadira + usia 2bulan dari form (bukan "Treatment :")', () => {
    const out = extractScheduleFromMessages(FITRIA_THREAD, FITRIA_CUSTOMER, CATALOG as any);
    expect(out.childName).toBe('Nadira');
    expect(out.childAge).toContain('2bulan');
    expect(out.childAge).not.toContain('Treatment');
  });

  it('multi-treatment Baby+Moms: pijat ceria + oksitosin full body → BUNDLE Rp 165.000', () => {
    const out = extractScheduleFromMessages(FITRIA_THREAD, FITRIA_CUSTOMER, CATALOG as any);
    expect(out.treatmentCategory).toBe('BUNDLE');
    expect(out.treatmentName).toContain('Pijat Bayi Ceria');
    expect(out.treatmentName).toContain('Oksitosin Massage Fullbody');
    expect(out.treatmentName).not.toContain('Selapan');
    expect(out.treatmentPrice).toBe(165000);
  });

  it('jarak & ongkir dari profil: 11.9 km / Rp 15.000', () => {
    const out = extractScheduleFromMessages(FITRIA_THREAD, FITRIA_CUSTOMER, CATALOG as any);
    expect(out.distanceKm).toBe(11.9);
    expect(out.ongkir).toBe(15000);
  });

  it('nama bunda bersih tanpa duplikasi kecamatan', () => {
    const out = extractScheduleFromMessages(FITRIA_THREAD, FITRIA_CUSTOMER, CATALOG as any);
    expect(out.bundaName.toLowerCase()).toBe('fitria');
  });
});

describe('Pencegahan salah tangkap template kosong bot', () => {
  it('hanya template kosong → tanggal fallback H+1, tanpa nama anak/treatment korup', () => {
    const onlyTemplate = [FITRIA_THREAD[2]];
    const out = extractScheduleFromMessages(onlyTemplate, { name: '-', phone: '-', distance_km: 3.0, ongkir: 0 }, CATALOG as any);
    expect(out.childName).toBe('');
    expect(out.childAge).toBe('');
    // tanggal fallback H+1, BUKAN hasil parse template kosong
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(out.bookingDate?.getDate()).toBe(tomorrow.getDate());
  });
});

describe('Token matching katalog anti-false-match', () => {
  it('"pijat ceria" → Pijat Bayi Ceria (Rileksasi), bukan Paket Selapan', () => {
    expect(matchCatalogService('pijat ceria', CATALOG as any)?.name).toBe('Pijat Bayi Ceria (Rileksasi)');
  });

  it('"oksitosin full body" dan "oksifull" → Oksitosin Massage Fullbody', () => {
    expect(matchCatalogService('oksitosin full body', CATALOG as any)?.name).toBe('Oksitosin Massage Fullbody');
    expect(matchCatalogService('oksifull', CATALOG as any)?.name).toBe('Oksitosin Massage Fullbody');
  });

  it('"selapan" eksplisit → tetap boleh cocok ke Paket Selapan', () => {
    expect(matchCatalogService('paket selapan', CATALOG as any)?.name).toBe('Paket Selapan (Cukur + Pijat Ceria)');
  });

  it('parseTreatmentItemsFromRaw hidrasi 2 item Rp 60.000 + Rp 105.000', () => {
    const items = parseTreatmentItemsFromRaw(
      'Pijat Bayi Ceria + Oksitosin Massage Fullbody',
      CATALOG as any
    );
    expect(items).toHaveLength(2);
    const subtotal = items.reduce((s, t) => s + t.price, 0);
    expect(subtotal).toBe(165000);
    expect(items.map((t) => t.name)).toContain('Pijat Bayi Ceria (Rileksasi)');
    expect(items.map((t) => t.name)).toContain('Oksitosin Massage Fullbody');
  });
});

describe('Sanitasi nama & usia', () => {
  it('cleanBundaName collapse duplikasi: "fitria Wonokromo Wonokromo" → "fitria"', () => {
    expect(cleanBundaName('fitria Wonokromo Wonokromo', 'Wonokromo', 'Surabaya')).toBe('fitria');
    expect(cleanBundaName('Bunda fitria Wonokromo Wonokromo', 'Wonokromo', 'Surabaya')).toBe('fitria');
    expect(cleanBundaName('Bunda Vita Sidoarjo', 'Waru', 'Sidoarjo')).toBe('Bunda Vita Sidoarjo'.replace(/^bunda\s+/i, '').replace(/\s+Sidoarjo$/i, ''));
  });

  it('isFormLabelAge menolak label teknis, menerima usia riil', () => {
    expect(isFormLabelAge('Treatment :')).toBe(true);
    expect(isFormLabelAge('Usia Bayi/Anak :')).toBe(true);
    expect(isFormLabelAge('')).toBe(true);
    expect(isFormLabelAge('2bulan')).toBe(false);
    expect(isFormLabelAge('2 bulan')).toBe(false);
    expect(isFormLabelAge('hamil 38 minggu')).toBe(false);
  });

  it('DB children korup tidak bocor: raw_age_text "Treatment :" diabaikan', () => {
    const out = extractScheduleFromMessages(
      [{ direction: 'INBOUND', content: 'halo kak mau tanya' }],
      {
        name: 'Bunda X',
        phone: '6281',
        distance_km: 3.0,
        ongkir: 0,
        children: [{ name: 'Usia Bayi/Anak :', raw_age_text: 'Treatment :' }],
      },
      CATALOG as any
    );
    expect(out.childName).toBe('');
    expect(out.childAge).toBe('');
    expect(isValidChildName('Usia Bayi/Anak :')).toBe(false);
  });
});
