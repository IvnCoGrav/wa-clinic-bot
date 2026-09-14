import { describe, it, expect } from 'vitest';
import {
  extractScheduleFromMessages,
  extractWilayahFromAddress,
  WilayahReference,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

// Referensi mini meniru `GET /api/admin/geo/areas` (casing kanonis backend)
const REF: WilayahReference = {
  kecamatan: ['Gubeng', 'Sedati', 'Waru', 'Genteng', 'Tegalsari'],
  kota: ['Kabupaten Sidoarjo', 'Kota Surabaya'],
};

// Kasus nyata 6282229353440: profil terpolusi Gubeng/Surabaya, alamat teks memuat Sedati/Sidoarjo.
describe('Ekstraksi Kec/Kota Data-Driven dari Alamat (Anti-Amnesia Profil)', () => {
  const ADDRESS = 'Perum. Central Park Juanda Cluster The south Blok CC 25, Semampir, Kec. Sedati, Waru- Kab. Sidoarjo Jawa Timur.';
  const POISONED_PROFILE = {
    name: 'Bunda Lutfia',
    phone: '082229353440',
    address: ADDRESS,
    kecamatan: 'Gubeng',
    kota: 'Surabaya',
    distance_km: 8.0,
    ongkir: 15000,
  };

  it('Kec/Kota kosong di form terisi dari teks alamat, bukan profil terpolusi', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Halo Bunda! Mau booking kapan?' },
      {
        direction: 'INBOUND',
        content: [
          'Nama: Lutfia',
          'Alamat: Perum. Central Park Juanda Cluster The south Blok CC 25, Semampir, Kec. Sedati, Waru- Kab. Sidoarjo Jawa Timur.',
          'Kec & Kota: ',
          'Treatment: Pijat Rileksasi',
        ].join('\n'),
      },
    ];
    const out = extractScheduleFromMessages(messages, POISONED_PROFILE, [], REF);
    expect(out.kecamatan).toBe('Sedati');
    expect(out.kota).toBe('Kabupaten Sidoarjo');
  });

  it('Kec/Kota eksplisit di form tidak ditimpa oleh alamat', () => {
    const messages = [
      {
        direction: 'INBOUND',
        content: ['Alamat: ' + ADDRESS, 'Kecamatan: Waru', 'Kota: Sidoarjo'].join('\n'),
      },
    ];
    const out = extractScheduleFromMessages(messages, POISONED_PROFILE, [], REF);
    expect(out.kecamatan).toBe('Waru');
    expect(out.kota).toBe('Sidoarjo');
  });

  it('alamat tanpa wilayah dikenal tetap jatuh ke profil (perilaku lama lestari)', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Alamat: Gang Mawar No. 3' },
    ];
    const profile = { ...POISONED_PROFILE, kecamatan: 'Genteng', kota: 'Kota Surabaya' };
    const out = extractScheduleFromMessages(messages, profile, [], REF);
    expect(out.kecamatan).toBe('Genteng');
    expect(out.kota).toBe('Kota Surabaya');
  });

  it('tanpa referensi wilayah perilaku lama tetap (fallback profil)', () => {
    const messages = [{ direction: 'INBOUND', content: 'Alamat: ' + ADDRESS }];
    const out = extractScheduleFromMessages(messages, POISONED_PROFILE, []);
    expect(out.kecamatan).toBe('Gubeng');
    expect(out.kota).toBe('Surabaya');
  });

  it('matcher toleran huruf besar dan pilih nama terpanjang (Sedati > Waru)', () => {
    expect(extractWilayahFromAddress('KEC. SEDATI, KAB. SIDOARJO', REF)).toEqual({
      kecamatan: 'Sedati',
      kota: 'Kabupaten Sidoarjo',
    });
    // "waru" substring di "warung" tidak boleh cocok whole-word
    expect(extractWilayahFromAddress('warung makan barokah', REF).kecamatan).toBe('');
    expect(extractWilayahFromAddress('', REF)).toEqual({ kecamatan: '', kota: '' });
    expect(extractWilayahFromAddress(ADDRESS, null)).toEqual({ kecamatan: '', kota: '' });
  });
});
