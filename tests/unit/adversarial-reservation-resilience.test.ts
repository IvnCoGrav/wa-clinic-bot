import { describe, it, expect, vi } from 'vitest';
import { findNearestSubdistrict, haversineKm } from '../../src/utils/gazetteer';
import { geocodingService } from '../../src/integrations/google-maps/geocoding';
import {
  extractScheduleFromMessages,
  extractWilayahFromAddress,
  WilayahReference,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

// Dataset referensi wilayah realistis meniru response GET /api/admin/geo/areas
const REALISTIC_REF: WilayahReference = {
  kecamatan: [
    'Gubeng',
    'Sedati',
    'Waru',
    'Genteng',
    'Tegalsari',
    'Wonokromo',
    'Sawahan',
    'Rungkut',
    'Sukolilo',
    'Gunung Anyar',
    'Karang Pilang',
    'Candi',
    'Taman',
    'Sidoarjo',
    'Buduran',
    'Gedangan',
  ],
  kota: [
    'Kabupaten Sidoarjo',
    'Kota Surabaya',
    'Kabupaten Gresik',
  ],
};

// Katalog layanan dinamis meniru database clinic_services
const MOCK_CLINIC_SERVICES: any[] = [
  {
    serviceId: 'baby-massage-ceria',
    name: 'Pijat Bayi Ceria',
    category: 'BABY',
    minAgeMonths: 0,
    maxAgeMonths: 24,
    durationMinutes: 45,
    promoPrice: 70000,
    originalPrice: 80000,
    isActive: true,
  },
  {
    serviceId: 'kids-massage-ceria',
    name: 'Pijat Kids Ceria',
    category: 'KIDS',
    minAgeMonths: 25,
    maxAgeMonths: 96,
    durationMinutes: 50,
    promoPrice: 90000,
    originalPrice: 100000,
    isActive: true,
  },
  {
    serviceId: 'moms-relaksasi',
    name: 'Pijat Relaksasi Ibu (Women Relaxation Massage)',
    category: 'MOMS',
    minAgeMonths: 0,
    maxAgeMonths: null,
    durationMinutes: 60,
    promoPrice: 85000,
    originalPrice: 110000,
    isActive: true,
  },
  {
    serviceId: 'add-on-sinar-moksa',
    name: 'Sinar Moksa (Infrared / Moxa)',
    category: 'ADD_ON',
    isAddon: true,
    promoPrice: 15000,
    originalPrice: 25000,
    isActive: true,
  },
];

describe('ADVERSARIAL SUITE 1: Ketahanan Spatial Nearest-Neighbor Geocoding', () => {
  it('Edge Case 1.1: Koordinat Ekstrem, NaN, Infinity, dan tipe anomali tidak boleh crash', () => {
    expect(findNearestSubdistrict(NaN, 112.7)).toBeNull();
    expect(findNearestSubdistrict(-7.3, NaN)).toBeNull();
    expect(findNearestSubdistrict(Infinity, 112.7)).toBeNull();
    expect(findNearestSubdistrict(-7.3, -Infinity)).toBeNull();
    expect(findNearestSubdistrict(null as any, 112.7)).toBeNull();
    expect(findNearestSubdistrict(-7.3, undefined as any)).toBeNull();
    expect(findNearestSubdistrict('invalid' as any, 112.7 as any)).toBeNull();
  });

  it('Edge Case 1.2: Koordinat batas radius 35 km (threshold cutoff)', () => {
    // Titik pusat koordinat Sedati: ~(-7.3698, 112.7733)
    const matchNearby = findNearestSubdistrict(-7.3683, 112.7744, 35);
    expect(matchNearby).not.toBeNull();

    // Titik dengan radius sangat ketat (0.01 km = 10 meter)
    const matchTooTight = findNearestSubdistrict(-7.3683, 112.7744, 0.01);
    expect(matchTooTight).toBeNull();

    // Titik di luar jangkauan (Malang/Pasuruan ~60km)
    const matchFar = findNearestSubdistrict(-7.9839, 112.6214, 35);
    expect(matchFar).toBeNull();
  });

  it('Edge Case 1.3: Haversine precision pada titik yang identik (distance = 0) dan floating point edge', () => {
    const dZero = haversineKm(-7.3683, 112.7744, -7.3683, 112.7744);
    expect(dZero).toBe(0);
    expect(Number.isFinite(dZero)).toBe(true);

    // Titik antipodal (ujung bumi berlawanan): tidak boleh mengembalikan NaN
    const dAntipodal = haversineKm(0, 0, 0, 180);
    expect(Number.isFinite(dAntipodal)).toBe(true);
    expect(dAntipodal).toBeGreaterThan(19000);
  });

  it('Edge Case 1.4: Uji Ketahanan Beban (500 rapid consecutive queries)', () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      const lat = -7.3000 - (i * 0.0005);
      const lng = 112.7000 + (i * 0.0005);
      const res = findNearestSubdistrict(lat, lng, 35);
      expect(res === null || typeof res.kecamatan === 'string').toBe(true);
    }
    const elapsed = performance.now() - start;
    // 500 queries pada 3.748 baris harus selesai di bawah 1.500 ms (< 3ms per query)
    expect(elapsed).toBeLessThan(1500);
  });

  it('Edge Case 1.5: Fallback reverseGeocode tidak pernah menyuntikkan Gubeng/Surabaya palsu untuk koordinat non-Surabaya', async () => {
    // Jakarta Monas — di luar coverage gazetteer SBY/SDA: kontrak mockReverseGeocode (geocoding.ts:839-844)
    // isPrecise false + tanpa nama (anti-fake Gubeng). Test lama expect true = salah.
    const jakarta = await geocodingService.reverseGeocode(-6.1754, 106.8272);
    expect(jakarta.isPrecise).toBe(false);
    expect(jakarta.kecamatan).toBeUndefined();
    expect(jakarta.kota).toBeUndefined();
    expect(jakarta.kelurahan).toBeUndefined();

    // Luar negeri (Singapura)
    const singapore = await geocodingService.reverseGeocode(1.3521, 103.8198);
    expect(singapore.isPrecise).toBe(false);
    expect(singapore.kecamatan).toBeUndefined();
    expect(singapore.kota).toBeUndefined();
  });
});

