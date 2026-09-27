import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages, formatIndonesianDate, formatFormBannerAudienceLabel, hasExistingReservationForSchedule } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

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

/** Tanggal relatif dinamis (anti-bom waktu): label Indonesia N hari dari sekarang. */
const futureDateLabel = (daysAhead: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return formatIndonesianDate(d);
};
const pastDateLabel = (daysAgo: number): string => futureDateLabel(-daysAgo);

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

Hari dan tanggal : ${futureDateLabel(5)} jam 09.00-10.00
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
        content: `Hari dan tanggal : ${futureDateLabel(6)}
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
        content: `Hari dan tanggal : ${futureDateLabel(7)} jam 14.00
Nama Bunda:
Nama Bayi : keisha
Treatment :`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('label HURUF BESAR tanpa spasi kolon ("HARI DAN TANGGAL:<tgl>", "Treatment:paket") → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `HARI DAN TANGGAL:${futureDateLabel(8)} jam 10.00-11.00
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

/**
 * Fase 4C — Gerbang arah pesan (INBOUND-only) & kadaluwarsa tanggal.
 * Bukti akar masalah: invoice OUTBOUND admin ("Berikut reservasi 🐣") pernah
 * dikira "FORM RESERVASI MASUK"; form INBOUND bertanggal lampau juga memicu banner.
 */
