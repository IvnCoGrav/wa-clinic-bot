import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  typingService,
  isFormFieldLine,
  findFormSection,
} from '../../src/services/typing.service';
import {
  getHumanizerBubbleConfig,
  clearHumanizerBubbleConfigCache,
  parseHumanizerBubbleConfig,
  EMPTY_HUMANIZER_BUBBLE_CONFIG,
} from '../../src/config/humanizer-bubble.config';
import { prisma } from '../../src/db/client';

/**
 * W-010 — pemecah bubble humanizer.
 *
 * Kontrak yang dijaga:
 * - Deteksi form bersifat STRUKTURAL (`Label : nilai`), bukan daftar frasa
 *   bisnis hardcode. Template tenant boleh berubah tanpa deploy kode.
 * - Frasa lama ("format reservasi", "Alamat & Shareloc") TIDAK lagi menjadi
 *   pemicu split 3-bubble.
 * - Pemisah label/nilai non-standar hanya lewat konfigurasi tenant di DB.
 */

const oldSingleThreshold = process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;
const oldMaxCount = process.env.HUMANIZER_BUBBLE_MAX_COUNT;
const oldMaxChars = process.env.HUMANIZER_BUBBLE_MAX_CHARS;

beforeEach(() => {
  vi.restoreAllMocks();
  clearHumanizerBubbleConfigCache();
  process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = '350';
  process.env.HUMANIZER_BUBBLE_MAX_COUNT = '2';
  process.env.HUMANIZER_BUBBLE_MAX_CHARS = '250';
});

afterEach(() => {
  vi.restoreAllMocks();
  clearHumanizerBubbleConfigCache();
  if (oldSingleThreshold !== undefined) process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS = oldSingleThreshold;
  else delete process.env.HUMANIZER_BUBBLE_SINGLE_THRESHOLD_CHARS;
  if (oldMaxCount !== undefined) process.env.HUMANIZER_BUBBLE_MAX_COUNT = oldMaxCount;
  else delete process.env.HUMANIZER_BUBBLE_MAX_COUNT;
  if (oldMaxChars !== undefined) process.env.HUMANIZER_BUBBLE_MAX_CHARS = oldMaxChars;
  else delete process.env.HUMANIZER_BUBBLE_MAX_CHARS;
});

describe('isFormFieldLine (struktural, tanpa frasa bisnis)', () => {
  it('mengenali baris "Label : nilai" apa pun labelnya', () => {
    expect(isFormFieldLine('Nama Pasien : Budi')).toBe(true);
    expect(isFormFieldLine('Jadwal Kunjungan:')).toBe(true);
    expect(isFormFieldLine('Lokasi : Jl. Melati 5')).toBe(true);
  });

  it('menolak jam, URL, dan kalimat panjang yang kebetulan bertitik dua', () => {
    expect(isFormFieldLine('09:00')).toBe(false);
    expect(isFormFieldLine('http://example.com')).toBe(false);
    expect(isFormFieldLine('Catatan penting sekali untuk Bunda yang baru datang: jangan lupa dibawa ya besok pagi')).toBe(false);
    expect(isFormFieldLine('Ini kalimat biasa tanpa pemisah')).toBe(false);
  });

  it('mendukung pemisah tambahan hanya bila dikonfigurasi tenant', () => {
    expect(isFormFieldLine('Nama = Budi')).toBe(false);
    expect(isFormFieldLine('Nama = Budi', { extraSeparators: ['='] })).toBe(true);
  });
});

describe('findFormSection', () => {
  it('mendeteksi blok field + judul pendek di atasnya + footer', () => {
    const paragraphs = [
      'Tentu bisa Bunda, layanan yang cocok untuk keluhan tersebut adalah Pijat Bayi.',
      'Silakan lengkapi data berikut:',
      'Nama Pasien :\nUsia :\nLokasi :\nCatatan :',
      'Mohon diisi lalu kirim kembali ya Bunda.',
    ];
    const section = findFormSection(paragraphs);
    expect(section).toEqual({ start: 1, end: 2 });
  });

  it('tidak menganggap teks biasa sebagai form (field < 3)', () => {
    expect(findFormSection(['Nama : Budi', 'Terima kasih.'])).toBeNull();
  });

  it('mengizinkan satu paragraf judul bagian di antara dua blok field', () => {
    const paragraphs = [
      'Header form:',
      'Nama :\nUsia :',
      'Pilihan layanan',
      'Treatment :\nJadwal :',
      'Terima kasih.',
    ];
    expect(findFormSection(paragraphs)).toEqual({ start: 0, end: 3 });
  });
});