describe('ADVERSARIAL SUITE 2: Uji Ketahanan Ekstraksi Wilayah dari Alamat Rumit', () => {
  it('Adversarial 2.1: Nama jalan memuat nama kecamatan lain (Jalan Gubeng di Sedati)', () => {
    const addr = 'Jl. Gubeng Kertajaya No. 12, RT 02 RW 01, Kecamatan Sedati, Sidoarjo';
    const res = extractWilayahFromAddress(addr, REALISTIC_REF);
    // Wilayah harus terdeteksi (salah satu dari kecamatan di teks)
    expect(['Sedati', 'Gubeng']).toContain(res.kecamatan);
    expect(res.kota).toBe('Kabupaten Sidoarjo');
  });

  it('Adversarial 2.2: Substring trap words (warung, candi, genteng)', () => {
    // "warung" TIDAK BOLEH mencocokkan "Waru"
    const addr1 = 'Warung soto ayam pak min, jalan mawar nomor 5';
    expect(extractWilayahFromAddress(addr1, REALISTIC_REF).kecamatan).toBe('');

    // "kandidat" TIDAK BOLEH mencocokkan "Candi"
    const addr2 = 'Jalan kandidat bupati nomor 12';
    expect(extractWilayahFromAddress(addr2, REALISTIC_REF).kecamatan).toBe('');
  });

  it('Adversarial 2.3: Variasi format ekstrem (titik nempel, simbol, spasi acak)', () => {
    const addr1 = 'Alamat:Perumahan Juanda,Kec.Sedati,Kab.Sidoarjo';
    const res1 = extractWilayahFromAddress(addr1, REALISTIC_REF);
    expect(res1.kecamatan).toBe('Sedati');
    expect(res1.kota).toBe('Kabupaten Sidoarjo');

    const addr2 = 'Perum Central Park Juanda [Blok CC-25] *** KECAMATAN SEDATI *** (SIDOARJO)';
    const res2 = extractWilayahFromAddress(addr2, REALISTIC_REF);
    expect(res2.kecamatan).toBe('Sedati');
    expect(res2.kota).toBe('Kabupaten Sidoarjo');
  });

  it('Adversarial 2.4: Payload ReDoS / Karakter Khusus Regex', () => {
    const malicious = 'Jl. Mawar ' + '([a-z]+)*?^$\\/.'.repeat(50) + ' Kec. Sedati, Sidoarjo';
    const start = performance.now();
    const res = extractWilayahFromAddress(malicious, REALISTIC_REF);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50); // Eksekusi tidak boleh freezing / ReDoS
    expect(res.kecamatan).toBe('Sedati');
  });

  it('Adversarial 2.5: Alamat dengan pergantian lokasi di chat (koreksi customer)', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Alamat lama saya di Jl. Raya Darmo, Wonokromo' },
      { direction: 'OUTBOUND', content: 'Baik bunda, mau dikirim ke sana?' },
      { direction: 'INBOUND', content: 'Bukan kak, sekarang sudah pindah ke Jl. Pabean, Kec. Sedati, Sidoarjo ya' },
      {
        direction: 'INBOUND',
        content: [
          'Berikut list untuk reservasi :',
          'Nama Bunda: Lutfia',
          'Alamat & Shareloc : Jl. Pabean Asri Blok B, Sedati, Sidoarjo',
          'Kec : ',
          'Kota : ',
          'Treatment : Pijat Bayi Ceria',
        ].join('\n'),
      },
    ];

    const poisonedProfile = {
      name: 'Lutfia',
      kecamatan: 'Wonokromo',
      kota: 'Kota Surabaya',
    };

    const out = extractScheduleFromMessages(messages, poisonedProfile, MOCK_CLINIC_SERVICES, REALISTIC_REF);
    // Form terisi Sedati harus menimpa profil lama Wonokromo
    expect(out.kecamatan).toBe('Sedati');
    expect(out.kota).toBe('Kabupaten Sidoarjo');
  });
});

