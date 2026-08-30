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