describe('hasExplicitReservationForm — gerbang arah pesan & kadaluwarsa (Fase 4C)', () => {
  const OUTBOUND_INVOICE = {
    direction: 'OUTBOUND',
    content: `Berikut reservasi 🐣

Hari dan tanggal : ${futureDateLabel(3)} (11.00-12.00)
Nama Bunda: Inggrid
Alamat & Shareloc : Jl. Kenanga 5
Kec : Waru
Kota : Sidoarjo
No. Hp : 6288000000003

Pilihan treatment (Moms) :

Treatment : Oksitosin Massage Fullbody

Payment : 
Treatment = 105.000
Total = 105.000`,
  };

  it('invoice OUTBOUND admin saja (Berikut reservasi 🐣) → false (bukan form masuk)', () => {
    const out = extract([OUTBOUND_INVOICE]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('OUTBOUND invoice tetap jadi SUMBER DATA (fallback) walau flag banner false', () => {
    const out = extract([OUTBOUND_INVOICE]);
    expect(out.treatmentName).toContain('Oksitosin');
  });

  it('form INBOUND bertanggal 2 hari lalu → false (kadaluwarsa)', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : ${pastDateLabel(2)} jam 10.00-11.00
Nama Bunda: inggrid
Treatment : oksitosin full body`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(false);
  });

  it('batas: form INBOUND bertanggal HARI INI → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : ${futureDateLabel(0)} jam 10.00-11.00
Nama Bunda: inggrid
Treatment : oksitosin full body`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('form INBOUND bertanggal masa depan → true', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal : ${futureDateLabel(4)} jam 10.00-11.00
Nama Bunda: inggrid
Treatment : oksitosin full body`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('form INBOUND tanpa tanggal (hanya jam) → true (tidak dapat dinyatakan kadaluwarsa)', () => {
    const out = extract([
      {
        direction: 'INBOUND',
        content: `Hari dan tanggal :
Nama Bunda: inggrid
Jam : 10.00-11.00
Treatment : oksitosin full body`,
      },
    ]);
    expect(out.hasExplicitReservationForm).toBe(true);
  });

  it('multiphrasa tanggal lampau (2 hari lalu) dengan label variatif → tetap false', () => {
    for (const label of ['Hari dan tanggal', 'hari/tgl', 'Tanggal']) {
      const out = extract([
        {
          direction: 'INBOUND',
          content: `${label} : ${pastDateLabel(6)}
Nama Bunda: sari
Treatment : pijat ceria`,
        },
      ]);
      expect(out.hasExplicitReservationForm, `label "${label}"`).toBe(false);
    }
  });
});

/** Fase 4D — label subjek audiens data-driven (anti "👶 Anak" pada layanan MOMS). */
describe('formatFormBannerAudienceLabel — label audiens berbasis kategori', () => {
  it('kategori MOMS → 👩 Bunda (bukan 👶 Anak), walau childName kosong', () => {
    const label = formatFormBannerAudienceLabel({ treatmentCategory: 'MOMS', childName: '', bundaName: 'Inggrid' });
    expect(label).toBe('👩 Inggrid');
    expect(label).not.toContain('👶');
  });

  it('kategori MOMS tanpa nama bunda → 👩 Bunda', () => {
    expect(formatFormBannerAudienceLabel({ treatmentCategory: 'MOMS', childName: '', bundaName: '' })).toBe('👩 Bunda');
  });

  it('kategori BABY → 👶 <nama> / fallback Anak', () => {
    expect(formatFormBannerAudienceLabel({ treatmentCategory: 'BABY', childName: 'Dilan', bundaName: 'Sari' })).toBe('👶 Dilan');
    expect(formatFormBannerAudienceLabel({ treatmentCategory: 'BABY', childName: '', bundaName: 'Sari' })).toBe('👶 Anak');
  });

  it('kategori BUNDLE/BOTH → Bunda & anak', () => {
    expect(formatFormBannerAudienceLabel({ treatmentCategory: 'BUNDLE', childName: 'Kenzo', bundaName: 'Vita' })).toBe('👩 Bunda & 👶 Kenzo');
    expect(formatFormBannerAudienceLabel({ treatmentCategory: 'BOTH', childName: '', bundaName: 'Vita' })).toBe('👩 Bunda & 👶 Anak');
  });
});

/** Fase 4C — supresi banner duplikat (pure helper, bukan browser). */
describe('hasExistingReservationForSchedule — supresi banner duplikat', () => {
  const target = new Date(2026, 8, 25, 11, 0); // 25 Sep 2026 (kalender lokal)

  it('kasus Bunda Inggrid: reservasi same-day MOMS completed → true (banner disupresi)', () => {
    expect(
      hasExistingReservationForSchedule(
        [
          {
            booking_date: new Date(2026, 8, 25, 11, 0).toISOString(),
            status: 'completed',
            treatment_detail: 'Kala Mom – Oksitosin Massage (Full Body)',
            treatment_category: 'MOMS',
          },
        ],
        target,
        'Kala Mom – Oksitosin Massage (Full Body)',
        'MOMS'
      )
    ).toBe(true);
  });

  it('same-day tapi layanan beda kategori (MOMS vs BABY) → false (banner tetap tampil)', () => {
    expect(
      hasExistingReservationForSchedule(
        [
          {
            booking_date: new Date(2026, 8, 25, 9, 0).toISOString(),
            status: 'completed',
            treatment_detail: 'Oksitosin Massage Fullbody',
            treatment_category: 'MOMS',
          },
        ],
        target,
        'Pijat Bayi Ceria (Rileksasi)',
        'BABY'
      )
    ).toBe(false);
  });

  it('reservasi same-day berstatus cancelled → false (customer boleh booking ulang)', () => {
    expect(
      hasExistingReservationForSchedule(
        [{ booking_date: target.toISOString(), status: 'cancelled', treatment_category: 'MOMS' }],
        target,
        'Oksitosin Massage Fullbody',
        'MOMS'
      )
    ).toBe(false);
  });

  it('reservasi tanggal berbeda → false', () => {
    expect(
      hasExistingReservationForSchedule(
        [{ booking_date: new Date(2026, 8, 26, 11, 0).toISOString(), status: 'confirmed', treatment_category: 'MOMS' }],
        target,
        'Oksitosin Massage Fullbody',
        'MOMS'
      )
    ).toBe(false);
  });

  it('kategori sama tapi treatment tidak beririsan → true (duplikat kategori layanan)', () => {
    expect(
      hasExistingReservationForSchedule(
        [{ booking_date: target.toISOString(), status: 'hold', treatment_detail: 'Senam Hamil', treatment_category: 'MOMS' }],
        target,
        'Oksitosin Massage Fullbody',
        'MOMS'
      )
    ).toBe(true);
  });

  it('input kosong / tanggal invalid → false', () => {
    expect(hasExistingReservationForSchedule(null, target, 'x', 'MOMS')).toBe(false);
    expect(hasExistingReservationForSchedule([], target, 'x', 'MOMS')).toBe(false);
    expect(hasExistingReservationForSchedule([{ booking_date: target.toISOString(), status: 'completed' }], null, 'x', 'MOMS')).toBe(false);
    expect(hasExistingReservationForSchedule([{ booking_date: 'not-a-date', status: 'completed' }], target, 'x', 'MOMS')).toBe(false);
  });
});
