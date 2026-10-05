/**
 * imageCompressor.ts
 * Utility kompresi dan downscaling gambar berbasis HTML5 Canvas di sisi client (browser/mobile).
 * Mengurangi ukuran foto kamera HP (5MB - 15MB) menjadi ~150KB - 250KB dalam <100ms
 * untuk mencegah lag upload di jaringan seluler di lapangan.
 */

export interface CompressImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0.1 - 1.0 (default 0.8)
  mimeType?: string; // default 'image/jpeg'
}

/**
 * Profil kompresi bernama (single source of truth) untuk seragamkan angka di
 * seluruh konsumen (StaffToday, LiveChatMonitor, TodayTreatments, Reservations,
 * LocationPickerModal). Sebelumnya angka 1000/1280 & 0.7/0.75 terpencar.
 */
export type ImageCompressProfile = 'chat' | 'field' | 'house';

export const IMAGE_COMPRESS_PROFILES: Record<
  ImageCompressProfile,
  Required<Pick<CompressImageOptions, 'maxWidth' | 'maxHeight'>> & { quality: number }
> = {
  // Balasan chat desktop/admin (layar besar, sinyal mapan).
  chat: { maxWidth: 1280, maxHeight: 1280, quality: 0.75 },
  // Foto lapangan dari HP terapis di sinyal 1-bar (960px masih jelas baca nomor rumah).
  field: { maxWidth: 960, maxHeight: 960, quality: 0.65 },
  // Foto rumah/patokan jalan (kompromi keterbacaan detail rumah).
  house: { maxWidth: 1000, maxHeight: 1000, quality: 0.7 },
};

export function resolveCompressProfile(profile: ImageCompressProfile): {
  maxWidth: number;
  maxHeight: number;
  quality: number;
} {
  return IMAGE_COMPRESS_PROFILES[profile];
}

/**
 * Mengompresi file gambar (File / Blob) dan mengembalikan base64 data URL yang ringan.
 */
export async function compressImageFile(
  fileOrBlob: File | Blob,
  options: CompressImageOptions = {}
): Promise<{ dataUrl: string; width: number; height: number; originalSize: number; compressedSize: number }> {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.8,
    mimeType = 'image/jpeg',
  } = options;

  const originalSize = fileOrBlob.size;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Gagal memuat format gambar untuk dikompres.'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Hitung skala rasio aspek proporsional
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          // Fallback jika canvas context tidak tersedia
          resolve({
            dataUrl: reader.result as string,
            width: img.width,
            height: img.height,
            originalSize,
            compressedSize: originalSize,
          });
          return;
        }

        // Gambar ke canvas dengan interpolasi halus
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL(mimeType, quality);
        // Estimasi ukuran base64 byte (base64 length * 0.75)
        const compressedSize = Math.round(dataUrl.length * 0.75);

        resolve({
          dataUrl,
          width,
          height,
          originalSize,
          compressedSize,
        });
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(fileOrBlob);
  });
}

/**
 * Mengompresi DATA URL yang sudah ada (mis. hasil watermark canvas) ke JPEG ringan.
 * Dipakai setelah `stampGpsWatermark` yang meng-encode ulang q0.85 — agar ukuran
 * akhir tetap terbatas di sinyal 1-bar (Fase 2.2).
 */
export async function compressDataUrl(
  dataUrl: string,
  options: CompressImageOptions = {}
): Promise<string> {
  const {
    maxWidth = 1280,
    maxHeight = 1280,
    quality = 0.8,
    mimeType = 'image/jpeg',
  } = options;
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl);
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(mimeType, quality));
    };
    img.src = dataUrl;
  });
}

/**
 * Batas aman file mentah sebelum kompresi (konstanta algoritmik, bukan data bisnis/tenant).
 * File di bawah batas ini hampir pasti gagal diproses di browser HP.
 */
export const CHAT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;

export interface PreparedChatImage {
  /** Data URL ringan siap ditampilkan sebagai preview maupun dikirim. */
  preview: string;
  /** Data URL terkompresi (JPEG ~1280px) untuk dikirim ke backend. */
  dataUrl: string;
  mimeType: string;
  fileName: string;
}

/**
 * Menyiapkan foto chat dari kamera HP menjadi JPEG ringan (~120-250KB) dalam satu langkah:
 * validasi → downscale Canvas. Dipakai bersama oleh composer StaffToday & LiveChatMonitor
 * agar tidak ada lagi pengiriman Base64 mentah multi-MB (single source of truth).
 *
 * Sengaja "attempt-first": HEIC dicoba decode dulu (Safari iOS mendukung native); hanya
 * bila browser gagal decode (mis. Chrome/Android), baru dilempar pesan yang mengarahkan
 * terapis memakai mode kompatibel / foto ulang dari kamera — bukan menolak buta.
 */
export async function prepareChatImage(
  file: File,
  profile: ImageCompressProfile = 'chat'
): Promise<PreparedChatImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Hanya file gambar yang didukung.');
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    throw new Error('Foto terlalu besar (maks 25 MB). Ambil ulang dari kamera.');
  }
  try {
    const p = resolveCompressProfile(profile);
    const c = await compressImageFile(file, { maxWidth: p.maxWidth, maxHeight: p.maxHeight, quality: p.quality });
    return { preview: c.dataUrl, dataUrl: c.dataUrl, mimeType: 'image/jpeg', fileName: file.name };
  } catch {
    const isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    throw new Error(
      isHeic
        ? 'Foto HEIC (iPhone) belum bisa diproses browser ini. Ubah kamera ke "Paling Kompatibel" atau ambil ulang dari kamera.'
        : 'Foto gagal diproses. Coba ambil ulang dari kamera.'
    );
  }
}
