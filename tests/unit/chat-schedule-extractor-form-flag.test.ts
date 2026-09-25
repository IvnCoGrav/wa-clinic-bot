import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

/**
 * Uji flag deterministik `hasExplicitReservationForm` (Fase 4A — smart banner quick booking).
 *
 * Kontrak: true HANYA bila ada blok formulir reservasi yang SUDAH TERISI customer
 * (lolos pickFilledFormBlock / isFilledFormMessage — template kosong bot dijamin null)
 * DAN dari blok yang sama terpenuhi: (tanggal ATAU jam) + (nama bunda ATAU nama anak
 * ATAU treatment). Tanpa jadwal, pre-fill modal jatuh ke default besok 12.00 → banner
 * menyesatkan, jadi false.
 *
 * Prinsip adversarial: parafrase nyata, huruf besar, tanpa spasi, template kosong,
 * form parsial, chat bebas tanpa form, dan data customer DB TANPA form di pesan.
 */

const CATALOG = [
  { name: 'Pijat Bayi Ceria (Rileksasi)', promoPrice: 60000, originalPrice: 80000, category: 'BABY' },
  { name: 'Oksitosin Massage Fullbody', promoPrice: 105000, originalPrice: 130000, category: 'MOMS' },
];

const CUSTOMER = {
  name: 'Bunda Rina Waru Waru',
  phone: '6281234567890',
  distance_km: 3.0,
  ongkir: 0,
  children: [],
};

const EMPTY_BOT_TEMPLATE_OUTBOUND = {
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
H-1 sebelum treatment akan kami reminder kembali bunda 🥰`,
};

const extract = (messages: Array<{ direction: string; content: string }>, customer?: any) =>
  extractScheduleFromMessages(messages, customer ?? CUSTOMER, CATALOG as any, null);

describe('hasExplicitReservationForm — form terisi eksplisit (positif)', () => {
  it('form lengkap tanggal+jam+nama+anak+treatment → true', () => {
    const out = extract([
      EMPTY_BOT_TEMPLATE_OUTBOUND,
      {
        direction: 'INBOUND',
        content: `Berikut list untuk reservasi :

Hari dan tanggal : Sabtu, 4 Oktober 2026 jam 09.00-10.00
Nama Bunda: anisa
Alamat & Shareloc : Jl. Melati No 3
Kec : Waru
Kota : Sidoarjo
No. Hp : 081234567890

Pilihan treatment (Baby & Kids)

Nama Bayi : dilan
Usia Bayi/Anak : 3 bln
Treatment : pijat ceria

Pilihan treatment (Moms) :

Usia Kehamilan (Jika hamil):
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('tanggal tanpa jam + nama bunda (treatment belum dipilih) → true (kontrak: date+subjek cukup)', () => {
    const out = extract([
      EMPTY_BOT_TEMPLATE_OUTBOUND,
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : Selasa, 7 Oktober 2026
Nama Bunda: sari
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('tanggal + nama anak (nama bunda & treatment kosong) → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : Rabu, 8 Oktober 2026 jam 14.00
Nama Bunda:
Nama Bayi : keisha
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('label HURUF BESAR tanpa spasi kolon ("HARI DAN TANGGAL:5 Oktober", "Treatment:paket") → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `HARI DAN TANGGAL:5 Oktober 2026 jam 10.00-11.00
NAMA BUNDA:maya
Treatment:paket selapan`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('jam mandiri dalam form ("jam 09.00") + treatment, tanggal kosong → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal :
Nama Bunda: maya
Treatment : oksitosin full body
Jam : 09.00-10.00`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });
});

describe('hasExplicitReservationForm — penolakan (negatif / adversarial)', () => {
  it('template kosong bot saja (OUTBOUND) → false', () => {
    const out = extract([EMPTY_BOT_TEMPLATE_OUTBOUND]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('chat bebas tanpa form, walau menyebut layanan+jam ("besok jam 10 pijat ya") → false', () => {
    const out = extract([
      { direction: 'INBOUND', content: 'kak besok jam 10 pijat bayi ya' },
      { direction: 'OUTBOUND', content: 'Siap bunda 😊' },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('form parsial HANYA nama bunda (tanggal & jam kosong) → false — jadwal tak boleh default ke besok', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal :
Nama Bunda: sari
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('form parsial HANYA tanggal (tanpa nama/anak/treatment) → false', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : Selasa, 7 Oktober 2026
Nama Bunda:
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('label terisi TAPI nilai kosong di baris berikutnya (newline dipisah) → false', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal :
Nama Bunda:
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('customer DB punya reservasi/anak, tapi pesan TANPA form → false (flag hanya dari pesan, bukan DB)', () => {
    const out = extract(
      [{ direction: 'INBOUND', content: 'halo kak mau tanya harga' }],
      {
        ...CUSTOMER,
        children: [{ name: 'Nadira', raw_age_text: '2bulan' }],
        reservations: [{ booking_date: '2026-10-04T09:00:00Z', treatment_detail: 'Pijat Bayi Ceria (Rileksasi)', status: 'confirmed' }],
      }
    );
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('pesan kosong / array kosong → false', () => {
    expect(extract([]).hasExplicitReservationForm).toBe(false);
  });

  it('kata "jam" di footer template ("H-3 jam") tidak dihitung jadwal bila label tanggal & subjek kosong → false', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal :
Nama Bunda:
Treatment :
Cancel / Pembatalan Harap minimal H-3 jam`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });
});