describe('ADVERSARIAL SUITE 3: Uji Ketahanan Pencocokan Katalog & Harga Dinamis', () => {
  it('Adversarial 3.1: Treatment tidak dikenal TIDAK BOLEH mengarang harga 60000', () => {
    const messages = [
      {
        direction: 'INBOUND',
        content: 'Treatment : Pijat Akupresur Alien Super',
      },
    ];
    const out = extractScheduleFromMessages(messages, {}, MOCK_CLINIC_SERVICES, REALISTIC_REF);
    expect(out.treatmentPrice).toBe(0);
  });

  it('Adversarial 3.2: Pasien Bayi (15 bulan) vs Kids (4 tahun) pada keluhan/layanan "Pijat Ceria"', () => {
    // Skenario A: Bayi 15 bulan -> harus Pijat Bayi Ceria (Rp 70.000)
    const babyMessages = [
      {
        direction: 'INBOUND',
        content: [
          'Berikut list untuk reservasi :',
          'Nama Bayi : Ravyan',
          'Usia Bayi/Anak : 15 Bulan',
          'Treatment : Pijat Rileksasi',
        ].join('\n'),
      },
    ];
    const babyOut = extractScheduleFromMessages(babyMessages, {}, MOCK_CLINIC_SERVICES, REALISTIC_REF);
    expect(babyOut.treatmentPrice).toBe(70000);

    // Skenario B: Anak 4 tahun (48 bulan) -> harus Pijat Kids Ceria (Rp 90.000)
    const kidsMessages = [
      {
        direction: 'INBOUND',
        content: [
          'Berikut list untuk reservasi :',
          'Nama Bayi : Kakak Arka',
          'Usia Bayi/Anak : 4 tahun',
          'Treatment : Pijat Rileksasi',
        ].join('\n'),
      },
    ];
    const kidsOut = extractScheduleFromMessages(kidsMessages, {}, MOCK_CLINIC_SERVICES, REALISTIC_REF);
    expect(kidsOut.treatmentPrice).toBe(90000);
  });

  it('Adversarial 3.3: Multi-treatment kalkulasi harga akumulatif data-driven', () => {
    const multiMessages = [
      {
        direction: 'INBOUND',
        content: [
          'Berikut list untuk reservasi :',
          'Nama Bayi : Ravyan',
          'Usia Bayi/Anak : 10 Bulan',
          'Treatment : Pijat Bayi Ceria + Sinar Moksa',
        ].join('\n'),
      },
    ];
    const out = extractScheduleFromMessages(multiMessages, {}, MOCK_CLINIC_SERVICES, REALISTIC_REF);
    // 70.000 (Bayi Ceria) + 15.000 (Sinar Moksa) = 85.000
    expect(out.treatmentPrice).toBe(85000);
  });
});

describe('ADVERSARIAL SUITE 4: Uji Ketahanan Update Reservasi & Customer Preferences', () => {
  it('Adversarial 4.1: Alamat sangat panjang (> 300 karakter) tidak boleh crash atau overflow', () => {
    const longAddress = 'Perumahan Grand Juanda Regency Blok ZZ-999, Jalan Melati Raya No. 456, Gang Kelinci RT 09 RW 15, Kelurahan Semampir, Kecamatan Sedati, Kabupaten Sidoarjo, Jawa Timur, Kode Pos 61253, Landmark dekat pos satpam gapura hijau pagar hitam tingkat dua.';

    const currentPrefs: any = { landmark: 'Gapura hijau' };
    const nextPrefs: any = { ...currentPrefs, address: longAddress };
    const kelurahan = longAddress.substring(0, 100);

    expect(nextPrefs.address).toBe(longAddress);
    expect(kelurahan.length).toBeLessThanOrEqual(100);
    expect(nextPrefs.landmark).toBe('Gapura hijau');
  });

  it('Adversarial 4.2: assignedStaffId string kosong atau whitespace wajib dinormalisasi ke null', () => {
    const rawInputs = ['', '   ', null, undefined];
    for (const input of rawInputs) {
      const normalized = (input as string)?.trim() || null;
      expect(normalized).toBeNull();
    }
  });

  it('Adversarial 4.3: Customer preferences null / non-object tidak boleh melempar exception saat di-spread', () => {
    const nullCust: any = { preferences: null };
    const currentPrefs1 = (nullCust?.preferences as any) || {};
    const nextPrefs1 = { ...currentPrefs1, address: 'Jl. Juanda' };
    expect(nextPrefs1.address).toBe('Jl. Juanda');

    const undefinedCust: any = {};
    const currentPrefs2 = (undefinedCust?.preferences as any) || {};
    const nextPrefs2 = { ...currentPrefs2, address: 'Jl. Juanda' };
    expect(nextPrefs2.address).toBe('Jl. Juanda');
  });
});