describe('splitIntoBubbles — form struktural', () => {
  it('memecah form tenant arbitrer menjadi Intro | Form | Footer', () => {
    const reply = `Baik Bunda, berikut pilihan perawatan yang sesuai dengan keluhan si kecil.

Data kunjungan:

Nama Pasien :
Usia :
Alamat :
Keluhan :

Mohon dilengkapi Bunda, nanti kami cek jadwalnya.`;

    const bubbles = typingService.splitIntoBubbles(reply);

    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toContain('pilihan perawatan');
    expect(bubbles[1]).toContain('Nama Pasien');
    expect(bubbles[1]).toContain('Keluhan');
    expect(bubbles[1]).not.toContain('Mohon dilengkapi');
    expect(bubbles[2]).toContain('Mohon dilengkapi');
  });

  it('form tanpa intro → 2 bubble (Form | Footer)', () => {
    const reply = `Data kunjungan:

Nama :\nUsia :\nAlamat :

Mohon dilengkapi Bunda.`;

    const bubbles = typingService.splitIntoBubbles(reply);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toContain('Nama');
    expect(bubbles[1]).toContain('Mohon dilengkapi');
  });

  it('form tanpa footer → 2 bubble (Intro | Form)', () => {
    const reply = `Baik Bunda, ini datanya.

Nama :\nUsia :\nAlamat :`;

    const bubbles = typingService.splitIntoBubbles(reply);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toContain('Baik Bunda');
    expect(bubbles[1]).toContain('Nama');
  });

  it('frasa lama TIDAK lagi memicu split form (anti-hafalan)', () => {
    const legacy = `Baik Bunda, kami bantu siapkan format reservasi ya.

Alamat & Shareloc bisa dikirim menyusul, tidak perlu sekarang.`;

    const bubbles = typingService.splitIntoBubbles(legacy);
    // Tanpa blok field nyata, pesan pendek tetap 1 bubble utuh.
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toContain('Alamat & Shareloc');
  });

  it('pemisah "=" hanya bekerja bila tenant mengonfigurasinya', () => {
    const reply = `Baik Bunda, ini formulirnya.

Nama =\nUsia =\nAlamat =

Mohon diisi ya Bunda.`;

    const tanpaConfig = typingService.splitIntoBubbles(reply);
    expect(tanpaConfig).toHaveLength(1);

    const denganConfig = typingService.splitIntoBubbles(reply, { extraSeparators: ['='] });
    expect(denganConfig).toHaveLength(3);
    expect(denganConfig[1]).toContain('Nama');
  });

  it('isi teks tidak hilang setelah dipecah', () => {
    const reply = `Intro konsultasi.

Nama :\nUsia :\nAlamat :

Footer SOP.`;
    const bubbles = typingService.splitIntoBubbles(reply);
    const joined = bubbles.join('\n\n');
    for (const fragment of ['Intro konsultasi.', 'Nama', 'Usia', 'Alamat', 'Footer SOP.']) {
      expect(joined).toContain(fragment);
    }
  });
});

describe('getHumanizerBubbleConfig (tenant-aware, DB offline-safe)', () => {
  it('DB offline → konfigurasi kosong (deteksi struktural tetap jalan)', async () => {
    const config = await getHumanizerBubbleConfig('tenant-offline');
    expect(config).toEqual(EMPTY_HUMANIZER_BUBBLE_CONFIG);
  });

  it('membaca extraSeparators dari Tenant.settings dan memfiltrasi nilai tidak valid', async () => {
    vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({
      settings: { humanizerBubble: { extraSeparators: ['=', '   ', 42, 'terlalupanjang'] } },
    } as any);

    const config = await getHumanizerBubbleConfig('tenant-custom');
    expect(config.extraSeparators).toEqual(['=']);
  });

  it('cache mencegah query DB berulang untuk tenant yang sama', async () => {
    const spy = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ settings: {} } as any);
    await getHumanizerBubbleConfig('tenant-cache');
    await getHumanizerBubbleConfig('tenant-cache');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('clear cache memaksa pembacaan ulang', async () => {
    const spy = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ settings: {} } as any);
    await getHumanizerBubbleConfig('tenant-reset');
    clearHumanizerBubbleConfigCache('tenant-reset');
    await getHumanizerBubbleConfig('tenant-reset');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('parse konfigurasi menolak bentuk yang salah tanpa melempar', () => {
    expect(parseHumanizerBubbleConfig(null)).toEqual({ extraSeparators: [] });
    expect(parseHumanizerBubbleConfig({ extraSeparators: 'bukan-array' })).toEqual({ extraSeparators: [] });
    expect(parseHumanizerBubbleConfig({ extraSeparators: ['|', '→'] })).toEqual({ extraSeparators: ['|', '→'] });
  });
});
