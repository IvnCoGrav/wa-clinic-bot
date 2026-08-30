/**
 * imageWatermark.ts
 * Stamping watermark GPS, kelurahan/kecamatan, patokan, dan timestamp langsung di sisi client via Canvas.
 * Memastikan staf dan admin dapat langsung melihat pratinjau foto ber-watermark di browser sebelum disimpan.
 */

export interface WatermarkInfo {
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  landmark?: string | null;
  customerName?: string | null;
  takerName?: string | null;
  staffName?: string | null;
  timestamp?: string;
}

/**
 * Menempelkan banner watermark GPS dan lokasi di bagian bawah foto secara instan di canvas.
 */
export async function stampGpsWatermark(
  dataUrlOrImg: string,
  info: WatermarkInfo
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(dataUrlOrImg); // Fallback ke gambar asli jika gagal
    img.onload = () => {
      const width = img.width;
      const height = img.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(dataUrlOrImg);
        return;
      }

      // 1. Gambar foto utama
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Format Teks Watermark
      const dateObj = new Date();
      const timeStr =
        info.timestamp ||
        dateObj.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' WIB';

      const hasCoords = info.lat != null && info.lng != null;
      const latStr = hasCoords ? Number(info.lat).toFixed(6) : '';
      const lngStr = hasCoords ? Number(info.lng).toFixed(6) : '';

      const cleanKel = (info.kelurahan || '').trim();
      const cleanKec = (info.kecamatan || '').trim();
      const cleanLandmark = (info.landmark || '').trim();
      const cleanTaker = (info.takerName || info.staffName || '').trim();

      let areaText = '';
      if (cleanKel && cleanKec) {
        areaText = ` · Kel. ${cleanKel}, Kec. ${cleanKec}`;
      } else if (cleanKel || cleanKec) {
        areaText = ` · ${cleanKel || cleanKec}`;
      }

      let line1 = '📍 Panduan Lokasi Pasien';
      if (hasCoords) {
        const accText = info.accuracy ? ` (±${info.accuracy}m)` : '';
        line1 = `📍 GPS: ${latStr}, ${lngStr}${accText}${areaText}`;
      } else if (areaText) {
        line1 = `📍 Area:${areaText}`;
      }

      const parts: string[] = [];
      if (cleanTaker) {
        parts.push(`📸 ${cleanTaker}`);
      }
      if (cleanLandmark) {
        const truncatedLandmark = cleanLandmark.length > 40 ? cleanLandmark.slice(0, 37) + '...' : cleanLandmark;
        parts.push(`Patokan: ${truncatedLandmark}`);
      } else if (info.customerName) {
        parts.push(`Bunda ${info.customerName}`);
      }
      parts.push(timeStr);

      const line2 = parts.join(' · ');

      // 3. Render Banner Semi-Transparan
      const bannerHeight = Math.max(54, Math.round(height * 0.12));
      const bannerY = height - bannerHeight;

      // Dark translucent background bar
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'; // Slate-900 with 82% opacity
      ctx.fillRect(0, bannerY, width, bannerHeight);

      // Emerald brand accent top border
      ctx.fillStyle = '#00a884';
      ctx.fillRect(0, bannerY, width, Math.max(3, Math.round(bannerHeight * 0.05)));

      // Responsive font sizes
      const baseFontSize = Math.max(12, Math.min(18, Math.round(width * 0.022)));
      const subFontSize = Math.max(10, Math.min(15, Math.round(width * 0.018)));

      // Line 1: Koordinat & Kelurahan (Bold White)
      ctx.font = `bold ${baseFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      const paddingX = Math.max(14, Math.round(width * 0.025));
      const textY1 = bannerY + bannerHeight * 0.36;
      ctx.fillText(line1, paddingX, textY1);

      // Line 2: Patokan & Tanggal Jam (Subtle Mint/Slate)
      ctx.font = `normal ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#cbd5e1'; // Slate-300
      const textY2 = bannerY + bannerHeight * 0.72;
      ctx.fillText(line2, paddingX, textY2);

      // Clinic Brand Stamp in Top Right or Bottom Right
      ctx.font = `italic bold ${Math.max(9, Math.round(baseFontSize * 0.8))}px sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      const brandText = '🌸 Kala Moms & Baby';
      const brandWidth = ctx.measureText(brandText).width;
      ctx.fillText(brandText, width - brandWidth - paddingX, textY1);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };

    img.src = dataUrlOrImg;
  });
}
